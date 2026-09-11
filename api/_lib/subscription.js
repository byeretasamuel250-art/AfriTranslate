// Shared by every PAID API route (translate, speech-to-text,
// text-to-speech). Builds on requireUser: first confirms the request
// comes from a real, signed-in user, then checks that user actually
// has an active subscription.
//
// SECURITY NOTE: before this existed, the paywall (see index.html /
// app.js - "Paywall - shown instead of the translator for anyone
// without an active subscription") was enforced ONLY in the browser
// UI. The API routes themselves only checked requireUser (signed in),
// not payment status. That meant anyone could register a free account
// and call /api/translate, /api/speech-to-text or /api/text-to-speech
// directly - e.g. with curl or devtools, using nothing but their login
// token - and use every premium feature forever without ever paying.
// A client-side paywall only stops the *app's own UI* from offering
// the button; it does nothing to stop a direct API call. The real
// paywall has to live here, on the server, next to require Payment.
import { requireUser } from "./auth.js";

export async function requireActiveSubscription(req, res, supabaseAdmin) {
  const user = await requireUser(req, res, supabaseAdmin);
  if (!user) return null; // requireUser already sent the 401 response

  const { data: subscription, error } = await supabaseAdmin
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Subscription check failed:", error.message);
    res.status(500).json({ error: "Couldn't verify your subscription - please try again." });
    return null;
  }

  const active =
    !!subscription && subscription.status === "active" && new Date(subscription.current_period_end) > new Date();

  if (!active) {
    res.status(402).json({
      error: "This is a premium feature - please subscribe to continue.",
      subscription_required: true
    });
    return null;
  }

  return user;
}
