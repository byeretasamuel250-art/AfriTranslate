// This runs on Vercel's server, NOT in the browser.
// Receives the recorded audio blob from app.js, forwards it to Sunbird's
// transcription endpoint along with the language it was recorded in, and
// sends back the transcribed text. The Sunbird API key stays here on the
// server and is never visible to website visitors.
//
// IMPORTANT: this endpoint expects raw audio bytes in the request body
// (that's what app.js sends), not JSON - so we turn off Vercel's default
// JSON body parser and read the raw bytes ourselves.
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_lib/auth.js";

// Server-side only, used just to verify who's calling this endpoint (see
// requireUser) - this route doesn't otherwise touch the database.
const supabase = createClient(
  "https://ntuhsfipdqdfanxuosdn.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: false
  }
};

// A generous but real ceiling on recorded audio size, so someone can't
// bypass the browser and stream something huge straight at Sunbird on
// our dime. A few minutes of webm voice recording is nowhere near this.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB

// --- Shared per-minute Sunbird rate limit ---
//
// This draws from the SAME per-minute counter that api/translate.js
// (and api/text-to-speech.js) reserve slots from - see the longer
// explanation in translate.js. All Sunbird-calling endpoints share one
// budget because the real constraint, Sunbird's account-wide rate
// limit, is shared too. Giving this endpoint its own separate 45/min
// allowance on top of translate.js's would let the two together
// overrun what Sunbird actually allows.
//
// Unlike translate.js, there's no cache step here first: two people's
// recordings are essentially never identical, so every transcription
// request needs a real Sunbird call - this queue is the only
// protection this endpoint has against a burst of simultaneous voice
// use.
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

// Reads the raw audio bytes out of the incoming request, aborting early
// if it grows past MAX_AUDIO_BYTES rather than buffering an unbounded
// amount of data in memory first.
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("PAYLOAD_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
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

  // Only signed-in AfriTranslate users can spend our Sunbird quota here.
  const user = await requireUser(req, res, supabase);
  if (!user) return; // requireUser has already sent the error response

  // app.js sends the language code as a custom header, not in a JSON body,
  // since the body itself is the raw audio recording.
  const language = req.headers["x-language"];

  if (!language) {
    return res.status(400).json({ error: "Missing X-Language header" });
  }

  let audioBuffer;
  try {
    audioBuffer = await readRawBody(req, MAX_AUDIO_BYTES);
  } catch (err) {
    if (err.message === "PAYLOAD_TOO_LARGE") {
      return res.status(413).json({ error: "That recording is too long - please try a shorter one." });
    }
    return res.status(400).json({ error: "Couldn't read the audio - please try again." });
  }

  if (!audioBuffer.length) {
    return res.status(400).json({ error: "No audio received" });
  }

  // Get in line for a shared Sunbird slot before spending a real call on
  // transcription. This is what smooths out bursts of simultaneous
  // voice use instead of everyone getting an immediate error the moment
  // Sunbird's own limit is hit.
  const gotSlot = await waitForSunbirdSlot();
  if (!gotSlot) {
    return res.status(429).json({
      error: "Lots of people are transcribing right now - please try again in a moment."
    });
  }

  try {
    // Sunbird's transcription endpoint expects the audio as a file upload
    // (multipart form), plus the language it was spoken in.
    //
    // IMPORTANT: Sunbird actually has TWO separate language fields -
    // "language" AND "adapter" - and both default to Luganda ("lug") if
    // left out. Sending only "language" (as an earlier version of this
    // file did) meant "adapter" silently fell back to Luganda every time,
    // which produced wrong-language transcriptions for every OTHER
    // language, Runyankole included. Both must be set to match.
    const formData = new FormData();
    formData.append("audio", new Blob([audioBuffer], { type: "audio/webm" }), "recording.webm");
    formData.append("language", language);
    formData.append("adapter", language);
    formData.append("recognise_speakers", "false");
    // whisper:false uses Sunbird's dedicated local-language model instead
    // of a Whisper-based one. Whisper models are commonly run in a mode
    // that translates speech INTO English rather than transcribing it in
    // its original language, which is the "typing English" symptom.
    formData.append("whisper", "false");

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
