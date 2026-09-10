// This runs on Vercel's server, NOT in the browser.
// It safely holds the Sunbird API key and forwards translation
// requests to Sunbird, so the key is never visible to website visitors.
//
// SCALING NOTES (read top to bottom, each layer builds on the last):
//
// 1. CACHE: translations are cached in a shared Supabase table
//    (translation_cache) - if ANY user already translated this exact
//    text between these two languages, we return that instantly and
//    never call Sunbird again for it.
//
// 2. QUEUE: for anything NOT in the cache, we reserve a "slot" in a
//    shared per-minute counter (rate_limit_window table) BEFORE calling
//    Sunbird. If this minute's 50-request budget is full, instead of
//    immediately failing, we wait briefly and check again - smoothing
//    out bursts instead of throwing errors at users the instant traffic
//    spikes.
//
// If the app still outgrows Sunbird's free "Standard" rate limit after
// both of these are doing their job, the next fix is requesting a higher
// tier from Sunbird - nothing in this file needs to change for that,
// since the limit lives on their side.

import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_lib/auth.js";

// --- Quality cross-check against Google Translate ---
//
// Sunbird is our primary translator - this never changes that. But since
// Sunbird's own quality varies by language (and we've seen occasional bad
// outputs reported), we optionally cross-check its answer against Google
// Translate for the handful of languages Google also supports.
//
// IMPORTANT: this is a rough confidence signal, not a "which one is
// correct" judge. Two valid translations can use completely different
// words and phrasing, so disagreement does NOT necessarily mean Sunbird
// is wrong - it just means the two engines chose different renderings,
// which is worth a second look rather than blind trust either way.
// We never silently swap in Google's answer; Sunbird's translation is
// always what gets shown and cached. We only ever add a confidence
// signal on top of it.
//
// Google's language codes differ from Sunbird's for a few of these, so
// this maps Sunbird's code -> Google's code. Only languages confirmed to
// be supported by BOTH services are listed. If a pair isn't in this map,
// cross-checking is silently skipped and everything behaves exactly as
// it did before - no behavior change for unsupported languages.
const GOOGLE_LANG_MAP = {
  eng: "en",
  lug: "lg",
  swa: "sw",
  kin: "rw",
  ach: "ach",
  alz: "alz",
  cgg: "cgg"
};

// Below this word-overlap ratio, we treat the two translations as
// "disagreeing" rather than just differently-phrased. This is a coarse
// heuristic (bag-of-words Jaccard similarity), not a real quality
// measure - it's meant to catch big divergences, not nitpick phrasing.
const AGREEMENT_THRESHOLD = 0.3;

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[.,!?;:()"']/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccardSimilarity(textA, textB) {
  const setA = new Set(tokenize(textA));
  const setB = new Set(tokenize(textB));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Calls Google's Cloud Translation (Basic/v2) API. Returns null on any
// failure - a broken or missing cross-check should never block the main
// Sunbird translation from reaching the user.
async function getGoogleTranslation(text, sourceLanguage, targetLanguage) {
  const googleSource = GOOGLE_LANG_MAP[sourceLanguage];
  const googleTarget = GOOGLE_LANG_MAP[targetLanguage];

  if (!googleSource || !googleTarget || !process.env.GOOGLE_TRANSLATE_API_KEY) {
    return null;
  }

  try {
    const url = "https://translation.googleapis.com/language/translate/v2?key=" + process.env.GOOGLE_TRANSLATE_API_KEY;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: googleSource,
        target: googleTarget,
        format: "text"
      })
    });

    if (!response.ok) {
      console.error("Google Translate cross-check failed:", await response.text());
      return null;
    }

    const data = await response.json();
    return data.data.translations[0].translatedText;
  } catch (err) {
    console.error("Google Translate cross-check error:", err.message);
    return null;
  }
}

// Logs disagreements to a shared Supabase table so they can be reviewed
// later - this is how we actually find and fix the "sometimes wrong"
// cases over time, instead of just guessing at them.
async function logDisagreement(supabaseClient, entry) {
  const { error } = await supabaseClient.from("translation_disagreements").insert(entry);
  if (error) {
    // Never let logging failures affect the user-facing translation.
    console.error("Failed to log translation disagreement:", error.message);
  }
}

