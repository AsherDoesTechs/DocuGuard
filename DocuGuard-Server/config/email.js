const { Resend } = require("resend");
const { debug, info, warn, error: logError } = require("../utils/debugLogger");

let resendInstance = null;

function getResend() {
  if (!resendInstance) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error(
        "RESEND_API_KEY is not configured. Set it in your .env or environment variables.",
      );
    }

    resendInstance = new Resend(process.env.RESEND_API_KEY);
  }

  return resendInstance;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Build a text-based brand header for emails (replaces inline SVG).
 */
function buildBrandHeader() {
  return `
    <div style="width: 48px; height: 48px; background: #1a1a1a; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px; font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">
      DG
    </div>
    <h1 style="margin: 0 0 4px; color: #1a1a1a; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">
      DocuGuard
    </h1>
    <p style="margin: 0; color: #666; font-size: 14px;">
      Secure Document Management
    </p>`;
}

const EMAIL_FROM =
  process.env.EMAIL_FROM || process.env.EMAIL_SUPPORT || "DocuGuard Support <support@docuguardapp.com>";

const EMAIL_SUPPORT =
  process.env.EMAIL_SUPPORT || "DocuGuard Support <support@docuguardapp.com>";

const APP_BASE_URL =
  process.env.APP_BASE_URL || "https://docuguard-api-onoj.onrender.com";

/**
 * Custom URL scheme the mobile app registers.
 *
 * Must stay in sync with `scheme` in app.json. Exported because
 * `authController.verifyEmailWeb` builds a redirect out of it, and it used to
 * destructure this name from this module without it ever being exported, which
 * produced the literal string "undefined://verify-email?...".
 */
const APP_DEEPLINK_SCHEME = process.env.APP_DEEPLINK_SCHEME || "docuguard";

/**
 * Build the verification email HTML.
 * Primary link is now the web verification page (HTTPS), deep link is secondary.
 */
