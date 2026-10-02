const nodemailer = require('nodemailer');

function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  });
}

const transporter = createTransporter();

async function sendPasswordResetEmail({ to, name, token }) {
  if (!transporter) {
    throw new Error('Gmail password reset email is not configured.');
  }

  const baseUrl = new URL(process.env.SITE_URL || 'https://kicksandjeans.co.zm').origin;
  const resetUrl = new URL('/admin', baseUrl);
  resetUrl.hash = new URLSearchParams({ resetToken: token }).toString();

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: 'Reset your Kicks & Jeans admin password',
    text: [
      `Hello ${name},`,
      '',
      'Use the link below to reset your Kicks & Jeans admin password. This link expires in 30 minutes and can only be used once.',
      resetUrl.toString(),
      '',
      'If you did not request this reset, you can ignore this email.'
    ].join('\n'),
    html: `<p>Hello ${escapeHtml(name)},</p>
      <p>Use the link below to reset your Kicks &amp; Jeans admin password. This link expires in 30 minutes and can only be used once.</p>
      <p><a href="${escapeHtml(resetUrl.toString())}">Reset admin password</a></p>
      <p>If you did not request this reset, you can ignore this email.</p>`
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

module.exports = { sendPasswordResetEmail };
