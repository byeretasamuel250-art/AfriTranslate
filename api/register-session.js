// This runs on Vercel's server, NOT in the browser.
//
// WHY THIS EXISTS: /api/login.js is the only place that writes a row into
// active_sessions. That's fine for a normal name+password login, but there
// is one other place a browser tab can end up with a valid, signed-in
// Supabase session without ever calling /api/login: finishing a password
// reset (auth.js's setNewPasswordBtn handler calls supabaseClient.auth.
// updateUser() directly against Supabase, using the recovery-link session).
//
// Without this endpoint, that tab has a real access token but no matching
// active_sessions row and no afriSessionId in localStorage. The very next
// protected request it makes (e.g. subscription-status, right after
// showApp() fires "app:shown") gets rejected by requireUser() as a
// "signed in on another device" conflict - even though nothing conflicting
// actually happened - and the person is immediately signed back out.
//
// This endpoint lets any tab holding a currently-valid access token
// register/overwrite the single active_sessions row for its own account,
// exactly like login.js does, so the reset flow can put itself in the
// same state a normal login would.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const SUPABASE_URL = "https://ntuhsfipdqdfanxuosdn.supabase.co";

// SERVICE ROLE client: needed to verify an arbitrary user's token and to
// write active_sessions regardless of RLS. Never sent to the browser.
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: "Please sign in to use this feature." });
  }

  // Deliberately does NOT go through requireUser() - that function
  // enforces the single-active-session check itself, which is exactly
  // what this endpoint exists to (re)establish. Here we only need to
  // confirm the token is a genuine, currently-valid Supabase session for
  // some user - who that session belongs to and whether it's "the"
  // session doesn't matter yet, because this call is what decides that.
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ error: "Your session has expired - please sign in again." });
  }

  // Same as the "--- Single active session ---" block in login.js:
  // overwrite this account's one allowed session with a brand-new id,
  // signing out any other device that still holds an older one.
  const sessionId = randomUUID();
  const { error: sessionError } = await supabaseAdmin
    .from("active_sessions")
    .upsert({ user_id: data.user.id, session_id: sessionId, updated_at: new Date().toISOString() });

  if (sessionError) {
    console.error("Failed to record active session:", sessionError.message);
    return res.status(500).json({ error: "Couldn't finish signing in - please try again." });
  }

  return res.status(200).json({ session_id: sessionId });
}
