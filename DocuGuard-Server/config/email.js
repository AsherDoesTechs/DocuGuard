const { Resend } = require("resend");
const { debug, info, warn, error: logError } = require("../utils/debugLogger");

let resendInstance = null;

function getResend() {
  if (!resendInstance) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured. Set it in your .env or environment variables.");
    }
    resendInstance = new Resend(process.env.RESEND_API_KEY);
  }
  return resendInstance;
}

const EMAIL_FROM = process.env.EMAIL_FROM || "DocuGuard <noreply@docuguardapp.com>";
const EMAIL_SUPPORT = process.env.EMAIL_SUPPORT || "DocuGuard Support <support@docuguardapp.com>";
const APP_BASE_URL = process.env.APP_BASE_URL || "https://docuguard-api-onoj.onrender.com";

function buildVerificationEmailHtml(name, verificationLink, expiresIn = "24 hours") {
  const displayName = name || "there";
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
        <div style="width: 48px; height: 48px; background: #1a1a1a; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="3" width="18" height="18" rx="4" stroke="white" stroke-width="2"/>
            <path d="M8 12L11 15L16 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1 style="margin: 0 0 4px; color: #1a1a1a; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">DocuGuard</h1>
        <p style="margin: 0; color: #666; font-size: 14px;">Secure Document Management</p>
      </td>
    </tr>

    <!-- Main Content -->
    <tr>
      <td style="padding: 40px;">
        <h2 style="margin: 0 0 12px; color: #1a1a1a; font-size: 22px; font-weight: 600; text-align: center;">Verify Your Email</h2>
        <p style="margin: 0 0 28px; color: #4a4a4a; font-size: 15px; text-align: center; line-height: 1.6;">
          Hi ${displayName},<br><br>
          Thanks for signing up. We need to verify this email address before activating your account.
        </p>

        <!-- CTA Button -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 28px;">
          <tr>
            <td style="text-align: center;">
              <a href="${verificationLink}" style="display: inline-block; padding: 14px 32px; background: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: -0.2px;">Verify Email Address</a>
            </td>
          </tr>
        </table>

        <!-- Expiry + Fallback -->
        <p style="margin: 0 0 16px; color: #999; font-size: 13px; text-align: center;">This link expires in ${expiresIn}.</p>
        
        <div style="padding: 16px; background-color: #fafafa; border-radius: 8px; border: 1px solid #eee;">
          <p style="margin: 0 0 8px; color: #666; font-size: 12px; text-align: center;">If the button doesn't work, copy this link:</p>
          <p style="margin: 0; word-break: break-all; color: #1a1a1a; font-size: 12px; font-family: 'SF Mono', 'Fira Code', 'Roboto Mono', monospace; text-align: center;">${verificationLink}</p>
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
        <p style="margin: 0 0 4px; color: #999; font-size: 12px;">If you didn't create a DocuGuard account, you can safely ignore this email.</p>
        <p style="margin: 0; color: #ccc; font-size: 11px;">&copy; ${new Date().getFullYear()} DocuGuard. All rights reserved.</p>
      </td>
    </tr>
  </table>

  <p style="text-align: center; margin: 20px 0 0; color: #999; font-size: 11px;">Sent from DocuGuard</p>
</body>
</html>`;
}

function buildPasswordResetEmailHtml(resetLink) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password - DocuGuard</title>
</head>
<body style="margin: 0; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #fafafa; line-height: 1.6; color: #1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e5e5; overflow: hidden;">
    
    <!-- Header -->
    <tr>
      <td style="padding: 40px 40px 24px; text-align: center; border-bottom: 1px solid #f0f0f0;">
        <div style="width: 48px; height: 48px; background: #dc2626; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M15.234 8.766L12 12.766L8.766 15.234L12 15.234L15.234 8.766Z" fill="white"/>
          </svg>
        </div>
        <h1 style="margin: 0 0 4px; color: #1a1a1a; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">DocuGuard</h1>
        <p style="margin: 0; color: #666; font-size: 14px;">Password Reset</p>
      </td>
    </tr>

    <!-- Main Content -->
    <tr>
      <td style="padding: 40px;">
        <h2 style="margin: 0 0 12px; color: #1a1a1a; font-size: 22px; font-weight: 600; text-align: center;">Reset Your Password</h2>
        <p style="margin: 0 0 28px; color: #4a4a4a; font-size: 15px; text-align: center; line-height: 1.6;">
          You requested to reset your password. Click the button below to create a new one. This link expires in 1 hour.
        </p>

        <!-- Security Notice -->
        <div style="padding: 14px 16px; background-color: #fef2f2; border-radius: 8px; border: 1px solid #fecaca; margin-bottom: 28px;">
          <p style="margin: 0; color: #991b1b; font-size: 12px; line-height: 1.5;"><strong>Security:</strong> DocuGuard never asks for your password via email. If you didn't request this, ignore this email — your account stays secure.</p>
        </div>

        <!-- CTA Button -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 0 0 28px;">
          <tr>
            <td style="text-align: center;">
              <a href="${resetLink}" style="display: inline-block; padding: 14px 32px; background: #dc2626; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 15px; font-weight: 600; letter-spacing: -0.2px;">Reset Password</a>
            </td>
          </tr>
        </table>

        <!-- Fallback -->
        <div style="padding: 16px; background-color: #fafafa; border-radius: 8px; border: 1px solid #eee;">
          <p style="margin: 0 0 8px; color: #666; font-size: 12px; text-align: center;">If the button doesn't work, copy this link:</p>
          <p style="margin: 0; word-break: break-all; color: #dc2626; font-size: 12px; font-family: 'SF Mono', 'Fira Code', 'Roboto Mono', monospace; text-align: center;">${resetLink}</p>
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
        <p style="margin: 0 0 4px; color: #999; font-size: 12px;">If you didn't request a password reset, you can safely ignore this email.</p>
        <p style="margin: 0; color: #ccc; font-size: 11px;">&copy; ${new Date().getFullYear()} DocuGuard. All rights reserved.</p>
      </td>
    </tr>
  </table>

  <p style="text-align: center; margin: 20px 0 0; color: #999; font-size: 11px;">Sent from DocuGuard</p>
</body>
</html>`;
}

function buildVerificationLink(token, forWeb = false) {
  if (forWeb) {
    return `${APP_BASE_URL}/auth/verify-email-web?token=${token}`;
  }
  const scheme = process.env.APP_DEEPLINK_SCHEME || "docuguard";
  return `${scheme}://verify-email?token=${token}`;
}

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

  info("Email", "Verification email sent", { to, messageId: data?.id });
  return data;
}

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

  info("Email", "Password reset email sent", { to, messageId: data?.id });
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
  EMAIL_SUPPORT,
  APP_BASE_URL,
};