function buildVerificationEmailHtml(
  name,
  verificationLinkWeb,
  verificationLinkDeep,
  expiresIn = "24 hours",
) {
  const displayName = escapeHtml(name || "there");

  const brandHeader = buildBrandHeader();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email - DocuGuard</title>
</head>

<body style="margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #fafafa; line-height: 1.6; color: #1a1a1a;">

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e5e5; overflow: hidden;">

    <!-- Header -->
    <tr>
      <td style="padding: 40px 40px 24px; text-align: center; border-bottom: 1px solid #f0f0f0;">
        ${brandHeader}
      </td>
    </tr>

    <!-- Main Content -->
    <tr>
      <td style="padding: 40px;">

        <h2 style="margin: 0 0 12px; color: #1a1a1a; font-size: 22px; font-weight: 600; text-align: center;">
          Verify Your Email
        </h2>

        <p style="margin: 0 0 28px; color: #4a4a4a; font-size: 15px; text-align: center; line-height: 1.6;">
          Hi ${displayName},<br><br>
          Thanks for signing up. We need to verify this email address before activating your account.
        </p>

        <!-- Primary CTA Button (Web Link - HTTPS) -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 16px;">
          <tr>
            <td style="text-align: center;">

              <a
                href="${verificationLinkWeb}"
                style="display: inline-block; padding: 14px 32px; background: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: -0.2px;"
              >
                Verify Email Address
              </a>

            </td>
          </tr>
        </table>

        <!-- Secondary CTA Button (Deep Link - Opens App) -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 28px;">
          <tr>
            <td style="text-align: center;">

              <a
                href="${verificationLinkDeep}"
                style="display: inline-block; padding: 14px 32px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: -0.2px;"
              >
                Open in DocuGuard App
              </a>

            </td>
          </tr>
        </table>

        <!-- Expiry -->
        <p style="margin: 0 0 16px; color: #999; font-size: 13px; text-align: center;">
          This link expires in ${expiresIn}.
        </p>

        <!-- Fallback -->
        <div style="padding: 16px; background-color: #fafafa; border-radius: 8px; border: 1px solid #eee;">

          <p style="margin: 0 0 8px; color: #666; font-size: 12px; text-align: center;">
            If the buttons don't work, copy this link into your browser:
          </p>

          <p style="margin: 0; word-break: break-all; color: #1a1a1a; font-size: 12px; font-family: 'SF Mono', 'Fira Code', 'Roboto Mono', monospace; text-align: center;">
            ${verificationLinkWeb}
          </p>

        </div>

      </td>
    </tr>

    <!-- Divider -->
    <tr>
      <td style="padding: 0 40px;">
        <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 0;">
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding: 24px 40px; text-align: center; background-color: #fafafa;">

        <p style="margin: 0 0 4px; color: #999; font-size: 12px;">
          If you didn't create a DocuGuard account, you can safely ignore this email.
        </p>

        <p style="margin: 0; color: #ccc; font-size: 11px;">
          &copy; ${new Date().getFullYear()} DocuGuard. All rights reserved.
        </p>

      </td>
    </tr>

  </table>

  <p style="text-align: center; margin: 20px 0 0; color: #999; font-size: 11px;">
    Sent from DocuGuard
  </p>

</body>
</html>`;
}

/**
 * Build password reset email HTML.
 */
function buildPasswordResetEmailHtml(resetLinkWeb, resetLinkDeep) {
  const brandHeader = `
    <div style="width: 48px; height: 48px; background: #dc2626; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px; font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">
      DG
    </div>
    <h1 style="margin: 0 0 4px; color: #1a1a1a; font-size: 24px; font-weight: 700;">
      DocuGuard
    </h1>
    <p style="margin: 0; color: #666; font-size: 14px;">
      Password Reset
    </p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password - DocuGuard</title>
</head>

<body style="margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #fafafa; line-height: 1.6; color: #1a1a1a;">

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e5e5; overflow: hidden">

    <!-- Header -->
    <tr>
      <td style="padding: 40px 40px 24px; text-align: center; border-bottom: 1px solid #f0f0f0;">
        ${brandHeader}
      </td>
    </tr>

    <!-- Main Content -->
    <tr>
      <td style="padding: 40px;">

        <h2 style="margin: 0 0 12px; color: #1a1a1a; font-size: 22px; font-weight: 600; text-align: center;">
          Reset Your Password
        </h2>

        <p style="margin: 0 0 28px; color: #4a4a4a; font-size: 15px; text-align: center; line-height: 1.6;">
          You requested to reset your password. Click the button below to create a new one. This link expires in 1 hour.
        </p>

        <!-- Security Notice -->
        <div style="padding: 14px 16px; background-color: #fef2f2; border-radius: 8px; border: 1px solid #fecaca; margin-bottom: 28px;">
          <p style="margin: 0; color: #991b1b; font-size: 12px; line-height: 1.5;">
            <strong>Security:</strong>
            DocuGuard never asks for your password via email. If you didn't request this, ignore this email — your account stays secure.
          </p>
        </div>

        <!-- Primary CTA Button (Web Link - HTTPS) -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 16px;">
          <tr>
            <td style="text-align: center;">

              <a
                href="${resetLinkWeb}"
                style="display: inline-block; padding: 14px 32px; background: #dc2626; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600;"
              >
                Reset Password
              </a>

            </td>
          </tr>
        </table>

        <!-- Secondary CTA Button (Deep Link - Opens App) -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 28px;">
          <tr>
            <td style="text-align: center;">

              <a
                href="${resetLinkDeep}"
                style="display: inline-block; padding: 14px 32px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600;"
              >
                Open in DocuGuard App
              </a>

            </td>
          </tr>
        </table>

        <!-- Fallback -->
        <div style="padding: 16px; background-color: #fafafa; border-radius: 8px; border: 1px solid #eee;">

          <p style="margin: 0 0 8px; color: #666; font-size: 12px; text-align: center;">
            If the buttons don't work, copy this link into your browser:
          </p>

          <p style="margin: 0; word-break: break-all; color: #dc2626; font-size: 12px; font-family: 'SF Mono', 'Fira Code', 'Roboto Mono', monospace; text-align: center;">
            ${resetLinkWeb}
          </p>

        </div>

      </td>
    </tr>

    <!-- Divider -->
    <tr>
      <td style="padding: 0 40px;">
        <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 0;">
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding: 24px 40px; text-align: center; background-color: #fafafa">

        <p style="margin: 0 0 4px; color: #999; font-size: 12px;">
          If you didn't request a password reset, you can safely ignore this email.
        </p>

        <p style="margin: 0; color: #ccc; font-size: 11px;">
          &copy; ${new Date().getFullYear()} DocuGuard. All rights reserved.
        </p>

      </td>
    </tr>

  </table>

  <p style="text-align: center; margin: 20px 0 0; color: #999; font-size: 11px;">
    Sent from DocuGuard
  </p>

</body>
</html>`;
}

/**
 * Build plain-text version of verification email.
 */
function buildVerificationEmailText(
  name,
  verificationLinkWeb,
  verificationLinkDeep,
  expiresIn = "24 hours",
) {
  const displayName = name || "there";

  return `Verify Your Email - DocuGuard

Hi ${displayName},

Thanks for signing up. We need to verify this email address before activating your account.

Please verify your email by clicking the link below (expires in ${expiresIn}):

${verificationLinkWeb}

If you have the DocuGuard app installed, you can also open this link directly in the app:
${verificationLinkDeep}

If the links don't work, copy the web link above into your browser.

If you didn't create a DocuGuard account, you can safely ignore this email.

---
© ${new Date().getFullYear()} DocuGuard. All rights reserved.
Sent from DocuGuard`;
}

/**
 * Build plain-text version of password reset email.
 */
function buildPasswordResetEmailText(resetLinkWeb, resetLinkDeep) {
  return `Reset Your Password - DocuGuard

You requested to reset your password. Click the link below to create a new one. This link expires in 1 hour.

Primary (web): ${resetLinkWeb}

If you have the DocuGuard app installed, you can also open this link directly in the app:
${resetLinkDeep}

Security: DocuGuard never asks for your password via email. If you didn't request this, ignore this email — your account stays secure.

If the links don't work, copy the web link above into your browser.

If you didn't request a password reset, you can safely ignore this email.

---
© ${new Date().getFullYear()} DocuGuard. All rights reserved.
Sent from DocuGuard`;
}

/**
 * Build plain-text version of expiration reminder email.
 */
function buildExpirationReminderEmailText(name, documentTitle, daysUntilExpiry, expiryDate) {
  const displayName = name || "there";
  const isExpired = daysUntilExpiry <= 0;
  const urgencyText = isExpired ? "EXPIRED" : `Expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? "s" : ""}`;
  const actionText = isExpired ? "has expired and needs immediate renewal" : "is expiring soon and requires your attention";

  return `Document ${isExpired ? "Expired" : "Expiring Soon"} - DocuGuard

