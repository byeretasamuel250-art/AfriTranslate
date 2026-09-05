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

// Attaches the current Supabase session token to a request, so our own
// backend (translate.js, speech-to-text.js) can verify this call is
// coming from someone actually signed in, not just anyone who found the
// URL. supabaseClient is defined in auth.js, loaded before this file.
async function authHeaders() {
  const { data } = await supabaseClient.auth.getSession();
  const token = data.session ? data.session.access_token : null;
  return token ? { "Authorization": "Bearer " + token } : {};
}

// --- Subscription banner + payment ---
const subBanner = document.getElementById("subBanner");
const subBannerText = document.getElementById("subBannerText");
const subBannerBtn = document.getElementById("subBannerBtn");
const subModalOverlay = document.getElementById("subModalOverlay");
const subModalError = document.getElementById("subModalError");
const subModalConfirmBtn = document.getElementById("subModalConfirmBtn");
const subModalCancelBtn = document.getElementById("subModalCancelBtn");

function formatSubDate(isoString) {
  return new Date(isoString).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// Checks the signed-in user's subscription and updates the banner at
// the top of the app accordingly. Called once whenever the app screen
// is shown (see the "app:shown" listener below) - not on a timer, since
// this only needs to be fresh at the moments someone might act on it.
async function refreshSubscriptionBanner() {
  let response, data;
  try {
    response = await fetch("/api/subscription-status", { headers: await authHeaders() });
    data = await response.json();
  } catch (err) {
    // If we can't reach the server, just hide the banner rather than
    // showing something potentially wrong - the subscribe button is
    // still reachable next time the app screen loads.
    subBanner.style.display = "none";
    return;
  }

  if (!response.ok) {
    subBanner.style.display = "none";
    return;
  }

  subBanner.style.display = "flex";
  if (data.active) {
    subBanner.classList.remove("sub-inactive");
    subBannerText.textContent = "Premium until " + formatSubDate(data.current_period_end);
    subBannerBtn.textContent = "Renew";
  } else {
    subBanner.classList.add("sub-inactive");
    subBannerText.textContent = "Free plan";
    subBannerBtn.textContent = "Subscribe";
  }
}

document.addEventListener("app:shown", refreshSubscriptionBanner);

function openSubModal() {
  subModalError.style.display = "none";
  subModalConfirmBtn.disabled = false;
  subModalConfirmBtn.textContent = "Continue to Payment";
  subModalOverlay.style.display = "flex";
}

function closeSubModal() {
  subModalOverlay.style.display = "none";
}

subBannerBtn.addEventListener("click", openSubModal);
subModalCancelBtn.addEventListener("click", closeSubModal);

subModalConfirmBtn.addEventListener("click", async () => {
  subModalError.style.display = "none";
  subModalConfirmBtn.disabled = true;
  subModalConfirmBtn.textContent = "Starting payment...";

  let response, data;
  try {
    response = await fetch("/api/subscribe", {
      method: "POST",
      headers: await authHeaders()
    });
    data = await response.json();
  } catch (err) {
    subModalConfirmBtn.disabled = false;
    subModalConfirmBtn.textContent = "Continue to Payment";
    subModalError.textContent = "Couldn't reach the server - please try again.";
    subModalError.style.display = "block";
    return;
  }

  if (!response.ok || !data.redirect_url) {
    subModalConfirmBtn.disabled = false;
    subModalConfirmBtn.textContent = "Continue to Payment";
    subModalError.textContent = data.error || "Couldn't start payment - please try again.";
    subModalError.style.display = "block";
    return;
  }

  // Send the browser to Pesapal's hosted payment page. They'll be
  // brought back to subscription-callback.html once done.
  window.location.href = data.redirect_url;
});

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
