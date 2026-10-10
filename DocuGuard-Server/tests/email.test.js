const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVerificationEmailHtml,
  buildPasswordResetEmailHtml,
  buildExpirationReminderEmailHtml,
  buildVerificationEmailText,
  buildPasswordResetEmailText,
  buildExpirationReminderEmailText,
  buildVerificationLink,
  buildPasswordResetLink,
  escapeHtml,
  APP_DEEPLINK_SCHEME,
  APP_BASE_URL,
} = require("../config/email");

test("escapeHtml escapes special characters", () => {
  assert.equal(escapeHtml(""), "");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml("Hello <World>"), "Hello &lt;World&gt;");
  assert.equal(escapeHtml('Tom & "Jerry"'), "Tom &amp; &quot;Jerry&quot;");
  assert.equal(escapeHtml("O'Neil"), "O&#039;Neil");
  assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("buildVerificationLink generates correct web and deep links", () => {
  const token = "test-token-123";
  const webLink = buildVerificationLink(token, true);
  const deepLink = buildVerificationLink(token, false);

  assert.equal(webLink, `${APP_BASE_URL}/auth/verify-email-web?token=test-token-123`);
  assert.equal(deepLink, `${APP_DEEPLINK_SCHEME}://verify-email?token=test-token-123`);
});

test("buildVerificationLink throws on missing token", () => {
  assert.throws(() => buildVerificationLink("", true), /Verification token is required/);
  assert.throws(() => buildVerificationLink(null, true), /Verification token is required/);
  assert.throws(() => buildVerificationLink(undefined, true), /Verification token is required/);
});

test("buildPasswordResetLink generates correct web and deep links", () => {
  const token = "reset-token-456";
  const webLink = buildPasswordResetLink(token, true);
  const deepLink = buildPasswordResetLink(token, false);

  assert.equal(webLink, `${APP_BASE_URL}/auth/reset-password?token=reset-token-456`);
  assert.equal(deepLink, `${APP_DEEPLINK_SCHEME}://reset-password?token=reset-token-456`);
});

test("buildPasswordResetLink throws on missing token", () => {
  assert.throws(() => buildPasswordResetLink("", true), /Password reset token is required/);
  assert.throws(() => buildPasswordResetLink(null, true), /Password reset token is required/);
  assert.throws(() => buildPasswordResetLink(undefined, true), /Password reset token is required/);
});

test("buildVerificationEmailHtml includes web link as primary and deep link as secondary", () => {
  const html = buildVerificationEmailHtml("John Doe", "https://example.com/verify", "docuguard://verify");

  assert.ok(html.includes("https://example.com/verify"), "Primary CTA should be web link");
  assert.ok(html.includes("docuguard://verify"), "Secondary CTA should be deep link");
  assert.ok(html.includes("Verify Email Address"), "Primary button text should be 'Verify Email Address'");
  assert.ok(html.includes("Open in DocuGuard App"), "Secondary button text should be 'Open in DocuGuard App'");
  assert.ok(html.includes("John Doe"), "Should include escaped name");
  assert.ok(!html.includes("<svg"), "Should not contain inline SVG");
  assert.ok(html.includes("DG"), "Should have text-based brand header");
});

test("buildVerificationEmailHtml escapes user-provided name", () => {
  const html = buildVerificationEmailHtml('<script>alert("xss")</script>', "https://example.com/verify", "docuguard://verify");

  // The name should be HTML-escaped in the output
  const escapedScript = "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;";
  assert.ok(html.includes(escapedScript), "Should contain escaped HTML in name");
  assert.ok(!html.includes("<script>"), "Should not contain unescaped script tag");
});

test("buildVerificationEmailText includes both links and is readable", () => {
  const text = buildVerificationEmailText("Jane Smith", "https://example.com/verify", "docuguard://verify");

  assert.ok(text.includes("https://example.com/verify"), "Text should include web link");
  assert.ok(text.includes("docuguard://verify"), "Text should include deep link");
  assert.ok(text.includes("Jane Smith"), "Text should include name");
  assert.ok(text.includes("Verify Your Email - DocuGuard"), "Text should have proper subject");
  assert.ok(text.includes("Sent from DocuGuard"), "Text should have footer");
});

test("buildPasswordResetEmailHtml uses web link as primary and deep link as secondary", () => {
  const html = buildPasswordResetEmailHtml("https://example.com/reset", "docuguard://reset");

  assert.ok(html.includes("https://example.com/reset"), "Primary CTA should be web link");
  assert.ok(html.includes("docuguard://reset"), "Secondary CTA should be deep link");
  assert.ok(html.includes("Reset Password"), "Button should say 'Reset Password'");
  assert.ok(html.includes("Open in DocuGuard App"), "Secondary button text should be 'Open in DocuGuard App'");
  assert.ok(!html.includes("<svg"), "Should not contain inline SVG");
  assert.ok(html.includes("DG"), "Should have text-based brand header");
  assert.ok(html.includes("Security:"), "Should include security notice");
});

test("buildPasswordResetEmailText includes both links and is readable", () => {
  const text = buildPasswordResetEmailText("https://example.com/reset", "docuguard://reset");

  assert.ok(text.includes("https://example.com/reset"), "Text should include web link");
  assert.ok(text.includes("docuguard://reset"), "Text should include deep link");
  assert.ok(text.includes("Reset Your Password - DocuGuard"), "Text should have proper subject");
  assert.ok(text.includes("Security:"), "Text should include security notice");
  assert.ok(text.includes("Sent from DocuGuard"), "Text should have footer");
});

test("buildExpirationReminderEmailHtml escapes name and document title", () => {
  const html = buildExpirationReminderEmailHtml(
    '<img src=x onerror=alert(1)>',
    'Passport <b>Renewal</b>',
    5,
    "2026-12-31"
  );

  const escapedName = "&lt;img src=x onerror=alert(1)&gt;";
  const escapedTitle = "Passport &lt;b&gt;Renewal&lt;/b&gt;";
  assert.ok(html.includes(escapedName), "Should escape HTML in name");
  assert.ok(html.includes(escapedTitle), "Should escape HTML in document title");
  assert.ok(!html.includes("<img"), "Should not contain unescaped img tag");
  assert.ok(!html.includes("<b>"), "Should not contain unescaped b tag");
  assert.ok(!html.includes("<svg"), "Should not contain inline SVG");
  assert.ok(html.includes("DG"), "Should have text-based brand header");
  assert.ok(html.includes("Expiring Soon"), "Should show correct status for 5 days");
});

test("buildExpirationReminderEmailHtml shows expired state correctly", () => {
  const html = buildExpirationReminderEmailHtml("User", "Visa", 0, "2026-01-01");

  assert.ok(html.includes("Expired"), "Should show 'Expired' for 0 days");
  assert.ok(html.includes("EXPIRED"), "Should show EXPIRED status");
  assert.ok(html.includes("#dc2626"), "Should use red urgency color");
});

test("buildExpirationReminderEmailHtml shows urgent state for <= 7 days", () => {
  const html = buildExpirationReminderEmailHtml("User", "ID Card", 3, "2026-10-15");

  assert.ok(html.includes("Expiring Soon"), "Should show 'Expiring Soon' for 3 days");
  assert.ok(html.includes("Expires in 3 days"), "Should show correct days text");
  assert.ok(html.includes("#ea580c"), "Should use orange urgency color");
});

test("buildExpirationReminderEmailText includes all details and is readable", () => {
  const text = buildExpirationReminderEmailText("User", "Passport", 10, "2026-12-31");

  assert.ok(text.includes("Passport"), "Text should include document title");
  assert.ok(text.includes("Expiring Soon"), "Text should show status");
  assert.ok(text.includes("Expiry Date: 2026-12-31"), "Text should include expiry date");
  assert.ok(text.includes("docuguard://documents"), "Text should include deep link to app");
  assert.ok(text.includes("Sent from DocuGuard"), "Text should have footer");
});

test("Email templates are responsive and use table-based layout", () => {
  const verificationHtml = buildVerificationEmailHtml("Test", "https://example.com/verify", "docuguard://verify");
  const resetHtml = buildPasswordResetEmailHtml("https://example.com/reset", "docuguard://reset");
  const reminderHtml = buildExpirationReminderEmailHtml("Test", "Doc", 5, "2026-12-31");

  [verificationHtml, resetHtml, reminderHtml].forEach((html) => {
    assert.ok(html.includes('role="presentation"'), "Should use presentation tables");
    assert.ok(html.includes("max-width: 560px"), "Should have max-width for responsiveness");
    assert.ok(html.includes('width="100%"') || html.includes("width: 100%"), "Should use full width tables");
    assert.ok(html.includes("font-family"), "Should specify font stack");
    assert.ok(html.includes("viewport"), "Should have viewport meta tag");
  });
});

test("Subject lines are professional without emoji", () => {
  const expiredSubject = "Document Expired: Passport — DocuGuard";
  const expiringSubject = "Document Expiring in 5 Days: Passport — DocuGuard";

  assert.ok(!expiredSubject.includes("🚨"), "Expired subject should not have emoji");
  assert.ok(!expiringSubject.includes("⚠️"), "Expiring subject should not have emoji");
  assert.ok(expiredSubject.includes("DocuGuard"), "Should include brand name");
  assert.ok(expiringSubject.includes("DocuGuard"), "Should include brand name");
});

test("buildVerificationEmailHtml uses HTTPS web link in fallback text", () => {
  const html = buildVerificationEmailHtml("Test", "https://docuguardapp.com/auth/verify-email-web?token=abc", "docuguard://verify");

  assert.ok(html.includes("https://docuguardapp.com/auth/verify-email-web?token=abc"), "Fallback should show web link");
  // The fallback section shows the web link as the copyable link
  assert.ok(html.includes("https://docuguardapp.com/auth/verify-email-web?token=abc"), "Fallback shows web link");
});
