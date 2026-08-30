// This runs on Vercel's server, NOT in the browser.
// Receives the recorded audio blob from app.js, forwards it to Sunbird's
// transcription endpoint along with the language it was recorded in, and
// sends back the transcribed text. The Sunbird API key stays here on the
// server and is never visible to website visitors.
//
// IMPORTANT: this endpoint expects raw audio bytes in the request body
// (that's what app.js sends), not JSON - so we turn off Vercel's default
// JSON body parser and read the raw bytes ourselves.
export const config = {
  api: {
    bodyParser: false
  }
};

// Reads the raw audio bytes out of the incoming request.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Same retry pattern as translate.js and text-to-speech.js: if Sunbird is
// temporarily too busy (429) or having a brief hiccup (503), wait a moment
// and try again automatically - up to 3 times - instead of immediately
// failing. Also retries on a raw network failure (e.g. a dropped
// connection), which a plain fetch() rejection would otherwise skip past.
async function callSunbirdWithRetry(url, options, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);
      const isRetryable = response.status === 429 || response.status === 503;
      if (!isRetryable || attempt === maxAttempts) {
        return response;
      }
    } catch (err) {
      if (attempt === maxAttempts) {
        throw err;
      }
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

  // app.js sends the language code as a custom header, not in a JSON body,
  // since the body itself is the raw audio recording.
  const language = req.headers["x-language"];

  if (!language) {
    return res.status(400).json({ error: "Missing X-Language header" });
  }

  const audioBuffer = await readRawBody(req);

  if (!audioBuffer.length) {
    return res.status(400).json({ error: "No audio received" });
  }

  try {
    // Sunbird's transcription endpoint expects the audio as a file upload
    // (multipart form), plus the language it was spoken in.
    const formData = new FormData();
    formData.append("audio", new Blob([audioBuffer], { type: "audio/webm" }), "recording.webm");
    formData.append("language", language);

    const sunbirdResponse = await callSunbirdWithRetry("https://api.sunbird.ai/tasks/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.SUNBIRD_API_KEY
        // No Content-Type header here on purpose - the FormData sets its
        // own multipart boundary automatically, and overriding it breaks
        // the upload.
      },
      body: formData
    });

    if (!sunbirdResponse.ok) {
      const errorText = await sunbirdResponse.text();
      if (sunbirdResponse.status === 429) {
        return res.status(429).json({ error: "Lots of people are transcribing right now - please try again in a moment." });
      }
      if (sunbirdResponse.status === 422) {
        return res.status(422).json({ error: "Couldn't make out that recording - please try again." });
      }
      return res.status(sunbirdResponse.status).json({ error: "Sunbird API error: " + errorText });
    }

    const data = await sunbirdResponse.json();

    // Defensive: Sunbird's exact response shape isn't confirmed, so check
    // the most likely field names rather than assuming just one.
    const transcribedText = data.text || data.transcript || data.transcription || (data.output && data.output.text);

    if (!transcribedText) {
      return res.status(502).json({ error: "Transcription came back empty - please try again." });
    }

    return res.status(200).json({ text: transcribedText });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
