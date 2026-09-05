// Shared helper for talking to Pesapal's API 3.0 (JSON). Used by
// api/subscribe.js (to start a payment) and api/pesapal-ipn.js (to
// confirm one after Pesapal notifies us).
//
// Docs: https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/api-reference
//
// ENVIRONMENT: set PESAPAL_ENV to "sandbox" while testing (Pesapal gives
// you separate test consumer_key/secret for this) and to "production"
// once you have real live keys from your Pesapal merchant dashboard.
// Everything else in this file - and in subscribe.js/pesapal-ipn.js -
// stays the same either way.
const PESAPAL_ENV = process.env.PESAPAL_ENV === "production" ? "production" : "sandbox";

const BASE_URL =
  PESAPAL_ENV === "production"
    ? "https://pay.pesapal.com/v3"
    : "https://cybqa.pesapal.com/pesapalv3";

// A Pesapal access token is valid for 5 minutes. Serverless functions
// don't share memory between invocations reliably, so rather than
// build a whole caching layer for something this cheap, we just request
// a fresh token each time we need to talk to Pesapal. This is one extra
// network call per subscribe click / IPN call - not per translation -
// so the cost is negligible.
async function getAccessToken() {
  const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
  const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error("PESAPAL_CONSUMER_KEY / PESAPAL_CONSUMER_SECRET are not set");
  }

  const response = await fetch(`${BASE_URL}/api/Auth/RequestToken`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ consumer_key: consumerKey, consumer_secret: consumerSecret })
  });

  const data = await response.json();

  if (!response.ok || !data.token) {
    throw new Error("Pesapal auth failed: " + (data.message || response.status));
  }

  return data.token;
}

// One-time setup step (see the "First-time setup" instructions) - not
// called on every payment. Registers where Pesapal should send status
// notifications and returns the notification_id (ipn_id) you then put
// in your PESAPAL_IPN_ID environment variable.
async function registerIpn(token, ipnUrl) {
  const response = await fetch(`${BASE_URL}/api/URLSetup/RegisterIPN`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ url: ipnUrl, ipn_notification_type: "GET" })
  });

  const data = await response.json();
  if (!response.ok || !data.ipn_id) {
    throw new Error("Pesapal IPN registration failed: " + (data.message || response.status));
  }
  return data;
}

// Creates the actual payment order and returns the redirect_url to send
// the browser to.
async function submitOrder(token, { merchantReference, amount, currency, description, callbackUrl, notificationId, billingAddress }) {
  const response = await fetch(`${BASE_URL}/api/Transactions/SubmitOrderRequest`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      id: merchantReference,
      currency,
      amount,
      description,
      callback_url: callbackUrl,
      notification_id: notificationId,
      billing_address: billingAddress
    })
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error("Pesapal SubmitOrderRequest failed: " + (data.message || JSON.stringify(data.error)));
  }
  return data; // { order_tracking_id, merchant_reference, redirect_url, ... }
}

async function getTransactionStatus(token, orderTrackingId) {
  const response = await fetch(
    `${BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` }
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error("Pesapal GetTransactionStatus failed: " + (data.message || response.status));
  }
  return data; // { payment_status_description, status_code, amount, currency, ... }
}

export { getAccessToken, registerIpn, submitOrder, getTransactionStatus, PESAPAL_ENV };
