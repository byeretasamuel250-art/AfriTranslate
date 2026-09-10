// Afrischool - admin dashboard logic
// Reuses the same signed-in Supabase session as the main app (supabaseClient
// comes from auth.js, loaded before this file). Every request here carries
// that session token; the server independently re-checks is_admin on each
// call, so this page can't be used to gain access it wasn't already granted.

const loadingMsg = document.getElementById("loadingMsg");
const deniedMsg = document.getElementById("deniedMsg");
const dashboard = document.getElementById("dashboard");
const userCount = document.getElementById("userCount");
const errorMsg = document.getElementById("errorMsg");
const usersTableBody = document.getElementById("usersTableBody");
const copyPhonesBtn = document.getElementById("copyPhonesBtn");
const userSearch = document.getElementById("userSearch");

// allUsers: everything the server returned, untouched.
// currentUsers: whatever's actually on screen right now (all of allUsers,
// or a filtered subset if a search term is active) - this is what
// "Copy all phone numbers" and userCount always reflect, so copying
// after a search only grabs the people who matched it.
let allUsers = [];
let currentUsers = [];

async function authHeaders() {
  const { data } = await supabaseClient.auth.getSession();
  const token = data.session ? data.session.access_token : null;
  const sessionId = localStorage.getItem("afriSessionId");
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  if (sessionId) headers["X-Session-Id"] = sessionId;
  return headers;
}

function showError(text) {
  errorMsg.textContent = text;
  errorMsg.style.display = "block";
}

function formatDate(iso) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

function renderUsers(users) {
  currentUsers = users;
  userCount.textContent = users.length;
  usersTableBody.innerHTML = "";

  for (const user of users) {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${user.name ? escapeHtml(user.name) : "<span class=\"muted\">-</span>"}</td>
      <td>${user.phone ? escapeHtml(user.phone) : "<span class=\"muted\">-</span>"}</td>
      <td>${escapeHtml(user.email || "")}</td>
      <td>${formatDate(user.created_at)}</td>
      <td>${formatDate(user.last_sign_in_at)}</td>
      <td>${user.banned ? "<span class=\"badge banned\">Banned</span>" : "<span class=\"badge active\">Active</span>"}</td>
      <td></td>
    `;

    const actionCell = row.lastElementChild;
    const btn = document.createElement("button");
    btn.textContent = user.banned ? "Unban" : "Ban";
    btn.className = user.banned ? "action-btn unban" : "action-btn ban";
    btn.addEventListener("click", () => toggleBan(user, btn));
    actionCell.appendChild(btn);

    usersTableBody.appendChild(row);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function applyFilter() {
  const term = userSearch.value.trim().toLowerCase();

  if (!term) {
    renderUsers(allUsers);
    return;
  }

  const filtered = allUsers.filter((user) => {
    const name = (user.name || "").toLowerCase();
    const phone = (user.phone || "").toLowerCase();
    const email = (user.email || "").toLowerCase();
    return name.includes(term) || phone.includes(term) || email.includes(term);
  });

  renderUsers(filtered);
}

userSearch.addEventListener("input", applyFilter);

async function toggleBan(user, btn) {
  const nextBanned = !user.banned;
  const confirmMsg = nextBanned
    ? `Ban ${user.name || user.email}? They won't be able to sign in.`
    : `Unban ${user.name || user.email}?`;

  if (!confirm(confirmMsg)) return;

  btn.disabled = true;

  try {
    const response = await fetch("/api/admin/set-user-banned", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ user_id: user.id, banned: nextBanned })
    });

    const data = await response.json();

    if (isSessionConflict(response, data)) return;

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    await loadUsers();
  } catch (err) {
    showError("Couldn't update that user: " + err.message);
    btn.disabled = false;
  }
}

async function loadUsers() {
  errorMsg.style.display = "none";

  try {
    const response = await fetch("/api/admin/users", {
      headers: await authHeaders()
    });

    if (response.status === 404) {
      // requireAdmin returns 404 for non-admins - treat as access denied.
      loadingMsg.style.display = "none";
      deniedMsg.style.display = "block";
      return;
    }

    const data = await response.json();

    if (isSessionConflict(response, data)) return;

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    loadingMsg.style.display = "none";
    dashboard.style.display = "block";
    allUsers = data.users;
    applyFilter();
  } catch (err) {
    loadingMsg.style.display = "none";
    dashboard.style.display = "block";
    showError("Couldn't load users: " + err.message);
  }
}

copyPhonesBtn.addEventListener("click", async () => {
  // One number per line - pasting this straight into WhatsApp (or
  // anywhere else) keeps each number on its own line, which is the
  // easiest shape to work with when adding people to a group.
  const numbers = currentUsers
    .map((u) => u.phone)
    .filter(Boolean);

  if (!numbers.length) {
    showError("No phone numbers to copy yet.");
    return;
  }

  try {
    await navigator.clipboard.writeText(numbers.join("\n"));
    const original = copyPhonesBtn.textContent;
    copyPhonesBtn.textContent = `Copied ${numbers.length} numbers!`;
    setTimeout(() => {
      copyPhonesBtn.textContent = original;
    }, 2000);
  } catch (err) {
    showError("Couldn't copy to clipboard - please copy the numbers manually.");
  }
});

// Wait for the Supabase session to be ready before checking admin access.
(async function init() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    loadingMsg.style.display = "none";
    deniedMsg.style.display = "block";
    return;
  }
  await loadUsers();
})();