// Server-side only. Uses the SECRET service role key (never the public
// "publishable"/anon key auth.js uses), because this key can read and
// write these tables directly, bypassing Row Level Security. It must
// never be sent to the browser.
const supabase = createClient(
  "https://ntuhsfipdqdfanxuosdn.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Set a little under Sunbird's real 50/minute limit, so our own retries
// (below, and inside callSunbirdWithRetry) always have a small safety
// margin left over rather than racing right up against the actual wall.
const SUNBIRD_LIMIT_PER_MINUTE = 45;

// How long we're willing to make one user's request wait in the queue
// before giving up and asking them to try again. Kept short because
// Vercel functions have their own execution time limit.
const MAX_QUEUE_WAIT_MS = 8000;
const QUEUE_POLL_INTERVAL_MS = 1000;

// Calls Sunbird, and if it's temporarily too busy (429) or having a brief
// hiccup (503), waits a moment and tries again automatically - up to 3 times -
// instead of immediately failing.
async function callSunbirdWithRetry(url, options, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, options);

    const isRetryable = response.status === 429 || response.status === 503;
    if (!isRetryable || attempt === maxAttempts) {
      return response;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
}

// Builds the shared cache key: same text + same language pair should
// always produce the same key, regardless of which user asked for it.
function buildCacheKey(text, sourceLanguage, targetLanguage) {
  return sourceLanguage + ":" + targetLanguage + ":" + text.toLowerCase().trim();
}

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  // Only signed-in AfriTranslate users can spend our Sunbird/Google
  // quota - this is what actually makes the cache/queue/rate-limit work
  // above mean something, rather than being usable by anyone who finds
  // this URL.
  const user = await requireUser(req, res, supabase);
  if (!user) return; // requireUser has already sent the error response

  const { text, source_language, target_language } = req.body;

  if (!text || !source_language || !target_language) {
    return res.status(400).json({ error: "Missing text, source_language, or target_language" });
  }

  // A generous but real ceiling. splitIntoChunks in the browser already
  // keeps normal usage well under this - this exists purely to stop
  // someone bypassing the browser entirely and sending something huge
  // straight to the API.
  const MAX_TEXT_LENGTH = 5000;
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: "Text is too long to translate at once." });
  }

  const cacheKey = buildCacheKey(text, source_language, target_language);

  // --- 1. Check the shared cache first ---
  try {
    const { data: cached, error: cacheReadError } = await supabase
      .from("translation_cache")
      .select("translated_text, cross_checked, agrees")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (cacheReadError) {
      console.error("Cache read error:", cacheReadError.message);
    }

    if (cached) {
      // Return whatever confidence signal was found the first time this
      // text was translated (if any) - so a flagged disagreement stays
      // visible to every subsequent person who hits the cache, not just
      // the very first one who happened to trigger the live cross-check.
      const confidence = cached.cross_checked
        ? { cross_checked: true, agrees: cached.agrees }
        : null;
      return res.status(200).json({ translated_text: cached.translated_text, confidence });
    }
  } catch (err) {
    console.error("Cache read failed:", err.message);
  }

  // --- 2. Not cached: get in line for a Sunbird slot ---
  const gotSlot = await waitForSunbirdSlot();

  if (!gotSlot) {
    return res.status(429).json({
      error: "Lots of people are translating right now - please try again in a moment."
    });
  }

  // --- 3. Call Sunbird (and, in parallel, Google if this pair supports
  //        cross-checking - they're independent calls on the same source
  //        text, so running them together avoids adding extra latency) ---
  try {
    const [sunbirdResponse, googleTranslation] = await Promise.all([
      callSunbirdWithRetry("https://api.sunbird.ai/tasks/translate", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + process.env.SUNBIRD_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ source_language, target_language, text })
      }),
      getGoogleTranslation(text, source_language, target_language)
    ]);

    if (!sunbirdResponse.ok) {
      const errorText = await sunbirdResponse.text();
      if (sunbirdResponse.status === 429) {
        return res.status(429).json({ error: "Lots of people are translating right now - please try again in a moment." });
      }
      return res.status(sunbirdResponse.status).json({ error: "Sunbird API error: " + errorText });
    }

    const data = await sunbirdResponse.json();
    const translatedText = data.output.translated_text;

    // --- 4. Compare against Google's result (already fetched above,
    //        in parallel with Sunbird) ---
    // Sunbird's answer is always what gets cached and shown as the
    // actual translation. This only ever adds a confidence signal
    // alongside it - it can flag uncertainty, it never overrides.
    let confidence = null;

    if (googleTranslation) {
      const similarity = jaccardSimilarity(translatedText, googleTranslation);
      const agrees = similarity >= AGREEMENT_THRESHOLD;
      confidence = { cross_checked: true, agrees };

      if (!agrees) {
        // Fire-and-forget: don't make the user wait on a logging call.
        logDisagreement(supabase, {
          source_language,
          target_language,
          source_text: text,
          sunbird_translation: translatedText,
          google_translation: googleTranslation,
          similarity
        });
      }
    }

    // --- 5. Save to the shared cache for next time ---
    // The cross-check result goes into the SAME row, in the SAME write,
    // as the translation itself - not a separate write after the fact.
    // That matters because this table is shared: if writing the
    // confidence result were a second, later write, a concurrent reader
    // could see the translated_text land first and read it with no
    // confidence info yet, even though a cross-check was actually about
    // to flag it. One write means one consistent row, always.
    const { error: cacheWriteError } = await supabase
      .from("translation_cache")
      .upsert({
        cache_key: cacheKey,
        translated_text: translatedText,
        cross_checked: confidence !== null,
        agrees: confidence ? confidence.agrees : null
      });

    if (cacheWriteError) {
      console.error("Cache write error:", cacheWriteError.message);
    }

    return res.status(200).json({ translated_text: translatedText, confidence });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