Hi ${displayName},

Your document "${documentTitle}" ${actionText}.

Document: ${documentTitle}
Status: ${urgencyText}
Expiry Date: ${expiryDate}

Open the DocuGuard app to view this document: ${APP_DEEPLINK_SCHEME}://documents

You received this because you have expiration alerts enabled for this document.

---
© ${new Date().getFullYear()} DocuGuard. All rights reserved.
Sent from DocuGuard`;
}

function buildVerificationLink(token, forWeb = false) {
  if (!token) {
    throw new Error("Verification token is required");
  }

  if (forWeb) {
    return `${APP_BASE_URL}/auth/verify-email-web?token=${encodeURIComponent(
      token,
    )}`;
  }

  return `${APP_DEEPLINK_SCHEME}://verify-email?token=${encodeURIComponent(
    token,
  )}`;
}

/**
 * Build the password reset link.
 *
 * A deep link, not a web URL. The previous value pointed at
 * `${APP_BASE_URL}/auth/reset-password-web`, and no such route exists on any
 * host: `/auth/reset-password-web` is not registered in routes/auth.js, and
 * APP_BASE_URL is the API itself, not a website. Every reset email therefore
 * 404'd and no user could ever reset their password.
 *
 * The app handles this deep link in app/(auth)/reset-password.tsx, which reads
 * the token from the route params and calls POST /auth/reset-password.
 */
function buildPasswordResetLink(token, forWeb = false) {
  if (!token) {
    throw new Error("Password reset token is required");
  }

  if (forWeb) {
    return `${APP_BASE_URL}/auth/reset-password?token=${encodeURIComponent(
      token,
    )}`;
  }

  return `${APP_DEEPLINK_SCHEME}://reset-password?token=${encodeURIComponent(
    token,
  )}`;
}

/**
 * Send email verification link.
 *
 * IMPORTANT:
 * This sends both a web link (HTTPS - primary) and a mobile deep link (fallback).
 */
async function sendVerificationEmail(to, name, token) {
  if (!process.env.RESEND_API_KEY) {
    logError(
      "Email",
      "Cannot send verification email — RESEND_API_KEY missing",
      {
        to,
      },
    );

    throw new Error("RESEND_API_KEY is not configured");
  }

  const resend = getResend();

  // Web link for browser (primary)
  const verificationLinkWeb = buildVerificationLink(token, true);
  // Deep link for mobile app (fallback)
  const verificationLinkDeep = buildVerificationLink(token, false);

  const displayName = name || "there";

  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Verify Your Email — DocuGuard",
    html: buildVerificationEmailHtml(displayName, verificationLinkWeb, verificationLinkDeep),
    text: buildVerificationEmailText(displayName, verificationLinkWeb, verificationLinkDeep),
  });

  if (error) {
    logError("Email", "Resend verification email error", {
      to,
      error: error.message || error,
    });

    throw error;
  }

  info("Email", "Verification email sent", {
    to,
    messageId: data?.id,
    verificationType: "web-primary + deep-link-fallback",
  });

  return data;
}

/**
 * Send password reset email.
 *
 * Sends both a web link (HTTPS - primary) and a mobile deep link (fallback).
 */
async function sendPasswordResetEmail(to, token) {
  if (!process.env.RESEND_API_KEY) {
    logError(
      "Email",
      "Cannot send password reset email — RESEND_API_KEY missing",
      { to },
    );

    throw new Error("RESEND_API_KEY is not configured");
  }

  const resend = getResend();

  // Web link for browser (primary)
  const resetLinkWeb = buildPasswordResetLink(token, true);
  // Deep link for mobile app (fallback)
  const resetLinkDeep = buildPasswordResetLink(token, false);

  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Reset Your Password — DocuGuard",
    html: buildPasswordResetEmailHtml(resetLinkWeb, resetLinkDeep),
    text: buildPasswordResetEmailText(resetLinkWeb, resetLinkDeep),
  });

  if (error) {
    logError("Email", "Resend password reset email error", {
      to,
      error: error.message || error,
    });

    throw error;
  }

  info("Email", "Password reset email sent", {
    to,
    messageId: data?.id,
    resetType: "web-primary + deep-link-fallback",
  });

  return data;
}

function buildExpirationReminderEmailHtml(name, documentTitle, daysUntilExpiry, expiryDate) {
  const displayName = escapeHtml(name || "there");
  const safeDocumentTitle = escapeHtml(documentTitle);
  const isExpired = daysUntilExpiry <= 0;
  const urgencyColor = isExpired ? "#dc2626" : daysUntilExpiry <= 7 ? "#ea580c" : "#2563eb";
  const urgencyText = isExpired ? "EXPIRED" : `Expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? "s" : ""}`;
  const actionText = isExpired ? "has expired and needs immediate renewal" : "is expiring soon and requires your attention";

  const brandHeader = `
    <div style="width: 48px; height: 48px; background: ${urgencyColor}; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px; font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">
      DG
    </div>
    <h1 style="margin: 0 0 4px; color: #1a1a1a; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">
      DocuGuard
    </h1>
    <p style="margin: 0; color: #666; font-size: 14px;">
      Document Expiration Alert
    </p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document Expiration Reminder - DocuGuard</title>
