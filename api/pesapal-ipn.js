// This runs on Vercel's server, NOT in the browser.
//
// Pesapal calls this URL directly (as a GET, per how we register it in
// the setup script) whenever a payment's status changes - including
// cases where the customer's browser never makes it back to our
// callback page at all (closed the tab, lost signal, etc). This is the
// ONLY place a subscription is ever actually activated - never
// api/subscribe.js (before payment) and never the callback page itself
// (which only ever reads status, it doesn't set it).
//
// SECURITY NOTE: the IPN call itself carries no proof of payment - it's
// just a nudge saying "go check". We always re-fetch the real status
// from Pesapal's GetTransactionStatus endpoint ourselves rather than
// trusting anything in the notification. This means someone guessing
// or replaying this URL can, at worst, make us re-check a real payment
// again - they can't fake one into existing.
import { createClient } from "@supabase/supabase-js";
import { getAccessToken, getTransactionStatus } from "./_lib/pesapal.js";

const SUPABASE_URL = "https://ntuhsfipdqdfanxuosdn.supabase.co";

const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SUBSCRIPTION_LENGTH_MS = 7 * 24 * 60 * 60 * 1000; // one week

// Applies a CONFIRMED completed payment to the user's subscription.
// If they already have time remaining, the new week is added on top of
// that (renewing early doesn't waste the days they've already paid
// for) rather than always resetting to "now + 7 days".
async function activateSubscription(userId) {
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  const now = Date.now();
  const currentEnd = existing && existing.current_period_end ? new Date(existing.current_period_end).getTime() : 0;
  const base = currentEnd > now ? currentEnd : now;
  const newPeriodEnd = new Date(base + SUBSCRIPTION_LENGTH_MS).toISOString();

  await supabase.from("subscriptions").upsert({
    user_id: userId,
    status: "active",
    current_period_end: newPeriodEnd,
    updated_at: new Date().toISOString()
  });
}

export default async function handler(req, res) {
  // Pesapal was registered to call this as GET (see the setup script);
  // params arrive as query params either way IPN or callback triggers it.
  const params = req.method === "GET" ? req.query : req.body;
  const orderTrackingId = params && params.OrderTrackingId;
  const orderMerchantReference = params && params.OrderMerchantReference;
  const notificationType = (params && params.OrderNotificationType) || "IPNCHANGE";

  const respond = (statusCode) =>
    res.status(200).json({
      orderNotificationType: notificationType,
      orderTrackingId: orderTrackingId || "",
      orderMerchantReference: orderMerchantReference || "",
      status: statusCode
    });

  if (!orderTrackingId) {
    // Nothing we can look up - acknowledge anyway so Pesapal doesn't
    // keep retrying a malformed call, but log it in case it points to a
    // real misconfiguration on our side.
    console.error("Pesapal IPN called with no OrderTrackingId");
    return respond(500);
  }

  try {
    const token = await getAccessToken();
    const transaction = await getTransactionStatus(token, orderTrackingId);

    // Find our own payment row. Prefer the merchant reference Pesapal
    // just gave us; fall back to the order_tracking_id we saved back in
    // subscribe.js, in case that field is ever missing from the call.
    const reference = orderMerchantReference || transaction.merchant_reference;
    const { data: payment } = await supabase
      .from("payments")
      .select("id, user_id, status")
      .or(`merchant_reference.eq.${reference},order_tracking_id.eq.${orderTrackingId}`)
      .maybeSingle();

    if (!payment) {
      console.error("Pesapal IPN for unknown payment:", reference, orderTrackingId);
      return respond(500);
    }

    // status_code: 0 INVALID, 1 COMPLETED, 2 FAILED, 3 REVERSED
    const newStatus =
      transaction.status_code === 1 ? "COMPLETED" : transaction.status_code === 3 ? "REVERSED" : "FAILED";

    // Only activate once per payment - if we've already marked this one
    // COMPLETED (e.g. the callback page and the IPN both triggered a
    // check), don't add a second week for the same single payment.
    const alreadyCompleted = payment.status === "COMPLETED";

    await supabase
      .from("payments")
      .update({ status: newStatus, order_tracking_id: orderTrackingId, updated_at: new Date().toISOString() })
      .eq("id", payment.id);

    if (newStatus === "COMPLETED" && !alreadyCompleted) {
      await activateSubscription(payment.user_id);
    }

    return respond(200);
  } catch (err) {
    console.error("Pesapal IPN handling failed:", err.message);
    return respond(500);
  }
}
