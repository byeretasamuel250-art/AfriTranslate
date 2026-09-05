// Handles registration, login, logout, and password reset using Supabase
// Auth. People sign in with just a NAME and a 6-character PASSWORD - the
// email they give at registration is only ever used behind the scenes to
// send a password-reset link.
//
// SECURITY NOTE: login and password-reset both need to turn a NAME into
// an EMAIL somewhere, since Supabase Auth itself only understands email.
// That lookup now happens entirely on our own server (/api/login and
// /api/request-password-reset) rather than in the browser - the actual
// email address is never sent back to this page. Only the registration
// screen's "is this name already taken?" check still runs from here
// directly, and it now calls a boolean-only check (name_is_taken) that
// can't leak an email address either way.

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

const authPasswordPeek = document.getElementById("authPasswordPeek");
const newPasswordPeek = document.getElementById("newPasswordPeek");

// Lets someone briefly reveal a password field by tapping the eye icon -
// it switches to plain text for a moment, then automatically switches
// back to hidden on its own, so a glance-and-check doesn't leave the
// password sitting visible on screen.
function attachPasswordPeek(inputEl, buttonEl, revealMs = 1200) {
  let hideTimer = null;
  buttonEl.addEventListener("click", () => {
    inputEl.type = "text";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      inputEl.type = "password";
    }, revealMs);
  });
}

attachPasswordPeek(authPassword, authPasswordPeek);
attachPasswordPeek(newPassword, newPasswordPeek);

// --- Login lockout after repeated failed attempts ---
// After 3 wrong passwords in a row, the login button locks for 60 seconds
// with a visible countdown. This is saved in the browser (not just in
// memory), so refreshing the page or closing the tab doesn't reset it.
const MAX_FAILED_LOGINS = 3;
const LOCKOUT_MS = 60 * 1000;
let lockoutInterval = null;

function getLockUntil() {
  return parseInt(localStorage.getItem("loginLockUntil") || "0", 10);
}
function getFailCount() {
  return parseInt(localStorage.getItem("loginFailCount") || "0", 10);
}
function setFailCount(count) {
  localStorage.setItem("loginFailCount", String(count));
}

function startLockoutCountdown() {
  loginBtn.disabled = true;
  clearInterval(lockoutInterval);

  function tick() {
    const secondsLeft = Math.ceil((getLockUntil() - Date.now()) / 1000);
    if (secondsLeft <= 0) {
      clearInterval(lockoutInterval);
      loginBtn.disabled = false;
      setFailCount(0);
      clearAuthError();
      return;
    }
    showAuthError("Too many failed attempts - try again in " + secondsLeft + "s.");
  }

  tick();
  lockoutInterval = setInterval(tick, 1000);
}

// Call this whenever the login screen is shown, in case a lock from an
// earlier visit is still counting down.
function checkExistingLockout() {
  if (getLockUntil() > Date.now()) {
    startLockoutCountdown();
  }
}

function recordFailedLogin() {
  const count = getFailCount() + 1;
  if (count >= MAX_FAILED_LOGINS) {
    localStorage.setItem("loginLockUntil", String(Date.now() + LOCKOUT_MS));
    setFailCount(0);
    startLockoutCountdown();
  } else {
    setFailCount(count);
  }
}

function clearFailedLogins() {
  setFailCount(0);
  localStorage.removeItem("loginLockUntil");
}

function showAuthError(message) {
  authError.textContent = message;
  authError.style.display = "block";
}
function clearAuthError() {
  authError.style.display = "none";
}

