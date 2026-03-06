import { Resend } from 'resend';
import logger from '../logger.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = 'noreply@bullem.cards';

let resend: Resend | null = null;

if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
} else {
  logger.warn('RESEND_API_KEY not set — emails will be logged but not sent');
}

/**
 * Send a password reset email with the given plaintext token.
 * The link points to the client-side reset page with the token as a query param.
 */
export async function sendPasswordResetEmail(to: string, resetToken: string): Promise<void> {
  const baseUrl = process.env.APP_URL ?? 'https://bullem.fly.dev';
  const resetLink = `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

  const subject = 'Reset your Bull \'Em password';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#072914;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#072914;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:480px;background-color:#0b3d1e;border:1px solid rgba(212,168,67,0.3);border-radius:12px;padding:40px 32px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <h1 style="margin:0;font-size:28px;color:#d4a843;font-family:Georgia,'Times New Roman',serif;">
                Bull 'Em
              </h1>
            </td>
          </tr>
          <tr>
            <td style="color:#e8e0d4;font-size:16px;line-height:1.6;">
              <p style="margin:0 0 16px;">You requested a password reset. Click the button below to choose a new password:</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 0;">
              <a href="${resetLink}"
                 style="display:inline-block;background:linear-gradient(135deg,#d4a843,#b8912e);color:#1a1a1a;font-weight:bold;font-size:16px;padding:14px 32px;border-radius:8px;text-decoration:none;">
                Reset Password
              </a>
            </td>
          </tr>
          <tr>
            <td style="color:#a07c2e;font-size:13px;line-height:1.5;">
              <p style="margin:0 0 8px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
              <p style="margin:0;word-break:break-all;font-size:12px;color:#7a6a4a;">
                ${resetLink}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

  const text = `Reset your Bull 'Em password\n\nYou requested a password reset. Visit this link to choose a new password:\n\n${resetLink}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.`;

  if (!resend) {
    logger.info({ to, resetLink }, 'Password reset email (not sent — no RESEND_API_KEY)');
    return;
  }

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
      text,
    });
    logger.info({ to }, 'Password reset email sent');
  } catch (err) {
    logger.error({ err, to }, 'Failed to send password reset email');
    throw err;
  }
}
