// This runs on Vercel's server, NOT in the browser.
//
// A browser-friendly alternative to scripts/register-pesapal-ipn.js -
// visit this URL once in your browser (with your consumer secret as
// the ?key= value, so a random visitor can't trigger it) instead of
// needing Node installed on your own computer.
//
// Usage: https://YOUR-SITE.vercel.app/api/setup-pesapal-ipn?key=YOUR_PESAPAL_CONSUMER_SECRET
//
// Safe to leave in place - without the correct key it does nothing,
// and even with it, all it does is (re-)register the same IPN URL,
// which never breaks anything if run more than once. You can delete
// this file afterwards if you'd rather not keep it around, but it's
// not required.
import { getAccessToken, registerIpn } from "./_lib/pesapal.js";

export default async function handler(req, res) {
  const providedKey = req.query.key;

  if (!process.env.PESAPAL_CONSUMER_SECRET || providedKey !== process.env.PESAPAL_CONSUMER_SECRET) {
    return res.status(403).send("Not authorized. Add ?key=YOUR_PESAPAL_CONSUMER_SECRET to the URL.");
  }

  if (!process.env.SITE_URL) {
    return res.status(500).send("SITE_URL environment variable is not set yet - add it first, then try again.");
  }

  try {
    const token = await getAccessToken();
    const ipnUrl = `${process.env.SITE_URL}/api/pesapal-ipn`;
    const result = await registerIpn(token, ipnUrl);

    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(`
      <html><body style="font-family: sans-serif; padding: 20px; max-width: 500px;">
        <h2>IPN registered</h2>
        <p>Notification URL: ${result.url}</p>
        <p><strong>Copy this value:</strong></p>
        <pre style="background:#f0f0f0; padding:12px; border-radius:8px; font-size:16px;">${result.ipn_id}</pre>
        <p>Now go add this as an environment variable in Vercel:</p>
        <pre style="background:#f0f0f0; padding:12px; border-radius:8px;">PESAPAL_IPN_ID=${result.ipn_id}</pre>
      </body></html>
    `);
  } catch (err) {
    return res.status(500).send("Failed to register IPN: " + err.message);
  }
}
