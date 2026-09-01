// This runs on Vercel's server, NOT in the browser.
//
// WHY THIS EXISTS: people sign in with a NAME, but Supabase Auth needs an
// EMAIL. Previously, the browser looked up "what email goes with this
// name?" via a direct RPC call (get_email_for_name) and then called
// Supabase Auth itself with that email. The problem: that RPC returned
// the real email address straight to the browser - which meant anyone
// could call it directly (it's just a public endpoint) and harvest real
// email addresses one name at a time, with nothing to stop them running
// through a list of common names.
//
// This endpoint does the same lookup, but ENTIRELY server-side: the name
// comes in, the email is looked up and used here to verify the password
// with Supabase Auth, and only the resulting SESSION TOKENS go back to
// the browser - the email address itself never leaves this server.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ntuhsfipdqdfanxuosdn.supabase.co";
// This is the public "publishable"/anon key - the same one auth.js uses
// in the browser. It's safe to have here too since it was never secret;
// only the SERVICE ROLE key above is sensitive.
const SUPABASE_ANON_KEY = "sb_publishable_b8OQ4BmWzhHv29gMrOTU6g_RiWx4eIj";

// SERVICE ROLE client: needed to look up the profiles row (bypassing RLS)
// and to rate-limit login attempts. Never sent to the browser.
const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// A generous cap meant to stop scripted password-guessing, not to
// bother a real person who mistypes a password a few times. Shared
// across everyone from the same IP, so one person locking themselves
// out doesn't block anyone else.
const MAX_ATTEMPTS_PER_WINDOW = 10;
const WINDOW_MINUTES = 5;

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
}

// Reuses the same slot-reservation pattern as the Sunbird rate limiter
// (see translate.js) - a shared Postgres counter, atomic under
// concurrent requests. See supabase-setup.sql for reserve_auth_slot.
async function withinRateLimit(windowKey) {
  const { data: gotSlot, error } = await supabaseAdmin.rpc("reserve_auth_slot", {
    p_window_key: windowKey,
    p_limit: MAX_ATTEMPTS_PER_WINDOW
  });

  if (error) {
    // If the limiter itself is broken, fail open rather than locking
    // everyone out of logging in - same reasoning as the Sunbird queue.
    console.error("Auth rate limit check failed:", error.message);
    return true;
  }

  return gotSlot;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { name, password } = req.body;

  if (!name || !password) {
    return res.status(400).json({ error: "Enter your name and password." });
  }

  const ip = getClientIp(req);
  const windowBucket = Math.floor(Date.now() / (WINDOW_MINUTES * 60 * 1000));
  const windowKey = "login:" + ip + ":" + windowBucket;

  const allowed = await withinRateLimit(windowKey);
  if (!allowed) {
    return res.status(429).json({ error: "Too many attempts - please wait a few minutes and try again." });
  }

  // Look up the email for this name. This uses the SAME database
  // function as before (get_email_for_name), but now it's only ever
  // called from here, server-side, with the service role key - the
  // email it returns never gets forwarded to the client.
  const { data: email, error: lookupError } = await supabaseAdmin.rpc("get_email_for_name", { p_name: name });

  // Deliberately identical error whether the name doesn't exist or the
  // password is wrong - same principle as the existing forgot-password
  // flow, so a login attempt can't be used to probe which names exist.
  const genericError = () => res.status(401).json({ error: "Incorrect name or password." });

  if (lookupError || !email) {
    return genericError();
  }

  // Verify the password using a fresh, non-persistent client scoped to
  // this one request - never the shared admin client.
  const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });

  const { data, error: signInError } = await supabaseAuth.auth.signInWithPassword({ email, password });

  if (signInError || !data.session) {
    return genericError();
  }

  // Hand back only the session tokens - the browser uses these to call
  // supabaseClient.auth.setSession(...) and continue as normal. The
  // email address itself was never included anywhere in this response.
  return res.status(200).json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token
  });
}
