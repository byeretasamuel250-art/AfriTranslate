// This runs on Vercel's server, NOT in the browser.
//
// Called when a signed-in user taps "Subscribe" / "Renew". It:
//   1. creates a PENDING row in `payments` (our own record of the attempt)
//   2. asks Pesapal to create an order for it
//   3. hands back the redirect_url so the browser can send the user to
//      Pesapal's payment page (mobile money, card, etc.)
//
// The subscription itself is only ever activated later, by
// api/pesapal-ipn.js, once Pesapal confirms the payment actually went
// through - never here, since at this point no money has moved yet.
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "./_lib/auth.js";
import { getAccessToken, submitOrder } from "./_lib/pesapal.js";

const SUPABASE_URL = "https://ntuhsfipdqdfanxuosdn.supabase.co";

const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Weekly subscription price. Kept as one constant here rather than
// something the browser sends, so nobody can submit their own amount.
const SUBSCRIPTION_AMOUNT = 2000;
const SUBSCRIPTION_CURRENCY = "UGX";

function generateMerchantReference(userId) {
  // Pesapal only allows letters, numbers, - _ . : (no spaces/@/#/etc),
  // max 50 chars, and it must be unique per order - a short random
  // suffix plus the timestamp makes collisions practically impossible.
  const shortUserId = userId.replace(/-/g, "").slice(0, 12);
  return `AT-${shortUserId}-${Date.now()}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const user = await requireUser(req, res, supabase);
  if (!user) return; // requireUser already sent the error response

  if (!process.env.SITE_URL) {
    console.error("SITE_URL environment variable is not set");
    return res.status(500).json({ error: "Payments are not configured yet - please try again later." });
  }
  if (!process.env.PESAPAL_IPN_ID) {
    console.error("PESAPAL_IPN_ID environment variable is not set");
    return res.status(500).json({ error: "Payments are not configured yet - please try again later." });
  }

  // Look up the profile for a name/email to prefill on Pesapal's page -
  // this is optional (Pesapal only strictly needs phone OR email), so a
  // lookup failure here should never block the payment.
  const { data: profile } = await supabase
    .from("profiles")
    .select("name, email")
    .eq("id", user.id)
    .maybeSingle();

  const merchantReference = generateMerchantReference(user.id);

  const { error: insertError } = await supabase.from("payments").insert({
    user_id: user.id,
    merchant_reference: merchantReference,
    amount: SUBSCRIPTION_AMOUNT,
    currency: SUBSCRIPTION_CURRENCY,
    status: "PENDING"
  });

  if (insertError) {
    console.error("Failed to record pending payment:", insertError.message);
    return res.status(500).json({ error: "Couldn't start payment - please try again." });
  }

  try {
    const token = await getAccessToken();

    const order = await submitOrder(token, {
      merchantReference,
      amount: SUBSCRIPTION_AMOUNT,
      currency: SUBSCRIPTION_CURRENCY,
      description: "AfriTranslate weekly subscription",
      callbackUrl: `${process.env.SITE_URL}/subscription-callback.html`,
      notificationId: process.env.PESAPAL_IPN_ID,
      billingAddress: {
        email_address: profile && profile.email ? profile.email : undefined,
        first_name: profile && profile.name ? profile.name : undefined,
        country_code: "UG"
      }
    });

    // Save Pesapal's own id for this order now, so pesapal-ipn.js can
    // find this row again by either merchant_reference or
    // order_tracking_id when the notification arrives.
    await supabase
      .from("payments")
      .update({ order_tracking_id: order.order_tracking_id, updated_at: new Date().toISOString() })
      .eq("merchant_reference", merchantReference);

    return res.status(200).json({ redirect_url: order.redirect_url });
  } catch (err) {
    console.error("Pesapal order creation failed:", err.message);
    await supabase
      .from("payments")
      .update({ status: "FAILED", updated_at: new Date().toISOString() })
      .eq("merchant_reference", merchantReference);
    return res.status(502).json({ error: "Couldn't reach the payment provider - please try again." });
  }
}
