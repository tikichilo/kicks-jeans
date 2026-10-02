const nodemailer = require('nodemailer');
const Order = require('../models/Order');

const RETRY_DELAY_MS = 5 * 60 * 1000;
const STALE_SEND_MS = 15 * 60 * 1000;

function readSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 0);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || user;
  const configured = Boolean(host || process.env.SMTP_PORT || user || pass || from);

  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS are required in production to send order receipts.');
  }
  if (configured && (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !from)) {
    throw new Error('Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM (or use SMTP_USER as sender).');
  }

  return configured ? { host, port, user, pass, from } : null;
}

const smtpConfig = readSmtpConfig();
const transporter = smtpConfig && nodemailer.createTransport({
  host: smtpConfig.host,
  port: smtpConfig.port,
  secure: smtpConfig.port === 465,
  auth: { user: smtpConfig.user, pass: smtpConfig.pass },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function money(amount) {
  return `ZMW ${Number(amount).toFixed(2)}`;
}

function buildReceiptEmail(order) {
  const items = order.items.map(item => ({
    name: item.name,
    details: [item.size, item.color].filter(Boolean).join(' / '),
    quantity: item.qty,
    unitPrice: Number(item.price),
    lineTotal: Number(item.price) * Number(item.qty)
  }));
  const rows = items.map(item => `
    <tr>
      <td style="padding:10px 6px;border-bottom:1px solid #d9deea">
        ${escapeHtml(item.name)}${item.details ? `<br><small>${escapeHtml(item.details)}</small>` : ''}
      </td>
      <td style="padding:10px 6px;text-align:center;border-bottom:1px solid #d9deea">${escapeHtml(item.quantity)}</td>
      <td style="padding:10px 6px;text-align:right;border-bottom:1px solid #d9deea">${money(item.lineTotal)}</td>
    </tr>`).join('');
  const customerName = escapeHtml(order.customer.name);
  const address = [
    order.customer.address,
    order.customer.town,
    order.customer.province
  ].filter(Boolean).map(escapeHtml).join(', ');
  const provider = order.payment.provider === 'mtn' ? 'MTN Money' : 'Airtel Money';
  const plainItems = items.map(item =>
    `${item.name}${item.details ? ` (${item.details})` : ''} x ${item.quantity}: ${money(item.lineTotal)}`
  ).join('\n');

  return {
    subject: `Your Kicks & Jeans receipt — ${order.orderCode}`,
    text: [
      `Hello ${order.customer.name},`,
      '',
      `Payment confirmed. Receipt for order ${order.orderCode}:`,
      plainItems,
      '',
      `Subtotal: ${money(order.subtotal)}`,
      `Delivery: ${money(order.deliveryFee)}`,
      `Total paid: ${money(order.total)}`,
      `Payment: ${provider} (${order.payment.phone})`,
      `Deliver to: ${address}`,
      '',
      `To track your order, visit ${process.env.SITE_URL || 'https://kicksandjeans.co.zm'}/track and enter your order code and delivery phone number.`,
      'Thank you for shopping with Kicks & Jeans.'
    ].join('\n'),
    html: `<!doctype html>
<html lang="en">
<body style="margin:0;background:#f4f4f1;color:#14161c;font-family:Arial,sans-serif">
  <main style="max-width:640px;margin:24px auto;padding:24px;background:#fff;border:2px solid #14161c">
    <h1 style="margin-top:0;color:#1f3768">Payment received</h1>
    <p>Hello ${customerName},</p>
    <p>Thank you for your order. Your payment is confirmed.</p>
    <p><strong>Order number: ${escapeHtml(order.orderCode)}</strong></p>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr><th style="text-align:left">Item</th><th>Qty</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="text-align:right">Subtotal: ${money(order.subtotal)}<br>
      Delivery: ${money(order.deliveryFee)}<br>
      <strong>Total paid: ${money(order.total)}</strong></p>
    <p>Paid using ${escapeHtml(provider)} (${escapeHtml(order.payment.phone)}).</p>
    <p>Delivery address: ${address}</p>
    <p><a href="${escapeHtml(process.env.SITE_URL || 'https://kicksandjeans.co.zm')}/track">Track your order</a> using your order number and delivery phone.</p>
  </main>
</body>
</html>`
  };
}

async function sendReceipt(order) {
  if (order.receipt?.status === 'sent') return 'sent';
  if (!transporter) throw new Error('Order receipt email is not configured; set the SMTP settings.');

  const now = new Date();
  const retryBefore = new Date(now.getTime() - RETRY_DELAY_MS);
  const staleBefore = new Date(now.getTime() - STALE_SEND_MS);
  const claimedOrder = await Order.findOneAndUpdate({
    _id: order._id,
    'payment.status': 'paid',
    $or: [
      { 'receipt.status': 'pending' },
      { 'receipt.status': { $exists: false } },
      { 'receipt.status': 'failed', 'receipt.lastAttemptAt': { $lte: retryBefore } },
      { 'receipt.status': 'sending', 'receipt.lastAttemptAt': { $lte: staleBefore } }
    ]
  }, {
    $set: { 'receipt.status': 'sending', 'receipt.lastAttemptAt': now },
    $unset: { 'receipt.error': 1 },
    $inc: { 'receipt.attempts': 1 }
  }, { new: true });

  if (!claimedOrder) return order.receipt?.status || 'sending';

  try {
    const receipt = buildReceiptEmail(claimedOrder);
    await transporter.sendMail({
      from: smtpConfig.from,
      to: claimedOrder.customer.email,
      ...receipt
    });
  } catch (error) {
    await Order.updateOne({ _id: claimedOrder._id, 'receipt.status': 'sending' }, {
      $set: { 'receipt.status': 'failed', 'receipt.error': 'Email delivery failed' }
    });
    throw error;
  }

  await Order.updateOne({ _id: claimedOrder._id, 'receipt.status': 'sending' }, {
    $set: { 'receipt.status': 'sent', 'receipt.sentAt': new Date() },
    $unset: { 'receipt.error': 1 }
  });
  return 'sent';
}

module.exports = { sendReceipt, buildReceiptEmail };
