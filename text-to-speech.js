// This runs on Vercel's server, NOT in the browser.
// Converts text into spoken audio using Sunbird's voice service.
// Automatically looks up an available voice for the requested language,
// so we don't have to hardcode voice IDs for all 20+ languages.
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_lib/auth.js";

// Server-side only, used just to verify who's calling this endpoint (see
// requireUser) - this route doesn't otherwise touch the database.
const supabase = createClient(
  "https://ntuhsfipdqdfanxuosdn.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// A generous but real ceiling, so someone can't bypass the browser and
// ask us to synthesize speech for an enormous wall of text on our dime.
const MAX_TEXT_LENGTH = 2000;

// --- Shared per-minute Sunbird rate limit ---
//
// This draws from the SAME per-minute counter that api/translate.js and
// api/speech-to-text.js reserve slots from - see the longer explanation
// in translate.js. All Sunbird-calling endpoints share one budget
// because the real constraint, Sunbird's account-wide rate limit, is
// shared too.
const SUNBIRD_LIMIT_PER_MINUTE = 45;

// How long we're willing to make one user's request wait in the queue
// before giving up and asking them to try again. Kept short because
// Vercel functions have their own execution time limit.
const MAX_QUEUE_WAIT_MS = 8000;
const QUEUE_POLL_INTERVAL_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tries to reserve one of this minute's Sunbird call slots. If the
// minute's budget is already full, waits a beat and tries again, up to
// MAX_QUEUE_WAIT_MS total. Returns true once a slot is secured, or
// false if we ran out of waiting time.
async function waitForSunbirdSlot() {
  const deadline = Date.now() + MAX_QUEUE_WAIT_MS;

  while (Date.now() < deadline) {
    const { data: gotSlot, error } = await supabase.rpc("reserve_sunbird_slot", {
      limit_per_minute: SUNBIRD_LIMIT_PER_MINUTE
    });

    if (error) {
      // If the queue itself is broken, don't trap every user behind it -
      // let the request through and rely on Sunbird's own 429 handling
      // as a fallback.
      console.error("Rate limit check failed:", error.message);
      return true;
    }

    if (gotSlot) {
      return true;
    }

    await sleep(QUEUE_POLL_INTERVAL_MS);
  }

  return false;
}

// --- Shared cache ---
//
// Same idea as translation_cache in translate.js: if ANY user already
// asked to hear this exact text read aloud in this exact language, reuse
// that audio URL instead of spending another Sunbird call on it.
//
// NOTE: this assumes Sunbird's audio_url stays valid indefinitely (or at
// least long enough to be worth reusing). If Sunbird's URLs are
// short-lived/signed and expire, caching them would eventually serve
// broken links - worth confirming with Sunbird's docs or support before
// relying on this in production. If they do expire, the fix is storing
// an expiry alongside audio_url and re-generating past it, rather than
// caching forever.
//
// Requires a "speech_cache" table in Supabase: cache_key (text, primary
// key), audio_url (text).
function buildCacheKey(text, language) {
  return language + ":" + text.toLowerCase().trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  // Only signed-in AfriTranslate users can spend our Sunbird quota here.
  const user = await requireUser(req, res, supabase);
  if (!user) return; // requireUser has already sent the error response

  const { text, language } = req.body;

  if (!text || !language) {
    return res.status(400).json({ error: "Missing text or language" });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: "Text is too long to read aloud at once." });
  }

  const cacheKey = buildCacheKey(text, language);

  // --- 1. Check the shared cache first ---
  try {
    const { data: cached, error: cacheReadError } = await supabase
      .from("speech_cache")
      .select("audio_url")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (cacheReadError) {
      console.error("Speech cache read error:", cacheReadError.message);
    }

    if (cached) {
      return res.status(200).json({ audio_url: cached.audio_url });
    }
  } catch (err) {
    console.error("Speech cache read failed:", err.message);
  }

  const authHeader = { "Authorization": "Bearer " + process.env.SUNBIRD_API_KEY };

  try {
    // --- 2. Not cached: get in line for a Sunbird slot before looking
    //        up a voice - this is a real Sunbird request and needs its
    //        own slot in the shared budget ---
    const gotVoiceSlot = await waitForSunbirdSlot();
    if (!gotVoiceSlot) {
      return res.status(429).json({
        error: "Lots of people are using voice features right now - please try again in a moment."
      });
    }

    // Step 1: find an available voice for this language.
    const voicesResponse = await fetch(
      "https://api.sunbird.ai/tasks/voice/speakers?language=" + encodeURIComponent(language),
      { headers: authHeader }
    );

    if (!voicesResponse.ok) {
      return res.status(404).json({ error: "No voice available for this language yet." });
    }

    const voicesData = await voicesResponse.json();
    const voices = voicesData.voices || voicesData.speakers || [];

    if (!voices.length) {
      return res.status(404).json({ error: "No voice available for this language yet." });
    }

    const voiceId = voices[0].id || voices[0].voice_id || voices[0].name;

    // --- 3. Get in line again before the actual speech-generation call
    //        - it's a second, separate Sunbird request, so it draws its
    //        own slot from the same shared budget ---
    const gotSpeechSlot = await waitForSunbirdSlot();
    if (!gotSpeechSlot) {
      return res.status(429).json({
        error: "Lots of people are using voice features right now - please try again in a moment."
      });
    }

    // Step 2: generate the speech audio using that voice.
    const speechResponse = await fetch("https://api.sunbird.ai/tasks/audio/speech", {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        voice: voiceId,
        language,
        response_mode: "url"
      })
    });

    if (!speechResponse.ok) {
      const errorText = await speechResponse.text();
      return res.status(speechResponse.status).json({ error: "Sunbird TTS error: " + errorText });
    }

    const speechData = await speechResponse.json();
    const audioUrl = speechData.audio_url || speechData.url;

    // --- 4. Save to the shared cache for next time ---
    const { error: cacheWriteError } = await supabase
      .from("speech_cache")
      .upsert({ cache_key: cacheKey, audio_url: audioUrl });

    if (cacheWriteError) {
      console.error("Speech cache write error:", cacheWriteError.message);
    }

    return res.status(200).json({ audio_url: audioUrl });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
