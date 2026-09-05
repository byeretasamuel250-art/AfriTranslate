// Run this ONCE (from your own computer, with Node installed) after
// you deploy - not on every deploy, and never automatically. It tells
// Pesapal where to send payment notifications and prints back the
// notification_id you then paste into Vercel as PESAPAL_IPN_ID.
//
// Usage:
//   PESAPAL_ENV=sandbox \
//   PESAPAL_CONSUMER_KEY=xxxx \
//   PESAPAL_CONSUMER_SECRET=xxxx \
//   SITE_URL=https://your-app.vercel.app \
//   node scripts/register-pesapal-ipn.js
//
// Run it again (with your LIVE keys and PESAPAL_ENV=production) once
// you switch from sandbox to real payments - sandbox and production
// each need their own notification_id, since they're separate systems.
import { getAccessToken, registerIpn } from "../api/_lib/pesapal.js";

async function main() {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    console.error("Set SITE_URL to your deployed app's URL first, e.g. https://afritranslate.vercel.app");
    process.exit(1);
  }

  const token = await getAccessToken();
  const ipnUrl = `${siteUrl}/api/pesapal-ipn`;
  const result = await registerIpn(token, ipnUrl);

  console.log("Registered IPN URL:", result.url);
  console.log("\nAdd this to your Vercel environment variables:");
  console.log(`PESAPAL_IPN_ID=${result.ipn_id}`);
}

main().catch((err) => {
  console.error("Failed to register IPN:", err.message);
  process.exit(1);
});
