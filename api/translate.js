// This runs on Vercel's server, NOT in the browser.
// It safely holds the Sunbird API key and forwards translation
// requests to Sunbird, so the key is never visible to website visitors.
//
// SCALING NOTE: as of now, translations are cached in a shared Supabase
// table (translation_cache) - so if ANY user has already translated this
// exact text between these two languages, we return that instantly and
// never call Sunbird again for it. This is what lets the app support far
// more than 50 users/minute: most real-world traffic is repeated common
// phrases, not unique text every time.
//
// If the app still outgrows Sunbird's free "Standard" rate limit after
// this cache is doing its job, the next fix is requesting a higher tier
// from Sunbird - nothing in this file needs to change for that, since
// the limit lives on their side.

import { createClient } from "@supabase/supabase-js";

// Server-side only. Uses the SECRET service role key (never the public
// "publishable"/anon key auth.js uses), because this key can read and
// write the translation_cache table directly, bypassing Row Level
// Security. It must never be sent to the browser.
const supabase = createClient(
  "https://ntuhsfipdqdfanxuosdn.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    // Wait a bit longer each retry (0.5s, then 1s), so we're not hammering
    // a service that's already busy.
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
}

// Builds the shared cache key: same text + same language pair should
// always produce the same key, regardless of which user asked for it.
// Lowercasing and trimming means "Hello" and "hello " share one entry.
function buildCacheKey(text, sourceLanguage, targetLanguage) {
  return sourceLanguage + ":" + targetLanguage + ":" + text.toLowerCase().trim();
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

  // --- Check the shared cache first ---
  // If anyone has ever translated this exact phrase for this language
  // pair, return it instantly - no Sunbird call, no rate-limit usage.
  try {
    const { data: cached, error: cacheReadError } = await supabase
      .from("translation_cache")
      .select("translated_text")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (cacheReadError) {
      // Don't fail the whole request just because the cache had a hiccup -
      // just fall through and translate normally via Sunbird.
      console.error("Cache read error:", cacheReadError.message);
    }

    if (cached) {
      return res.status(200).json({ translated_text: cached.translated_text });
    }
  } catch (err) {
    console.error("Cache read failed:", err.message);
    // Fall through to Sunbird - a broken cache should never break translation.
  }

  // --- Not cached: call Sunbird as before ---
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
      // A friendlier message specifically for "too busy right now".
      if (sunbirdResponse.status === 429) {
        return res.status(429).json({ error: "Lots of people are translating right now - please try again in a moment." });
      }
      return res.status(sunbirdResponse.status).json({ error: "Sunbird API error: " + errorText });
    }

    const data = await sunbirdResponse.json();
    const translatedText = data.output.translated_text;

    // --- Save to the shared cache for next time ---
    // Upsert (not insert) because two users could translate the same
    // brand-new phrase at almost the same moment - upsert just overwrites
    // instead of erroring on a duplicate key.
    const { error: cacheWriteError } = await supabase
      .from("translation_cache")
      .upsert({ cache_key: cacheKey, translated_text: translatedText });

    if (cacheWriteError) {
      // Don't fail the response over this - the user still gets their
      // translation, it just won't be cached for the next person.
      console.error("Cache write error:", cacheWriteError.message);
    }

    return res.status(200).json({ translated_text: translatedText });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
