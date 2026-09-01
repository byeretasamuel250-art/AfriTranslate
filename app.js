// AfriTranslate - app logic
// Handles translation (via Sunbird AI), voice input, text-to-speech playback,
// and caching. Real API calls go through our own backend helpers in /api,
// which keep the Sunbird API key hidden from the browser.

const srcLang = document.getElementById("srcLang");
const tgtLang = document.getElementById("tgtLang");
const swapBtn = document.getElementById("swapBtn");
const inputText = document.getElementById("inputText");
const translateBtn = document.getElementById("translateBtn");
const errorMsg = document.getElementById("errorMsg");
const outputText = document.getElementById("outputText");
const micBtn = document.getElementById("micBtn");
const copyBtn = document.getElementById("copyBtn");
const qualityLabel = document.getElementById("qualityLabel");

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
    const { text: result, confidence } = await translateText(text, srcLang.value, tgtLang.value);
    outputText.textContent = result;
    outputText.classList.remove("placeholder");

    // Quality signal, in priority order:
    // 1. If Google Translate was available to cross-check and it agreed
    //    with Sunbird, that's a real positive signal - hide any warning.
    // 2. If it was available and disagreed, say so plainly - this is
    //    more useful than the old static "beta language" guess, since
    //    it reflects this specific translation, not just the language pair.
    // 3. If no cross-check was possible for this language pair, fall
    //    back to the old static guess based on how well-resourced the
    //    language generally is.
    qualityLabel.classList.remove("unconfirmed");
    if (confidence && confidence.cross_checked) {
      if (confidence.agrees) {
        qualityLabel.style.display = "none";
      } else {
        qualityLabel.textContent = "Couldn't be double-checked - the translation may need a closer look";
        qualityLabel.classList.add("unconfirmed");
        qualityLabel.style.display = "";
      }
    } else {
      const isReliablePair = RELIABLE_LANGS.includes(srcLang.value) && RELIABLE_LANGS.includes(tgtLang.value);
      qualityLabel.textContent = "Beta language - quality may vary";
      qualityLabel.style.display = isReliablePair ? "none" : "";
    }
  } catch (err) {
    showMessage(err.message === "RATE_LIMITED"
      ? "Lots of people are translating right now - please try again in a moment."
      : "Something went wrong. Please try again.");
    outputText.textContent = "Translation will appear here";
    outputText.classList.add("placeholder");
    qualityLabel.classList.remove("unconfirmed");
    qualityLabel.style.display = "none";
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

// These are the best-resourced languages, where translation quality is
// generally strong. Everything else has less training data behind it,
// so we proactively invite feedback on those - not because something
// went wrong, just because it's more likely to need a human check.
const RELIABLE_LANGS = ["eng", "lug", "swa", "kin"];

// Splits long text into sentence-sized pieces. Sunbird's own guidance is
// to keep requests short for consistent quality - long blocks of text can
// otherwise come back only partly translated.
function splitIntoChunks(text, maxLength = 300) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length > maxLength && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = (current + " " + sentence).trim();
    }
  }
  if (current) chunks.push(current);

  return chunks.length ? chunks : [text];
}

// Returns { text, confidence }. confidence is null when this chunk came
// from the local cache, the offline phrasebook, or the server didn't
// cross-check it - all of those mean "no fresh signal", not "disagreement".
async function translateOneChunk(text, from, to) {
  const cacheKey = "translate:" + from + ":" + to + ":" + text.toLowerCase().trim();
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    return { text: cached, confidence: null };
  }

  // Silent offline check: if this exact phrase is in our built-in common
  // phrases list, use that instantly - no network call, works even with
  // no internet connection. Completely invisible to the user either way.
  if (from === "eng") {
    const offlineMatch = getOfflinePhrase(text, to);
    if (offlineMatch) {
      return { text: offlineMatch, confidence: null };
    }
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
    if (response.status === 429) {
      throw new Error("RATE_LIMITED");
    }
    throw new Error(data.error || "Translation request failed");
  }

  try {
    localStorage.setItem(cacheKey, data.translated_text);
  } catch (e) {
    // Storage full or unavailable - not critical, just skip caching this one.
  }

  return { text: data.translated_text, confidence: data.confidence || null };
}

async function translateText(text, from, to) {
  if (!SUNBIRD_LANGS.includes(from) || !SUNBIRD_LANGS.includes(to)) {
    throw new Error("This language pair isn't connected yet.");
  }

  const chunks = splitIntoChunks(text);

  // Short text (the normal case - a word or a sentence) is just one chunk,
  // so this is no slower than before for typical use.
  const translatedChunks = [];
  let sawCrossCheck = false;
  let allAgreed = true;

  for (const chunk of chunks) {
    const { text: chunkText, confidence } = await translateOneChunk(chunk, from, to);
    translatedChunks.push(chunkText);

    if (confidence && confidence.cross_checked) {
      sawCrossCheck = true;
      if (!confidence.agrees) {
        allAgreed = false;
      }
    }
  }

  return {
    text: translatedChunks.join(" "),
    // If ANY chunk was cross-checked and disagreed, treat the whole
    // translation as unconfirmed - one shaky sentence in a paragraph is
    // still worth flagging.
    confidence: sawCrossCheck ? { cross_checked: true, agrees: allAgreed } : null
  };
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

// Copy translated text to clipboard
copyBtn.addEventListener("click", () => {
  const text = outputText.textContent;
  if (text && text !== "Translation will appear here") {
    navigator.clipboard.writeText(text);
  }
});

