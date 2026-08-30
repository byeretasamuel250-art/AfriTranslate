// Offline phrasebook - common phrases with pre-written translations.
// These work with NO internet connection at all, since nothing here
// calls the translation API - it's just a fixed list built into the app.
//
// ACCURACY NOTE: these translations were written by an AI assistant, not
// verified by a native speaker of each language. Confidence is highest
// for eng/swa/lug (well-documented languages), lower for nyn/kin/ach.
// Before relying on these in production, it's worth having a native
// speaker of each language spot-check this list.
//
// To add a language: add its code as a key inside each phrase below.
// To add a phrase: copy one of the blocks and fill in translations for
// the languages you have. Leave out a language's key entirely for a
// phrase you don't have a confident translation for yet - the lookup
// function below already handles missing languages gracefully.

const OFFLINE_PHRASES = [
  {
    eng: "Hello",
    lug: "Gyebaleko",
    swa: "Habari",
    kin: "Muraho",
    nyn: "Agandi",
    ach: "Itye nining"
  },
  {
    eng: "Good morning",
    lug: "Wasuze otya",
    swa: "Habari ya asubuhi",
    kin: "Mwaramutse",
    nyn: "Waasibire ota",
    ach: "Ibedo maber"
  },
  {
    eng: "Good night",
    lug: "Sula bulungi",
    swa: "Usiku mwema",
    kin: "Ijoro ryiza",
    nyn: "Orare gye"
  },
  {
    eng: "Thank you",
    lug: "Webale",
    swa: "Asante",
    kin: "Murakoze",
    nyn: "Webale",
    ach: "Apwoyo"
  },
  {
    eng: "Thank you very much",
    lug: "Webale nnyo",
    swa: "Asante sana",
    kin: "Murakoze cyane",
    nyn: "Webale muno"
  },
  {
    eng: "How are you?",
    lug: "Oli otya?",
    swa: "Habari yako?",
    kin: "Amakuru?",
    nyn: "Ori ota?",
    ach: "In nining?"
  },
  {
    eng: "I am fine",
    lug: "Ndi bulungi",
    swa: "Nzuri",
    kin: "Ndi mezi",
    nyn: "Ndikurungi"
  },
  {
    eng: "Yes",
    lug: "Yee",
    swa: "Ndiyo",
    kin: "Yego",
    nyn: "Nija",
    ach: "Eyo"
  },
  {
    eng: "No",
    lug: "Nedda",
    swa: "Hapana",
    kin: "Oya",
    nyn: "Ng'oshi",
    ach: "Pe"
  },
  {
    eng: "How much is this?",
    lug: "Bbeeyi mmeka?",
    swa: "Bei gani?",
    kin: "Ni angahe?",
    nyn: "Bbeeyi mmeka?",
    ach: "Pini mene?"
  },
  {
    eng: "Where is...?",
    lug: "...eri ludda wa?",
    swa: "...iko wapi?",
    kin: "...ri he?",
    nyn: "...kuri ha?",
    ach: "...tye kwene?"
  },
  {
    eng: "Please",
    lug: "Nkusaba",
    swa: "Tafadhali",
    kin: "Nyabuneka",
    nyn: "Nkushaba",
    ach: "Akwaa"
  },
  {
    eng: "Sorry",
    lug: "Nsonyiwa",
    swa: "Samahani",
    kin: "Mbabarira",
    nyn: "Nsaasira",
    ach: "Atim marac"
  },
  {
    eng: "Excuse me",
    lug: "Nsonyiwa",
    swa: "Samahani",
    kin: "Mbabarira"
  },
  {
    eng: "I don't understand",
    lug: "Sitegedde",
    swa: "Sielewi",
    kin: "Simvuze"
  },
  {
    eng: "What is your name?",
    lug: "Erinnya lyo ggwe ani?",
    swa: "Jina lako nani?",
    kin: "Witwa nde?"
  },
  {
    eng: "My name is...",
    lug: "Erinnya lyange ye...",
    swa: "Jina langu ni...",
    kin: "Nitwa..."
  },
  {
    eng: "Water",
    lug: "Amazzi",
    swa: "Maji",
    kin: "Amazi",
    nyn: "Amaizi",
    ach: "Pii"
  },
  {
    eng: "Food",
    lug: "Emmere",
    swa: "Chakula",
    kin: "Ibiryo"
  },
  {
    eng: "Help",
    lug: "Nyamba",
    swa: "Msaada",
    kin: "Mfasha",
    nyn: "Ndeteera obuhwezi",
    ach: "Kony"
  },
  {
    eng: "Goodbye",
    lug: "Weeraba",
    swa: "Kwaheri",
    kin: "Murabeho",
    nyn: "Nija kubona",
    ach: "Oriti"
  }
];

// Looks up the offline translation for a phrase in a given language.
// Returns null if this phrase or language isn't in the offline list -
// the caller then falls back to the real Sunbird API automatically.
function getOfflinePhrase(phrase, langCode) {
  const entry = OFFLINE_PHRASES.find(
    (p) => p.eng.toLowerCase() === phrase.toLowerCase()
  );
  return entry ? entry[langCode] || null : null;
}
