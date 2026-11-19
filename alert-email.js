function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function createAlertEmailHtml(message, type) {
  const safeMessage = escapeHtml(message);
  const safeType = escapeHtml(type);
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Campus Voice alert</title></head>
  <body style="margin:0;padding:24px;background:#f5f7f2;font-family:Arial,sans-serif;color:#173c37">
    <table role="presentation" style="width:100%;max-width:600px;margin:0 auto;background:#fff;border:1px solid #dfe6da;border-radius:12px" cellpadding="0" cellspacing="0">
      <tr><td style="padding:24px">
        <p style="margin:0 0 8px;color:#9a6310;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Campus Voice · ${safeType}</p>
        <h1 style="margin:0 0 16px;font-size:22px">A new feedback trend alert</h1>
        <p style="margin:0;font-size:16px;line-height:1.6">${safeMessage}</p>
        <p style="margin:24px 0 0;color:#667770;font-size:12px">Open the administrator dashboard to review the notification history and related feedback.</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function isAlertEmailConfigured(env = process.env) {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.ADMIN_EMAIL);
}

async function sendAlertEmail({ message, type }, env = process.env) {
  if (!isAlertEmailConfigured(env)) return false;
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to: env.ADMIN_EMAIL,
    subject: 'Campus Voice: new feedback alert',
    text: `${type}: ${message}`,
    html: createAlertEmailHtml(message, type)
  });
  return true;
}

module.exports = { createAlertEmailHtml, isAlertEmailConfigured, sendAlertEmail };
