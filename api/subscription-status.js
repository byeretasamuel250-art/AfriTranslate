// This runs on Vercel's server, NOT in the browser.
// Returns whether the signed-in user currently has an active
// subscription, and when it runs out. Used both by the main app (to
// show "Premium until ..." vs a "Subscribe" prompt) and by
// subscription-callback.html (to confirm a just-completed payment).
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_lib/auth.js";

const SUPABASE_URL = "https://ntuhsfipdqdfanxuosdn.supabase.co";

const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET requests allowed" });
  }

  const user = await requireUser(req, res, supabase);
  if (!user) return; // requireUser already sent the error response

  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load subscription:", error.message);
    return res.status(500).json({ error: "Couldn't check subscription status." });
  }

  const active =
    !!subscription && subscription.status === "active" && new Date(subscription.current_period_end) > new Date();

  return res.status(200).json({
    active,
    current_period_end: subscription ? subscription.current_period_end : null
  });
}
