const { Resend } = require("resend");
const { debug, info, warn, error: logError } = require("../utils/debugLogger");

let resendInstance = null;

/**
 * Lazily create and cache the Resend client.
 * Throws a descriptive error if RESEND_API_KEY is not configured.
 */
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

const EMAIL_FROM =
  process.env.EMAIL_FROM || "DocuGuard <onboarding@resend.dev>";
const APP_BASE_URL =
  process.env.APP_BASE_URL || "https://docuguard-api-onoj.onrender.com";

/**
 * Build clean, modern HTML for an email verification message.
 * @param {string} name - Recipient's display name
 * @param {string} verificationLink - Full URL the user clicks to verify
 * @param {string} [expiresIn='24 hours'] - Human-readable expiry window
 * @returns {string} HTML string suitable for Resend `html` field
 */
function buildVerificationEmailHtml(name, verificationLink, expiresIn = "24 hours") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Verify Your Email - DocuGuard</title>
  <style>
    @media only screen and (max-width: 600px) {
      .container { padding: 24px 20px !important; }
      .heading { font-size: 20px !important; }
      .body-text { font-size: 15px !important; }
      .button { padding: 14px 24px !important; font-size: 15px !important; }
      .footer { padding: 24px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6; line-height: 1.6; color: #111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08); overflow: hidden;">
    <!-- Gradient Header -->
    <tr>
      <td style="background: linear-gradient(135deg, #2563EB 0%, #1d4ED8 100%); padding: 48px 32px; text-align: center;">
        <div style="width: 64px; height: 64px; background: rgba(255,255,255,0.18); border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="3" width="18" height="18" rx="4" stroke="white" stroke-width="2"/>
            <path d="M8 12L11 15L16 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">DocuGuard</h1>
        <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 15px;">Secure Document Management</p>
      </td>
    </tr>

    <!-- Verification Code / Illustration -->
    <tr>
      <td style="padding: 40px 32px 24px; text-align: center;">
        <div style="width: 88px; height: 88px; background: #DBEAFE; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 8px;">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9 12L11 14L15 10" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h2 style="margin: 0 0 8px; color: #111827; font-size: 22px; font-weight: 600;">Verify Your Email</h2>
        <p class="body-text" style="margin: 0 0 20px; color: #6B7280; font-size: 16px; max-width: 480px; margin-left: auto; margin-right: auto;">We need to verify that this email address belongs to you before activating your DocuGuard account.</p>
      </td>
    </tr>

    <!-- CTA Button -->
    <tr>
      <td style="padding: 0 32px 32px; text-align: center;">
        <table role="presentation" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" style="border-radius: 12px; overflow: hidden; box-shadow: 0 6px 20px rgba(37, 99, 235, 0.35);">
              <a href="${verificationLink}" class="button" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #2563EB 0%, #1d4ED8 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-size: 17px; font-weight: 600; letter-spacing: -0.25px; transition: all 0.2s ease;">Verify My Email Address</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Expiry + Fallback -->
    <tr>
      <td style="padding: 0 32px 16px;">
        <p class="body-text" style="margin: 0 0 16px; color: #9CA3AF; font-size: 14px; text-align: center;">This link expires in ${expiresIn} for security.</p>

        <div style="margin-top: 24px; padding: 16px 20px; background-color: #F9FAFB; border-radius: 10px; border: 1px solid #E5E7EB;">
          <p style="margin: 0 0 8px; color: #6B7280; font-size: 12px; text-align: center;">Or copy & paste this URL into your browser:</p>
          <p style="margin: 0; word-break: break-all; color: #2563EB; font-size: 12px; font-family: 'SF Mono', 'Fira Code', 'Roboto Mono', monospace; text-align: center;">${verificationLink}</p>
        </div>
      </td>
    </tr>

    <!-- Divider -->
    <tr>
      <td style="padding: 0 32px;">
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 0;">
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td class="footer" style="padding: 32px; text-align: center; background-color: #F9FAFB;">
        <p style="margin: 0 0 8px; color: #9CA3AF; font-size: 13px;">If you didn't create a DocuGuard account, you can safely ignore this email.</p>
        <p style="margin: 0; color: #D1D5DB; font-size: 12px;">&copy; ${new Date().getFullYear()} DocuGuard. All rights reserved.</p>
      </td>
    </tr>
  </table>

  <p style="text-align: center; margin: 24px 0 0; color: #9CA3AF; font-size: 12px;">Sent with care from the DocuGuard team</p>
</body>
</html>`;
}

/**
 * Build clean, modern HTML for a password reset email.
 * @param {string} resetLink - Full URL the user clicks to reset password
 * @returns {string} HTML string
 */
function buildPasswordResetEmailHtml(resetLink) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset - DocuGuard</title>
  <style>
    @media only screen and (max-width: 600px) {
      .container { padding: 24px 20px !important; }
      .button { padding: 14px 24px !important; font-size: 15px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08); overflow: hidden;">
    <tr>
      <td style="background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%); padding: 48px 32px; text-align: center;">
        <div style="width: 64px; height: 64px; background: rgba(255,255,255,0.18); border-radius: 20px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M15.234 8.766L12 12.766L8.766 15.234L12 15.234L15.234 8.766Z" fill="white"/>
          </svg>
        </div>
        <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700;">DocuGuard</h1>
        <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 15px;">Reset Your Password</p>
      </td>
    </tr>

    <tr>
      <td style="padding: 40px 32px;">
        <h2 style="margin: 0 0 16px; color: #111827; font-size: 22px; font-weight: 600;">Reset your password</h2>
        <p style="margin: 0 0 24px; color: #4B5563; font-size: 16px;">We received a request to reset your password. Click the button below to create a new password. This link will expire in 1 hour.</p>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 32px 0;">
          <tr>
            <td style="text-align: center;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="border-radius: 12px; overflow: hidden; box-shadow: 0 6px 20px rgba(220, 38, 38, 0.35);">
                    <a href="${resetLink}" class="button" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-size: 17px; font-weight: 600;">Reset My Password</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <div style="margin-top: 32px; padding: 16px 20px; background-color: #F9FAFB; border-radius: 10px; border: 1px solid #E5E7EB;">
          <p style="margin: 0 0 8px; color: #6B7280; font-size: 12px; text-align: center;">Or copy & paste this URL into your browser:</p>
          <p style="margin: 0; word-break: break-all; color: #DC2626; font-size: 12px; font-family: 'SF Mono', 'Fira Code', 'Roboto Mono', monospace; text-align: center;">${resetLink}</p>
        </div>
      </td>
    </tr>

    <tr>
      <td style="padding: 0 32px;">
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 0;">
      </td>
    </tr>

    <tr>
      <td style="padding: 32px; text-align: center; background-color: #F9FAFB;">
        <p style="margin: 0; color: #9CA3AF; font-size: 13px;">If you didn't request a password reset, you can safely ignore this email.</p>
        <p style="margin: 8px 0 0; color: #D1D5DB; font-size: 12px;">&copy; ${new Date().getFullYear()} DocuGuard. All rights reserved.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Build the link that app-store users click from the email.
 * On web, deep link to the web verification page; on mobile, deep link to the app.
 * @param {string} token
 * @param {boolean} [forWeb=false]
 * @returns {string}
 */
function buildVerificationLink(token, forWeb = false) {
  if (forWeb) {
    return `${APP_BASE_URL}/auth/verify-email-web?token=${token}`;
  }
  const scheme = process.env.APP_DEEPLINK_SCHEME || "docuguard";
  return `${scheme}://verify-email?token=${token}`;
}

/**
 * Send a verification email via Resend.
 * Throws on failure so callers can handle appropriately.
 *
 * @param {string} to - Recipient email
 * @param {string} name - Recipient display name
 * @param {string} token - Verification token
 * @returns {Promise<object>} Resend response
 */
async function sendVerificationEmail(to, name, token) {
  if (!process.env.RESEND_API_KEY) {
    logError("Email", "Cannot send verification email — RESEND_API_KEY missing", { to });
    throw new Error("RESEND_API_KEY is not configured");
  }

  const resend = getResend();
  const verificationLink = buildVerificationLink(token, true);
  const displayName = name || "there";

  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Verify Your Email — DocuGuard",
    html: buildVerificationEmailHtml(displayName, verificationLink),
  });

  if (error) {
    logError("Email", "Resend verification email error", { to, error: error.message || error });
    throw error;
  }

  info("Email", "Verification email sent", { to });
  return data;
}

/**
 * Send a password reset email via Resend.
 * Throws on failure so callers can handle appropriately.
 *
 * @param {string} to - Recipient email
 * @param {string} token - Reset token
 * @returns {Promise<object>} Resend response
 */
async function sendPasswordResetEmail(to, token) {
  if (!process.env.RESEND_API_KEY) {
    logError("Email", "Cannot send password reset email — RESEND_API_KEY missing", { to });
    throw new Error("RESEND_API_KEY is not configured");
  }

  const resend = getResend();
  const resetLink = `${APP_BASE_URL}/auth/reset-password-web?token=${token}`;
  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Reset Your Password — DocuGuard",
    html: buildPasswordResetEmailHtml(resetLink),
  });

  if (error) {
    logError("Email", "Resend password reset email error", { to, error: error.message || error });
    throw error;
  }

  info("Email", "Password reset email sent", { to });
  return data;
}

module.exports = {
  buildVerificationEmailHtml,
  buildPasswordResetEmailHtml,
  buildVerificationLink,
  sendVerificationEmail,
  sendPasswordResetEmail,
  getResend,
  EMAIL_FROM,
  APP_BASE_URL,
};
