// Shared by every protected API route (translate, speech-to-text,
// text-to-speech). Verifies that the request came from someone with a
// real, currently-valid Afrischool session - not just anyone who
// knows the endpoint URL.
//
// The browser sends its Supabase session token as a normal
// "Authorization: Bearer <token>" header (see attachAuthHeader in
// app.js). We verify that token using the SERVICE ROLE client (passed
// in from the calling route), since only the service role key can
// validate an arbitrary user's token server-side.
//
// This file is named with a leading underscore and lives outside any
// route folder so Vercel doesn't treat it as its own API endpoint - it's
// a plain shared module, not a page.
export async function requireUser(req, res, supabaseAdmin) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    res.status(401).json({ error: "Please sign in to use this feature." });
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    res.status(401).json({ error: "Your session has expired - please sign in again." });
    return null;
  }

  // --- Single active session ---
  // Only one device may be signed in at a time per account. Each
  // successful login (see api/login.js) writes a fresh session_id into
  // the active_sessions table and hands that id to the browser that just
  // logged in. Every request after that must send the SAME session_id
  // back (as the X-Session-Id header) - if someone logs in with the same
  // shared name+password on a second device, THAT login overwrites the
  // row with a new id, which immediately invalidates the first device's
  // old id. This is what actually stops a shared password from letting
  // two people use a paid account at once, rather than just relying on
  // the honor system.
  const sessionId = req.headers["x-session-id"] || "";

  const { data: activeSession, error: sessionError } = await supabaseAdmin
    .from("active_sessions")
    .select("session_id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (sessionError) {
    // If this check itself is broken, fail open rather than locking
    // everyone out over an outage in a secondary feature.
    console.error("Session check failed:", sessionError.message);
    return data.user;
  }

  if (!activeSession || activeSession.session_id !== sessionId) {
    res.status(401).json({
      error: "This account was signed in on another device. Please sign in again.",
      session_conflict: true
    });
    return null;
  }

  return data.user;
}