</head>

<body style="margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #fafafa; line-height: 1.6; color: #1a1a1a;">

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e5e5; overflow: hidden;">

    <!-- Header -->
    <tr>
      <td style="padding: 40px 40px 24px; text-align: center; border-bottom: 1px solid #f0f0f0;">
        ${brandHeader}
      </td>
    </tr>

    <!-- Main Content -->
    <tr>
      <td style="padding: 40px;">

        <h2 style="margin: 0 0 12px; color: #1a1a1a; font-size: 22px; font-weight: 600; text-align: center;">
          Document ${isExpired ? "Expired" : "Expiring Soon"}
        </h2>

        <p style="margin: 0 0 28px; color: #4a4a4a; font-size: 15px; text-align: center; line-height: 1.6;">
          Hi ${displayName},<br><br>
          Your document <strong>${safeDocumentTitle}</strong> ${actionText}.
        </p>

        <!-- Document Details Card -->
        <div style="padding: 20px; background-color: #fafafa; border-radius: 8px; border: 1px solid #eee; margin-bottom: 28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding: 8px 0; color: #666; font-size: 14px;">Document</td>
              <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; font-weight: 600; text-align: right;">${safeDocumentTitle}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666; font-size: 14px;">Status</td>
              <td style="padding: 8px 0; color: ${urgencyColor}; font-size: 14px; font-weight: 600; text-align: right;">${urgencyText}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #666; font-size: 14px;">Expiry Date</td>
              <td style="padding: 8px 0; color: #1a1a1a; font-size: 14px; text-align: right;">${expiryDate}</td>
            </tr>
          </table>
        </div>

        <!-- CTA Button -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 28px;">
          <tr>
            <td style="text-align: center;">

              <a
                href="${APP_DEEPLINK_SCHEME}://documents"
                style="display: inline-block; padding: 14px 32px; background: ${urgencyColor}; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: -0.2px;"
              >
                View in DocuGuard
              </a>

            </td>
          </tr>
        </table>

        <p style="margin: 0; color: #999; font-size: 12px; text-align: center;">
          You received this because you have expiration alerts enabled for this document.
        </p>

      </td>
    </tr>

    <!-- Divider -->
    <tr>
      <td style="padding: 0 40px;">
        <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 0;">
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding: 24px 40px; text-align: center; background-color: #fafafa;">

        <p style="margin: 0 0 4px; color: #999; font-size: 12px;">
          To adjust notification preferences, open DocuGuard app settings.
        </p>

        <p style="margin: 0; color: #ccc; font-size: 11px;">
          &copy; ${new Date().getFullYear()} DocuGuard. All rights reserved.
        </p>

      </td>
    </tr>

  </table>

  <p style="text-align: center; margin: 20px 0 0; color: #999; font-size: 11px;">
    Sent from DocuGuard
  </p>

