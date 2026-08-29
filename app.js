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

// Clear error message when user types
inputText.addEventListener("input", () => {
  errorMsg.style.display = "none";
});

// Main translate button
translateBtn.addEventListener("click", async () => {
  const text = inputText.value.trim();

  if (!text) {
    errorMsg.textContent = "Type something first";
    errorMsg.style.display = "block";
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
    errorMsg.textContent = "Something went wrong. Please try again.";
    errorMsg.style.display = "block";
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
// NOTE: the browser's built-in voice recognition only understands major
// world languages. It works for English and Swahili, but NOT for Luganda,
// Runyankole, or the other local languages - those will need a different
// approach (Sunbird's own voice service) as a later step.
const VOICE_INPUT_LANGS = { eng: "en-US", swa: "sw-KE" };

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

micBtn.addEventListener("click", () => {
  const langCode = VOICE_INPUT_LANGS[srcLang.value];

  if (!langCode) {
    errorMsg.textContent = "Voice input isn't available for this language yet - try typing instead.";
    errorMsg.style.display = "block";
    return;
  }

  if (!SpeechRecognition) {
    errorMsg.textContent = "Voice input isn't supported in this browser.";
    errorMsg.style.display = "block";
    return;
  }

  errorMsg.style.display = "none";
  const recognition = new SpeechRecognition();
  recognition.lang = langCode;
  recognition.interimResults = false;

  inputText.placeholder = "Listening...";
  micBtn.disabled = true;

  recognition.onresult = (event) => {
    inputText.value = event.results[0][0].transcript;
  };

  recognition.onerror = () => {
    errorMsg.textContent = "Didn't catch that - please try again.";
    errorMsg.style.display = "block";
  };

  recognition.onend = () => {
    inputText.placeholder = "Type or speak here...";
    micBtn.disabled = false;
  };

  recognition.start();
});

// Text-to-speech (speaker button) - placeholder for now
speakBtn.addEventListener("click", () => {
  // Later: play back audio of the translated text
});

// Copy translated text to clipboard
copyBtn.addEventListener("click", () => {
  const text = outputText.textContent;
  if (text && text !== "Translation will appear here") {
    navigator.clipboard.writeText(text);
  }
});
