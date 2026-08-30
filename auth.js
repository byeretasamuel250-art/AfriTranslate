// Handles registration and login using Supabase Auth.
// The app only asks people for a NAME and a 6-character PASSWORD -
// Supabase Auth needs something that looks like an email address behind
// the scenes, so we build one automatically from the name (e.g. "John Doe"
// becomes "john_doe@afritranslate.local"). People never see or type this -
// it's just how we plug into Supabase's built-in, secure password handling
// without having to store or check passwords ourselves.

const SUPABASE_URL = "https://ntuhsfipdqdfanxuosdn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_b8OQ4BmWzhHv29gMrOTU6g_RiWx4eIj";

// The Supabase library (loaded via the script tag in index.html) exposes
// itself as a global called "supabase" - we immediately use that to create
// our own client, then reuse the "supabase" name for our client below,
// same pattern Supabase's own docs use.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const authScreen = document.getElementById("authScreen");
const appScreen = document.getElementById("appScreen");
const authName = document.getElementById("authName");
const authPassword = document.getElementById("authPassword");
const authError = document.getElementById("authError");
const registerBtn = document.getElementById("registerBtn");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");

// Turns a plain name into the fake email Supabase Auth needs internally.
// Lowercased and spaces removed, so "John Doe" and "john doe" are treated
// as the same account (avoids confusing duplicate-name mixups).
function nameToEmail(name) {
  return name.trim().toLowerCase().replace(/\s+/g, "_") + "@afritranslate.local";
}

function showAuthError(message) {
  authError.textContent = message;
  authError.style.display = "block";
}

function clearAuthError() {
  authError.style.display = "none";
}

// Checks the name and password are filled in and the password is exactly
// 6 characters, before we even contact Supabase.
function validateInputs() {
  const name = authName.value.trim();
  const password = authPassword.value;

  if (!name) {
    showAuthError("Enter your name.");
    return null;
  }
  if (password.length !== 6) {
    showAuthError("Password must be exactly 6 characters.");
    return null;
  }
  return { name, password };
}

registerBtn.addEventListener("click", async () => {
  clearAuthError();
  const inputs = validateInputs();
  if (!inputs) return;

  registerBtn.disabled = true;
  loginBtn.disabled = true;

  const { error } = await supabaseClient.auth.signUp({
    email: nameToEmail(inputs.name),
    password: inputs.password,
    options: {
      data: { display_name: inputs.name } // keeps the real name on the account
    }
  });

  registerBtn.disabled = false;
  loginBtn.disabled = false;

  if (error) {
    if (error.message.toLowerCase().includes("already registered")) {
      showAuthError("That name is already taken - try logging in instead.");
    } else if (error.message.toLowerCase().includes("password")) {
      showAuthError("Password must be exactly 6 characters.");
    } else {
      showAuthError("Couldn't register - please try again.");
    }
    return;
  }

  showApp();
});

loginBtn.addEventListener("click", async () => {
  clearAuthError();
  const inputs = validateInputs();
  if (!inputs) return;

  loginBtn.disabled = true;
  registerBtn.disabled = true;

  const { error } = await supabaseClient.auth.signInWithPassword({
    email: nameToEmail(inputs.name),
    password: inputs.password
  });

  loginBtn.disabled = false;
  registerBtn.disabled = false;

  if (error) {
    showAuthError("Incorrect name or password.");
    return;
  }

  showApp();
});

logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  showAuthScreen();
});

function showApp() {
  authScreen.style.display = "none";
  appScreen.style.display = "block";
}

function showAuthScreen() {
  appScreen.style.display = "none";
  authScreen.style.display = "block";
  authName.value = "";
  authPassword.value = "";
  clearAuthError();
}

// On page load, check whether the browser already has a signed-in session
// (from a previous visit) so people don't have to log in every single time.
(async () => {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    showApp();
  } else {
    showAuthScreen();
  }
})();