// Looks up whether a name is already taken - a boolean-only check, used
// on the registration screen. Unlike the old get_email_for_name lookup,
// this can never expose anyone's actual email address, so it's safe to
// call directly from the browser.
async function isNameTaken(name) {
  const { data, error } = await supabaseClient.rpc("name_is_taken", { p_name: name });
  if (error) return false; // fail open on a broken check - the server-side insert's unique constraint is the real backstop
  return !!data;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Blocks the small set of 6-character passwords someone would guess in
// one or two tries - repeated digits, straight runs, and the keyboard's
// own top row. This doesn't add complexity requirements (people using
// this app may not have a keyboard habit built around symbols/numbers),
// it just closes off the handful of choices that make the "exactly 6
// characters" design meaningfully weaker than it needs to be.
const WEAK_PASSWORDS = new Set([
  "000000", "111111", "222222", "333333", "444444",
  "555555", "666666", "777777", "888888", "999999",
  "123456", "654321", "121212", "112233", "qwerty", "abcdef",
  "password"
]);

function isWeakPassword(password) {
  return WEAK_PASSWORDS.has(password.toLowerCase());
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
  if (isWeakPassword(password)) return showAuthError("That password is too easy to guess - please choose another.");

  registerBtn.disabled = true;
  loginBtn.disabled = true;

  // Check the name isn't already taken before creating the account.
  const nameTaken = await isNameTaken(name);
  if (nameTaken) {
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
    // The auth account above was already created at this point, even
    // though saving the profile failed - so we sign that half-finished
    // session back out rather than silently leaving the browser logged
    // into an account with no profile row (which would otherwise show up
    // as a broken "logged in but stuck" state on the next page load).
    await supabaseClient.auth.signOut();

    // Postgres code 23505 = unique_violation. This is the profiles.name
    // unique constraint - it means someone else grabbed this exact name
    // in the brief window between our earlier availability check and
    // this insert (two people registering the same name at almost the
    // same instant). It's rare, but when it happens the message should
    // say so plainly rather than pointing them at support for something
    // they can just fix themselves by picking a different name.
    if (profileError.code === "23505") {
      showAuthError("That name was just taken by someone else - please choose a different name.");
    } else {
      showAuthError("Registered, but couldn't save your name - please contact support.");
    }
    return;
  }

  showApp();
});

// --- Log in ---
loginBtn.addEventListener("click", async () => {
  clearAuthError();

  if (getLockUntil() > Date.now()) {
    startLockoutCountdown();
    return;
  }

  const name = authName.value.trim();
  const password = authPassword.value;

  if (!name || !password) return showAuthError("Enter your name and password.");

  loginBtn.disabled = true;
  registerBtn.disabled = true;

  // The name-to-email lookup and password check both now happen on our
  // own server (see api/login.js) - the browser only ever gets back
  // session tokens, never the actual email address.
  let response, data;
  try {
    response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password })
    });
    data = await response.json();
  } catch (err) {
    loginBtn.disabled = false;
    registerBtn.disabled = false;
    showAuthError("Couldn't reach the server - please try again.");
    return;
  }

  loginBtn.disabled = false;
  registerBtn.disabled = false;

  if (!response.ok) {
    recordFailedLogin();
    if (getLockUntil() <= Date.now()) {
      showAuthError(response.status === 429 ? data.error : "Incorrect name or password.");
    }
    return;
  }

  // Apply the session tokens the server verified on our behalf, so this
  // browser tab is now signed in exactly as if signInWithPassword had
  // been called directly.
  const { error: setSessionError } = await supabaseClient.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token
  });

  if (setSessionError) {
    showAuthError("Couldn't complete sign-in - please try again.");
    return;
  }

  clearFailedLogins();
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

  // The name-to-email lookup and the actual reset email now both happen
  // server-side (see api/request-password-reset.js) - this browser tab
  // never learns the email address either way.
  let response, data;
  try {
    response = await fetch("/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    data = await response.json();
  } catch (err) {
    sendResetBtn.disabled = false;
    forgotError.textContent = "Couldn't reach the server - please try again.";
    forgotError.style.display = "block";
    return;
  }

  sendResetBtn.disabled = false;

  if (!response.ok) {
    forgotError.textContent = data.error || "Couldn't send reset link - please try again.";
    forgotError.style.display = "block";
    return;
  }

  // Same deliberately-vague message either way - doesn't confirm or deny
  // whether that name has an account.
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

  if (isWeakPassword(newPassword.value)) {
    resetError.textContent = "That password is too easy to guess - please choose another.";
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
  // Lets app.js (loaded after this file) know it's safe to check
  // subscription status now that appScreen - and its banner - is visible.
  document.dispatchEvent(new CustomEvent("app:shown"));
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
  checkExistingLockout();
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
