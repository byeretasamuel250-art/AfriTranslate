// Handles registration, login, logout, and password reset using Supabase
// Auth. People sign in with just a NAME and a 6-character PASSWORD - the
// email they give at registration is only ever used behind the scenes to
// send a password-reset link. Supabase Auth itself needs a real email
// internally, and a "profiles" table (set up separately in Supabase, see
// supabase-setup.sql) lets us look up "what email goes with this name?"
// for both login and password reset.

const SUPABASE_URL = "https://ntuhsfipdqdfanxuosdn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_b8OQ4BmWzhHv29gMrOTU6g_RiWx4eIj";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const authScreen = document.getElementById("authScreen");
const forgotScreen = document.getElementById("forgotScreen");
const resetScreen = document.getElementById("resetScreen");
const appScreen = document.getElementById("appScreen");

const authName = document.getElementById("authName");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authError = document.getElementById("authError");
const registerBtn = document.getElementById("registerBtn");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");
const authModeToggle = document.getElementById("authModeToggle");

const forgotName = document.getElementById("forgotName");
const forgotError = document.getElementById("forgotError");
const forgotSuccess = document.getElementById("forgotSuccess");
const sendResetBtn = document.getElementById("sendResetBtn");
const backToLoginBtn = document.getElementById("backToLoginBtn");

const newPassword = document.getElementById("newPassword");
const resetError = document.getElementById("resetError");
const setNewPasswordBtn = document.getElementById("setNewPasswordBtn");

function showAuthError(message) {
  authError.textContent = message;
  authError.style.display = "block";
}
function clearAuthError() {
  authError.style.display = "none";
}

// Looks up the real email behind a name via the get_email_for_name
// database function (see supabase-setup.sql) - the app never has direct
// read access to everyone's emails, only this one-name-at-a-time lookup.
async function lookUpEmail(name) {
  const { data, error } = await supabaseClient.rpc("get_email_for_name", { p_name: name });
  if (error) return null;
  return data || null;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --- Switch between "Log In" and "Register" modes ---
// Login mode (the default) only needs a name and password. Register mode
// also shows the email field, since that's only collected for password
// recovery - people logging in never need to see or enter it.
let isRegisterMode = false;

function setAuthMode(registerMode) {
  isRegisterMode = registerMode;
  authEmail.style.display = registerMode ? "block" : "none";
  registerBtn.style.display = registerMode ? "block" : "none";
  loginBtn.style.display = registerMode ? "none" : "block";
  forgotPasswordLink.style.display = registerMode ? "none" : "block";
  authModeToggle.textContent = registerMode ? "Already have an account? Log In" : "New here? Register";
  clearAuthError();
}

authModeToggle.addEventListener("click", () => setAuthMode(!isRegisterMode));

// --- Register ---
registerBtn.addEventListener("click", async () => {
  clearAuthError();
  const name = authName.value.trim();
  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!name) return showAuthError("Enter your name.");
  if (!isValidEmail(email)) return showAuthError("Enter a valid email address.");
  if (password.length !== 6) return showAuthError("Password must be exactly 6 characters.");

  registerBtn.disabled = true;
  loginBtn.disabled = true;

  // Check the name isn't already taken before creating the account.
  const existingEmail = await lookUpEmail(name);
  if (existingEmail) {
    registerBtn.disabled = false;
    loginBtn.disabled = false;
    return showAuthError("That name is already taken - try logging in instead.");
  }

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { display_name: name } }
  });

  if (error) {
    registerBtn.disabled = false;
    loginBtn.disabled = false;
    if (error.message.toLowerCase().includes("already registered")) {
      showAuthError("That email is already registered.");
    } else if (error.message.toLowerCase().includes("password")) {
      showAuthError("Password must be exactly 6 characters.");
    } else {
      showAuthError("Couldn't register - please try again.");
    }
    return;
  }

  // Save the name-to-email mapping now that the account (and its session)
  // exists.
  const { error: profileError } = await supabaseClient
    .from("profiles")
    .insert({ id: data.user.id, name, email });

  registerBtn.disabled = false;
  loginBtn.disabled = false;

  if (profileError) {
    showAuthError("Registered, but couldn't save your name - please contact support.");
    return;
  }

  showApp();
});

