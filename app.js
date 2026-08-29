// AfriTranslate - app logic
// STEP 2 (later) will replace translateText() below with a real call
// to the Sunbird AI API and Google Translate API.
// For now, it shows a placeholder so we can test the screen works.

const srcLang = document.getElementById("srcLang");
const tgtLang = document.getElementById("tgtLang");
const swapBtn = document.getElementById("swapBtn");
const inputText = document.getElementById("inputText");
const translateBtn = document.getElementById("translateBtn");
const errorMsg = document.getElementById("errorMsg");
const outputText = document.getElementById("outputText");
const micBtn = document.getElementById("micBtn");
const speakBtn = document.getElementById("speakBtn");
const copyBtn = document.getElementById("copyBtn");

// Swap source and target languages
swapBtn.addEventListener("click", () => {
  const temp = srcLang.value;
  srcLang.value = tgtLang.value;
  tgtLang.value = temp;
});

// Shows a message briefly, then hides it automatically on its own.
function showMessage(text, duration = 1800) {
  errorMsg.textContent = text;
  errorMsg.style.display = "block";
  clearTimeout(showMessage._timer);
  showMessage._timer = setTimeout(() => {
    errorMsg.style.display = "none";
  }, duration);
}

// Clear error message when user types
inputText.addEventListener("input", () => {
  errorMsg.style.display = "none";
});

// Main translate button
translateBtn.addEventListener("click", async () => {
  const text = inputText.value.trim();

  if (!text) {
    showMessage("Type something first");
    return;
  }

  errorMsg.style.display = "none";
  outputText.textContent = "Translating...";
  outputText.classList.add("placeholder");

  try {
    const result = await translateText(text, srcLang.value, tgtLang.value);
    outputText.textContent = result;
    outputText.classList.remove("placeholder");
  } catch (err) {
    showMessage("Something went wrong. Please try again.");
    outputText.textContent = "Translation will appear here";
    outputText.classList.add("placeholder");
  }
});

// Sunbird's /tasks/translate endpoint supports all these Ugandan and
// East African languages directly.
const SUNBIRD_LANGS = [
  "eng", "lug", "swa", "nyn", "kin", "ach", "teo", "lgg", "xog", "ttj",
  "nyo", "cgg", "koo", "myx", "lsm", "nuj", "gwr", "rub", "ruc", "mhi",
  "alz", "luc", "adh", "laj", "kdj", "pok", "keo", "bfa", "kdi", "kpz",
  "rwm", "tlj"
];

async function translateText(text, from, to) {
  if (!SUNBIRD_LANGS.includes(from) || !SUNBIRD_LANGS.includes(to)) {
    throw new Error("This language pair isn't connected yet.");
  }

  // CACHE CHECK: has this exact phrase + language pair been translated before?
  // If yes, return it instantly - no need to call the API again.
  const cacheKey = "translate:" + from + ":" + to + ":" + text.toLowerCase().trim();
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    return cached;
  }

  // This calls OUR OWN server helper (/api/translate), not Sunbird directly.
  // Our helper safely holds the API key and forwards the request.
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_language: from,
      target_language: to,
      text: text
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Translation request failed");
  }

  // Save this result so next time it's instant.
  try {
    localStorage.setItem(cacheKey, data.translated_text);
  } catch (e) {
    // Storage full or unavailable - not critical, just skip caching this one.
  }

  return data.translated_text;
}

// Voice input (mic button)
// Two paths depending on language:
// - English/Swahili: browser's free built-in voice recognition (instant, no server call)
// - Local languages (Luganda, Runyankole, etc.): record real audio and send
//   it to Sunbird's speech-to-text service, since browsers can't understand
//   these languages on their own.
const VOICE_INPUT_LANGS = { eng: "en-US", swa: "sw-KE" };

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let isListening = false;
let finalTranscript = "";
let mediaRecorder = null;
let audioChunks = [];

