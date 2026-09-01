// This runs on Vercel's server, NOT in the browser.
// Same reasoning as login.js: looks up the email for a given name
// entirely server-side, and never sends that email address back to the
// browser - only a generic confirmation message, same as before.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ntuhsfipdqdfanxuosdn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_b8OQ4BmWzhHv29gMrOTU6g_RiWx4eIj";

const supabaseAdmin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const MAX_ATTEMPTS_PER_WINDOW = 5;
const WINDOW_MINUTES = 15;

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
}

async function withinRateLimit(windowKey) {
  const { data: gotSlot, error } = await supabaseAdmin.rpc("reserve_auth_slot", {
    p_window_key: windowKey,
    p_limit: MAX_ATTEMPTS_PER_WINDOW
  });

  if (error) {
    console.error("Auth rate limit check failed:", error.message);
    return true;
  }

  return gotSlot;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Enter your name." });
  }

  const ip = getClientIp(req);
  const windowBucket = Math.floor(Date.now() / (WINDOW_MINUTES * 60 * 1000));
  const windowKey = "reset:" + ip + ":" + windowBucket;

  const allowed = await withinRateLimit(windowKey);
  if (!allowed) {
    // Same vague message either way - doesn't reveal that a limit was hit
    // specifically, just asks them to slow down like any other failure.
    return res.status(429).json({ error: "Please wait a few minutes before trying again." });
  }

  const { data: email } = await supabaseAdmin.rpc("get_email_for_name", { p_name: name });

  if (email) {
    const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: req.headers.origin || undefined
    });
    if (resetError) {
      console.error("Password reset email failed to send:", resetError.message);
    }
  }

  // Always the same response, whether or not the name exists, and
  // whether or not sending actually succeeded - this is the same
  // deliberately-vague behavior the app already had, just now backed by
  // a lookup that never leaves the server.
  return res.status(200).json({ message: "If that name has an account, a reset link will be sent." });
}
