// Shared by every admin API route (api/admin/*.js).
// Builds on requireUser: first confirms the request comes from a real,
// signed-in AfriTranslate user, then checks that user's profiles row for
// is_admin = true. Only proceeds if both checks pass.
import { requireUser } from "./auth.js";

export async function requireAdmin(req, res, supabaseAdmin) {
  const user = await requireUser(req, res, supabaseAdmin);
  if (!user) return null; // requireUser already sent the 401 response

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: "Couldn't verify admin access - please try again." });
    return null;
  }

  if (!profile || !profile.is_admin) {
    // Deliberately the same "not found"-style response an attacker would
    // get for a route that doesn't exist - don't confirm this endpoint
    // exists to a signed-in non-admin poking at it.
    res.status(404).json({ error: "Not found" });
    return null;
  }

  return user;
}
