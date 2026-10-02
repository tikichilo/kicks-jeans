const express = require('express');
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../models/Order');
const momo = require('../services/momo');
const orderReceipt = require('../services/orderReceipt');
const paymentRoutes = require('../routes/payment');

let providerStatus = 'PENDING';
let startedPayments = 0;
const order = {
  _id: 'order-id',
  orderCode: 'KJ-TEST01',
  total: 100,
  status: 'pending_payment',
  statusHistory: [],
  payment: {
    status: 'pending',
    providerRef: 'deposit-existing',
    provider: 'mtn',
    phone: '260971000000'
  },
  async save() {}
};

Order.findById = async () => order;
momo.checkStatus = async () => ({ status: providerStatus });
momo.initiatePayment = async () => ({
  depositId: `deposit-${++startedPayments}`,
  status: 'PENDING',
  mode: 'mock'
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api/payment', paymentRoutes);
const server = app.listen(0);
const address = server.address();
const endpoint = `http://127.0.0.1:${address.port}/api/payment/initiate`;

after(() => new Promise(resolve => server.close(resolve)));

async function initiate(ip) {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip
    },
    body: JSON.stringify({ orderId: order._id })
  });
}

test('retries for an existing pending payment do not use the start limit', async () => {
  for (let i = 0; i < 9; i++) {
    const response = await initiate('198.51.100.1');
    assert.equal(response.status, 200);
  }
  assert.equal(startedPayments, 0);
});

test('the start limit still applies to fresh provider payment attempts', async () => {
  providerStatus = 'FAILED';
  order.payment.providerRef = 'deposit-failed';

  for (let i = 0; i < 8; i++) {
    const response = await initiate('203.0.113.2');
    assert.equal(response.status, 200);
  }

  const limited = await initiate('203.0.113.2');
  assert.equal(limited.status, 429);
  assert.equal(startedPayments, 8);
});

test('confirmed payment status triggers the customer receipt', async () => {
  order.payment.status = 'pending';
  order.payment.providerRef = 'deposit-completed';
  order.customer = { phone: '260971000000', email: 'customer@example.com' };
  momo.checkStatus = async () => ({ status: 'COMPLETED' });
  orderReceipt.sendReceipt = async () => 'sent';

  const response = await fetch(`${endpoint.replace('/initiate', '')}/status/${order._id}`, {
    headers: { 'X-Forwarded-For': '192.0.2.40' }
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.status, 'paid');
  assert.equal(result.receiptStatus, 'sent');
  assert.equal(order.payment.status, 'paid');
});