</body>
</html>`;
}

async function sendExpirationReminderEmail(to, name, documentTitle, daysUntilExpiry, expiryDate) {
  if (!process.env.RESEND_API_KEY) {
    logError(
      "Email",
      "Cannot send expiration reminder email — RESEND_API_KEY missing",
      { to, documentTitle },
    );

    throw new Error("RESEND_API_KEY is not configured");
  }

  const resend = getResend();

  const safeDocumentTitle = escapeHtml(documentTitle);
  const subject = daysUntilExpiry <= 0
    ? `Document Expired: ${safeDocumentTitle} — DocuGuard`
    : `Document Expiring in ${daysUntilExpiry} Day${daysUntilExpiry !== 1 ? "s" : ""}: ${safeDocumentTitle} — DocuGuard`;

  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    html: buildExpirationReminderEmailHtml(name, documentTitle, daysUntilExpiry, expiryDate),
    text: buildExpirationReminderEmailText(name, documentTitle, daysUntilExpiry, expiryDate),
  });

  if (error) {
    logError("Email", "Resend expiration reminder email error", {
      to,
      documentTitle,
      error: error.message || error,
    });

    throw error;
  }

  info("Email", "Expiration reminder email sent", {
    to,
    documentTitle,
    daysUntilExpiry,
    messageId: data?.id,
  });

  return data;
}

module.exports = {
  buildVerificationEmailHtml,
  buildPasswordResetEmailHtml,
  buildExpirationReminderEmailHtml,
  buildVerificationEmailText,
  buildPasswordResetEmailText,
  buildExpirationReminderEmailText,
  buildVerificationLink,
  buildPasswordResetLink,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendExpirationReminderEmail,
  getResend,
  escapeHtml,
  EMAIL_FROM,
  EMAIL_SUPPORT,
  APP_BASE_URL,
  APP_DEEPLINK_SCHEME,
};
