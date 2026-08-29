// This runs on Vercel's server, NOT in the browser.
// It safely holds the Sunbird API key and forwards translation
// requests to Sunbird, so the key is never visible to website visitors.
//
// SCALING NOTE: if the app outgrows Sunbird's free "Standard" rate limit
// (50 requests/minute), the fix is requesting a higher tier from Sunbird -
// nothing in this file needs to change, since the limit lives on their side.

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { text, source_language, target_language } = req.body;

  if (!text || !source_language || !target_language) {
    return res.status(400).json({ error: "Missing text, source_language, or target_language" });
  }

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
    return res.status(200).json({ translated_text: data.output.translated_text });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
