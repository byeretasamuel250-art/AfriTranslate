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

  const authHeader = { "Authorization": "Bearer " + process.env.SUNBIRD_API_KEY };

  try {
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
    return res.status(200).json({ audio_url: speechData.audio_url || speechData.url });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