micBtn.addEventListener("click", () => {
  // If already listening/recording, tapping the mic again stops it.
  if (isListening) {
    if (recognition) recognition.stop();
    if (mediaRecorder) mediaRecorder.stop();
    return;
  }

  const browserLangCode = VOICE_INPUT_LANGS[srcLang.value];

  if (browserLangCode && SpeechRecognition) {
    startBrowserVoiceInput(browserLangCode);
  } else if (SUNBIRD_LANGS.includes(srcLang.value)) {
    startSunbirdVoiceInput(srcLang.value);
  } else {
    showMessage("Voice input isn't available for this language yet - try typing instead.");
  }
});

function startBrowserVoiceInput(langCode) {
  errorMsg.style.display = "none";
  recognition = new SpeechRecognition();
  recognition.lang = langCode;
  recognition.interimResults = true;
  recognition.continuous = true;

  finalTranscript = "";
  inputText.value = "";
  inputText.placeholder = "Listening... tap the mic again to stop";
  isListening = true;
  micBtn.classList.add("listening");

  recognition.onresult = (event) => {
    let interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript + " ";
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
    inputText.value = finalTranscript + interimTranscript;
  };

  recognition.onerror = () => {
    showMessage("Didn't catch that - please try again.");
  };

  recognition.onend = () => {
    inputText.placeholder = "Type or speak here...";
    isListening = false;
    micBtn.classList.remove("listening");
  };

  recognition.start();
}

async function startSunbirdVoiceInput(languageCode) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    showMessage("Couldn't access the microphone - check permissions.");
    return;
  }

  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.ondataavailable = (event) => {
    audioChunks.push(event.data);
  };

  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((track) => track.stop());
    isListening = false;
    micBtn.classList.remove("listening");
    inputText.placeholder = "Type or speak here...";

    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });

    if (audioBlob.size === 0) {
      return;
    }

    inputText.value = "Transcribing...";

    try {
      const response = await fetch("/api/speech-to-text", {
        method: "POST",
        headers: { "X-Language": languageCode },
        body: audioBlob
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Transcription failed");
      }

      inputText.value = data.text;
    } catch (err) {
      inputText.value = "";
      showMessage("Couldn't transcribe that - please try again.");
    }
  };

  isListening = true;
  micBtn.classList.add("listening");
  inputText.value = "";
  inputText.placeholder = "Recording... tap the mic again to stop";
  mediaRecorder.start();
}

// Text-to-speech (speaker button)
// Two paths, same pattern as voice input:
// - English/Swahili: browser's free built-in "speak" feature (instant)
// - Local languages: send text to Sunbird's voice service and play the
//   audio it generates.
const VOICE_OUTPUT_LANGS = { eng: "en-US", swa: "sw-KE" };
let currentAudio = null;

speakBtn.addEventListener("click", async () => {
  const text = outputText.textContent;
  if (!text || text === "Translation will appear here") {
    return;
  }

  const browserLangCode = VOICE_OUTPUT_LANGS[tgtLang.value];

  if (browserLangCode && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = browserLangCode;
    window.speechSynthesis.speak(utterance);
    return;
  }

  if (!SUNBIRD_LANGS.includes(tgtLang.value)) {
    showMessage("Listening playback isn't available for this language yet.");
    return;
  }

  // Stop any audio already playing before starting new playback.
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  speakBtn.classList.add("loading");

  try {
    const response = await fetch("/api/text-to-speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language: tgtLang.value })
    });

    const data = await response.json();

    if (!response.ok || !data.audio_url) {
      throw new Error(data.error || "Playback failed");
    }

    currentAudio = new Audio(data.audio_url);
    currentAudio.play();
  } catch (err) {
    showMessage("Couldn't play that - please try again.");
  } finally {
    speakBtn.classList.remove("loading");
  }
});

// Copy translated text to clipboard
copyBtn.addEventListener("click", () => {
  const text = outputText.textContent;
  if (text && text !== "Translation will appear here") {
    navigator.clipboard.writeText(text);
  }
});
