// This runs on Vercel's server, NOT in the browser.
// Lists every registered user for the admin dashboard: sign-up date,
// last sign-in, and whether they're currently banned. Only accessible
// to signed-in admins (see requireAdmin).
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "../_lib/admin.js";

const supabaseAdmin = createClient(
  "https://ntuhsfipdqdfanxuosdn.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Supabase's admin listUsers is paginated. This walks every page rather
// than assuming everyone fits on page 1 - fine for the user counts this
// app is likely to have, but keeps working correctly as it grows.
async function listAllAuthUsers() {
  const perPage = 200;
  let page = 1;
  let allUsers = [];

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    allUsers = allUsers.concat(data.users);

    if (data.users.length < perPage) break;
    page++;
  }

  return allUsers;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET requests allowed" });
  }

  const admin = await requireAdmin(req, res, supabaseAdmin);
  if (!admin) return; // requireAdmin already sent the error response

  try {
    const authUsers = await listAllAuthUsers();

    // Pull names in one query rather than one per user.
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, name, is_admin");

    if (profilesError) {
      return res.status(500).json({ error: "Couldn't load profile names." });
    }

    const nameById = new Map((profiles || []).map((p) => [p.id, p]));

    const users = authUsers.map((u) => {
      const profile = nameById.get(u.id);
      return {
        id: u.id,
        name: profile ? profile.name : null,
        email: u.email,
        is_admin: profile ? !!profile.is_admin : false,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        // Supabase marks a ban with a far-future banned_until timestamp.
        banned: !!u.banned_until && new Date(u.banned_until) > new Date()
      };
    });

    // Most recent sign-ups first - the most useful default view.
    users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.status(200).json({ users });
  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
