// This runs on Vercel's server, NOT in the browser.
// Bans or unbans a specific user by ID. Only accessible to signed-in
// admins (see requireAdmin). A banned user's existing sessions stop
// working and they can't sign in again until unbanned.
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "../_lib/admin.js";

const supabaseAdmin = createClient(
  "https://ntuhsfipdqdfanxuosdn.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const admin = await requireAdmin(req, res, supabaseAdmin);
  if (!admin) return;

  const { user_id, banned } = req.body;

  if (!user_id || typeof banned !== "boolean") {
    return res.status(400).json({ error: "Missing user_id or banned (boolean)" });
  }

  // Admins can't ban themselves through this dashboard - avoids anyone
  // accidentally locking themselves out with no other admin to undo it.
  if (user_id === admin.id) {
    return res.status(400).json({ error: "You can't ban your own account." });
  }

  try {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
      // "876000h" (~100 years) is Supabase's documented way to ban
      // indefinitely; "none" clears any existing ban.
      ban_duration: banned ? "876000h" : "none"
    });

    if (error) {
      return res.status(500).json({ error: "Couldn't update user: " + error.message });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}
