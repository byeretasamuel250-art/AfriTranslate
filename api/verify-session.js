// Shared by every protected API route (translate, speech-to-text,
// text-to-speech). Verifies that the request came from someone with a
// real, currently-valid AfriTranslate session - not just anyone who
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

  return data.user;
}
