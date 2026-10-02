// Mobile money payments — MTN Mobile Money & Airtel Money, Zambia.
//
// Uses pawaPay (https://pawapay.io) as the aggregator: one API, both
// MTN and Airtel Zambia, rather than integrating each network directly.
// Swap this file's internals for a different provider (e.g. calling MTN's
// Collections API and Airtel's Collection API separately) if you'd rather
// not use an aggregator — the initiatePayment/checkStatus shape is what
// routes/payment.js and the frontend depend on.
//
// PAYMENT_MODE=mock explicitly enables simulated payments for local development.

const axios = require('axios');
const { nanoid } = require('nanoid');

const PAYMENT_MODES = ['live', 'mock'];
const requestedMode = process.env.PAYMENT_MODE;
const hasApiToken = Boolean(process.env.PAWAPAY_API_TOKEN);

if (requestedMode && !PAYMENT_MODES.includes(requestedMode)) {
  throw new Error('PAYMENT_MODE must be either "live" or "mock".');
}
if (process.env.NODE_ENV === 'production' && requestedMode === 'mock') {
  throw new Error('Mock payments are disabled in production. Set PAYMENT_MODE=live.');
}
if (process.env.NODE_ENV === 'production' && !hasApiToken) {
  throw new Error('PAWAPAY_API_TOKEN is required in production.');
}
if (requestedMode === 'live' && !hasApiToken) {
  throw new Error('PAWAPAY_API_TOKEN is required when PAYMENT_MODE=live.');
}

const MODE = requestedMode === 'mock' ? 'mock' : hasApiToken ? 'live' : 'unconfigured';
const BASE_URL = process.env.PAWAPAY_BASE_URL || (
  process.env.NODE_ENV === 'production'
    ? 'https://api.pawapay.io'
    : 'https://api.sandbox.pawapay.io'
);

if (process.env.NODE_ENV === 'production' &&
  /sandbox/i.test(BASE_URL)) {
  throw new Error('Set PAWAPAY_BASE_URL to the pawaPay production URL in production.');
}

const CORRESPONDENTS = {
  mtn: 'MTN_MOMO_ZMB',
  airtel: 'AIRTEL_OAPI_ZMB'
};

// In-memory store for mock mode only. In live mode, order status is the
// source of truth (updated via the pawaPay webhook in routes/payment.js).
const mockDeposits = new Map();

async function initiatePayment({ provider, phone, amount, orderCode }) {
  const depositId = nanoid();

  if (MODE === 'unconfigured') {
    const error = new Error('Mobile Money payments are not configured.');
    error.status = 503;
    throw error;
  }

  if (MODE === 'mock') {
    mockDeposits.set(depositId, { status: 'PENDING', provider, phone, amount, orderCode });
    // Simulate the network confirming payment after a short delay.
    setTimeout(() => {
      const d = mockDeposits.get(depositId);
      if (d) d.status = 'COMPLETED';
    }, 6000);
    return { depositId, status: 'PENDING', mode: 'mock' };
  }

  const correspondent = CORRESPONDENTS[provider];
  if (!correspondent) throw new Error(`Unsupported provider: ${provider}`);

  const res = await axios.post(
    `${BASE_URL}/deposits`,
    {
      depositId,
      amount: String(amount),
      currency: 'ZMW',
      correspondent,
      payer: { type: 'MSISDN', address: { value: phone } },
      customerTimestamp: new Date().toISOString(),
      statementDescription: `Kicks&Jeans ${orderCode}`.slice(0, 22)
    },
    {
      headers: { Authorization: `Bearer ${process.env.PAWAPAY_API_TOKEN}` },
      timeout: 15000
    }
  );

  return { depositId, status: res.data.status, mode: 'live' };
}

async function checkStatus(depositId) {
  if (MODE === 'unconfigured') {
    const error = new Error('Mobile Money payments are not configured.');
    error.status = 503;
    throw error;
  }

  if (MODE === 'mock') {
    const d = mockDeposits.get(depositId);
    if (!d) return { status: 'FAILED' };
    return { status: d.status };
  }

  const res = await axios.get(`${BASE_URL}/deposits/${depositId}`, {
    headers: { Authorization: `Bearer ${process.env.PAWAPAY_API_TOKEN}` },
    timeout: 15000
  });
  return { status: res.data.status };
}

module.exports = { initiatePayment, checkStatus, MODE };
