// This runs on Vercel's server, NOT in the browser.
//
// WHY THIS EXISTS: registration (auth.js) signs the user in immediately
// via supabaseClient.auth.signUp() and then shows the app - but until
// now, nothing ever wrote a row to active_sessions for that brand-new
// account (only api/login.js did that, on a real login). The very next
// protected request after registration (subscription-status, fired by
// the "app:shown" event) would then find NO active_sessions row at all
// for this user and - since requireUser in _lib/auth.js treats "no
// session recorded yet" the same as "a more recent login happened
// elsewhere" - it incorrectly booted the freshly-registered account
// straight back out with a "signed in on another device" message, even
// though no other device was involved.
//
// This endpoint closes that gap: called once, right after signUp()
// succeeds, with that session's own access token. It verifies the token
// and writes the same kind of active_sessions row login.js would have
// written, so the account's very first protected request already has a
// valid session to match against.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const SUPABASE_URL = "https://ntuhsfipdqdfanxuosdn.supabase.co";

// SERVICE ROLE client: needed to verify an arbitrary user's token and to
// write directly to active_sessions (RLS on that table intentionally
// allows no client access at all - see supabase-setup notes). Never sent
// to the browser.
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: "Please sign in first." });
  }

  // Deliberately NOT using requireUser from _lib/auth.js here - that
  // helper's whole job is to check the request against an EXISTING
  // active_sessions row, which is exactly what doesn't exist yet at
  // this point. This endpoint's only job is to create that first row.
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  const sessionId = randomUUID();
  const { error: sessionError } = await supabaseAdmin
    .from("active_sessions")
    .upsert({ user_id: data.user.id, session_id: sessionId, updated_at: new Date().toISOString() });

  if (sessionError) {
    console.error("Failed to establish session after registration:", sessionError.message);
    return res.status(500).json({ error: "Couldn't start your session - please try logging in." });
  }

  return res.status(200).json({ session_id: sessionId });
}
