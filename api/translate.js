// This runs on Vercel's server, NOT in the browser.
// It safely holds the Sunbird API key and forwards translation
// requests to Sunbird, so the key is never visible to website visitors.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { text, source_language, target_language } = req.body;

  if (!text || !source_language || !target_language) {
    return res.status(400).json({ error: "Missing text, source_language, or target_language" });
  }

  try {
    const sunbirdResponse = await fetch("https://api.sunbird.ai/tasks/nllb_translate", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.SUNBIRD_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ source_language, target_language, text })
    });

    if (!sunbirdResponse.ok) {
      const errorText = await sunbirdResponse.text();
      return res.status(sunbirdResponse.status).json({ error: "Sunbird API error: " + errorText });
    }

    const data = await sunbirdResponse.json();
    return res.status(200).json({ translated_text: data.output.translated_text });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
