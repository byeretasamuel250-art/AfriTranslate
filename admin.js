// AfriTranslate - admin dashboard logic
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

async function authHeaders() {
  const { data } = await supabaseClient.auth.getSession();
  const token = data.session ? data.session.access_token : null;
  return token ? { "Authorization": "Bearer " + token } : {};
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
  userCount.textContent = users.length;
  usersTableBody.innerHTML = "";

  for (const user of users) {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${user.name ? escapeHtml(user.name) : "<span class=\"muted\">-</span>"}</td>
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

    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    loadingMsg.style.display = "none";
    dashboard.style.display = "block";
    renderUsers(data.users);
  } catch (err) {
    loadingMsg.style.display = "none";
    dashboard.style.display = "block";
    showError("Couldn't load users: " + err.message);
  }
}

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
