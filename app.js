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
const photoBtn = document.getElementById("photoBtn");
const photoInput = document.getElementById("photoInput");

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

    // A neutral note about language quality - NOT a claim this specific
    // translation is wrong, just honest context about the language pair.
    const isReliablePair = RELIABLE_LANGS.includes(srcLang.value) && RELIABLE_LANGS.includes(tgtLang.value);
    qualityLabel.style.display = isReliablePair ? "none" : "";
  } catch (err) {
    showMessage(err.message === "RATE_LIMITED"
      ? "Lots of people are translating right now - please try again in a moment."
      : "Something went wrong. Please try again.");
    outputText.textContent = "Translation will appear here";
    outputText.classList.add("placeholder");
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
    if (response.status === 429) {
      throw new Error("RATE_LIMITED");
    }
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

// Copy translated text to clipboard
copyBtn.addEventListener("click", () => {
  const text = outputText.textContent;
  if (text && text !== "Translation will appear here") {
    navigator.clipboard.writeText(text);
  }
});

// Photo/document text capture (OCR)
// NOTE: this reads text well from clear, printed ENGLISH. Handwriting,
// blurry photos, and local-language text on paper will likely read
// poorly or incorrectly - a real limitation of free OCR tools today,
// same kind of gap we've hit with voice for local languages.
photoBtn.addEventListener("click", () => {
  photoInput.click();
});

// Shrinks a photo down before OCR - full-size camera photos can take
// Tesseract a very long time to process directly on a phone, since all
// the work happens locally in the browser, not on a fast server.
function resizeImageForOCR(file, maxDimension = 1500) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(img.src);
        blob ? resolve(blob) : reject(new Error("Couldn't process image"));
      }, "image/jpeg", 0.9);
    };
    img.onerror = () => reject(new Error("Couldn't load image"));
    img.src = URL.createObjectURL(file);
  });
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  if (!file) return;

  inputText.value = "Reading text from photo...";
  photoBtn.disabled = true;

  try {
    const resizedImage = await resizeImageForOCR(file);

    // If OCR takes longer than 25 seconds, stop waiting and show a
    // clear message instead of leaving the user staring at nothing.
    const ocrPromise = Tesseract.recognize(resizedImage, "eng");
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), 25000)
    );

    const result = await Promise.race([ocrPromise, timeoutPromise]);
    const text = result.data.text.trim();
    const confidence = result.data.confidence; // 0-100, how sure Tesseract is

    // Below this, results are usually garbled nonsense rather than real text -
    // better to ask for a clearer photo than show broken text.
    const MIN_CONFIDENCE = 60;

    // A second, independent check: real sentences are mostly letters and
    // spaces. Symbol-heavy gibberish can still score a high confidence from
    // Tesseract, so this catches cases the confidence score alone misses.
    const letterCount = (text.match(/[a-zA-Z\s]/g) || []).length;
    const looksLikeRealText = text.length > 0 && (letterCount / text.length) > 0.75;

    if (!text || confidence < MIN_CONFIDENCE || !looksLikeRealText) {
      inputText.value = "";
      showMessage("Couldn't read that clearly - try a closer, clearer photo.");
    } else {
      inputText.value = text;
    }
  } catch (err) {
    inputText.value = "";
    showMessage(err.message === "TIMEOUT"
      ? "That's taking too long - try a smaller or clearer photo."
      : "Couldn't read that photo - please try again.");
  } finally {
    photoBtn.disabled = false;
    photoInput.value = ""; // allow selecting the same file again later
  }
});