// --- Log in ---
loginBtn.addEventListener("click", async () => {
  clearAuthError();
  const name = authName.value.trim();
  const password = authPassword.value;

  if (!name || !password) return showAuthError("Enter your name and password.");

  loginBtn.disabled = true;
  registerBtn.disabled = true;

  const email = await lookUpEmail(name);
  if (!email) {
    loginBtn.disabled = false;
    registerBtn.disabled = false;
    return showAuthError("Incorrect name or password.");
  }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  loginBtn.disabled = false;
  registerBtn.disabled = false;

  if (error) {
    showAuthError("Incorrect name or password.");
    return;
  }

  showApp();
});

// --- Log out ---
logoutBtn.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  showAuthScreen();
});

// --- Forgot password ---
forgotPasswordLink.addEventListener("click", () => {
  clearAuthError();
  forgotName.value = authName.value; // carry over whatever they'd already typed
  forgotError.style.display = "none";
  forgotSuccess.style.display = "none";
  authScreen.style.display = "none";
  forgotScreen.style.display = "block";
});

backToLoginBtn.addEventListener("click", () => {
  forgotScreen.style.display = "none";
  authScreen.style.display = "block";
});

sendResetBtn.addEventListener("click", async () => {
  forgotError.style.display = "none";
  forgotSuccess.style.display = "none";

  const name = forgotName.value.trim();
  if (!name) {
    forgotError.textContent = "Enter your name.";
    forgotError.style.display = "block";
    return;
  }

  sendResetBtn.disabled = true;
  const email = await lookUpEmail(name);

  if (!email) {
    sendResetBtn.disabled = false;
    // Deliberately vague, same as a login failure - doesn't confirm or
    // deny whether that name has an account.
    forgotError.textContent = "If that name has an account, a reset link will be sent.";
    forgotError.style.display = "block";
    return;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });

  sendResetBtn.disabled = false;

  if (error) {
    forgotError.textContent = "Couldn't send reset link - please try again.";
    forgotError.style.display = "block";
    return;
  }

  forgotSuccess.style.display = "block";
});

// --- Reset password (after clicking the emailed link) ---
setNewPasswordBtn.addEventListener("click", async () => {
  resetError.style.display = "none";

  if (newPassword.value.length !== 6) {
    resetError.textContent = "Password must be exactly 6 characters.";
    resetError.style.display = "block";
    return;
  }

  setNewPasswordBtn.disabled = true;
  const { error } = await supabaseClient.auth.updateUser({ password: newPassword.value });
  setNewPasswordBtn.disabled = false;

  if (error) {
    resetError.textContent = "Couldn't set new password - please try again.";
    resetError.style.display = "block";
    return;
  }

  newPassword.value = "";
  showApp();
});

// Supabase fires this when someone lands back on the app via a password
// reset link - that's our cue to show the "choose a new password" screen.
supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    authScreen.style.display = "none";
    forgotScreen.style.display = "none";
    appScreen.style.display = "none";
    resetScreen.style.display = "block";
  }
});

function showApp() {
  authScreen.style.display = "none";
  forgotScreen.style.display = "none";
  resetScreen.style.display = "none";
  appScreen.style.display = "block";
}

function showAuthScreen() {
  appScreen.style.display = "none";
  forgotScreen.style.display = "none";
  resetScreen.style.display = "none";
  authScreen.style.display = "block";
  authName.value = "";
  authEmail.value = "";
  authPassword.value = "";
  setAuthMode(false);
  clearAuthError();
}

// On page load, check whether there's already a signed-in session (unless
// this load is actually a password-recovery link, which the listener
// above handles instead).
(async () => {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session && !window.location.hash.includes("type=recovery")) {
    showApp();
  } else if (!window.location.hash.includes("type=recovery")) {
    showAuthScreen();
  }
})();
