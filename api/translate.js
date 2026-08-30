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

  const { text, source_language, target_language } = req.body;

  if (!text || !source_language || !target_language) {
    return res.status(400).json({ error: "Missing text, source_language, or target_language" });
  }

  const cacheKey = buildCacheKey(text, source_language, target_language);

  // --- 1. Check the shared cache first ---
  try {
    const { data: cached, error: cacheReadError } = await supabase
      .from("translation_cache")
      .select("translated_text")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (cacheReadError) {
      console.error("Cache read error:", cacheReadError.message);
    }

    if (cached) {
      return res.status(200).json({ translated_text: cached.translated_text });
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

  // --- 3. Call Sunbird ---
  try {
    const sunbirdResponse = await callSunbirdWithRetry("https://api.sunbird.ai/tasks/translate", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.SUNBIRD_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ source_language, target_language, text })
    });

    if (!sunbirdResponse.ok) {
      const errorText = await sunbirdResponse.text();
      if (sunbirdResponse.status === 429) {
        return res.status(429).json({ error: "Lots of people are translating right now - please try again in a moment." });
      }
      return res.status(sunbirdResponse.status).json({ error: "Sunbird API error: " + errorText });
    }

    const data = await sunbirdResponse.json();
    const translatedText = data.output.translated_text;

    // --- 4. Save to the shared cache for next time ---
    const { error: cacheWriteError } = await supabase
      .from("translation_cache")
      .upsert({ cache_key: cacheKey, translated_text: translatedText });

    if (cacheWriteError) {
      console.error("Cache write error:", cacheWriteError.message);
    }

    return res.status(200).json({ translated_text: translatedText });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
