// Offline phrasebook - common phrases with pre-written translations.
// These work with NO internet connection at all, since nothing here
// calls the translation API - it's just a fixed list built into the app.
//
// To add a language: add its code as a key inside each phrase below.
// To add a phrase: copy one of the blocks and fill in translations for
// the languages you have.

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
    eng: "Thank you",
    lug: "Webale",
    swa: "Asante",
    kin: "Murakoze",
    nyn: "Webale",
    ach: "Apwoyo"
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
    eng: "Water",
    lug: "Amazzi",
    swa: "Maji",
    kin: "Amazi",
    nyn: "Amaizi",
    ach: "Pii"
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
// Returns null if this phrase or language isn't in the offline list.
function getOfflinePhrase(phrase, langCode) {
  const entry = OFFLINE_PHRASES.find(
    (p) => p.eng.toLowerCase() === phrase.toLowerCase()
  );
  return entry ? entry[langCode] || null : null;
}
