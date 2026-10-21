const { initializeApp, cert, getApps } = require("firebase-admin/app");

/*
 * The service account is read here, at load time.
 *
 * The old code called `.replace()` on the private key straight away, so a
 * missing variable ended the process with
 *
 *   TypeError: Cannot read properties of undefined (reading 'replace')
 *
 * before the start-up check for the environment could report what was
 * missing. The failure looked like a bug in the code and said nothing about
 * the variable that had to be set, so it was read here with a message that
 * names the variable instead.
 */
const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

const missing = [];

if (!projectId) missing.push("FIREBASE_PROJECT_ID");
if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
if (!privateKey) missing.push("FIREBASE_PRIVATE_KEY");

if (missing.length > 0) {
  throw new Error(
    `The Firebase service account is not configured. Missing: ${missing.join(
      ", ",
    )}. The server cannot send push notifications without it.`,
  );
}

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });

module.exports = app;
