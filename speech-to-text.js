// This runs on Vercel's server, NOT in the browser.
// It receives an audio recording from the browser, forwards it to
// Sunbird's speech-to-text service, and returns the transcribed text.

export const config = {
  api: {
    bodyParser: false // we need the raw audio data, not JSON
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const language = req.headers["x-language"];
  if (!language) {
    return res.status(400).json({ error: "Missing language" });
  }

  try {
    // Collect the raw audio bytes sent from the browser.
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);

    // Build a multipart form to send to Sunbird, the format their API expects.
    const formData = new FormData();
    formData.append("audio", new Blob([audioBuffer], { type: "audio/webm" }), "recording.webm");
    formData.append("language", language);

    const sunbirdResponse = await fetch("https://api.sunbird.ai/tasks/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.SUNBIRD_API_KEY
      },
      body: formData
    });

    if (!sunbirdResponse.ok) {
      const errorText = await sunbirdResponse.text();
      return res.status(sunbirdResponse.status).json({ error: "Sunbird API error: " + errorText });
    }

    const data = await sunbirdResponse.json();
    return res.status(200).json({ text: data.text || data.transcription || "" });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
