const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const momo = require('../services/momo');
const apiRateLimit = require('../utils/apiRateLimit');

const limitPaymentStarts = apiRateLimit(8, 'Too many payment attempts. Please wait before trying again.');
const limitPaymentChecks = apiRateLimit(60, 'Too many payment status checks. Please wait before trying again.');

function confirmPayment(order) {
  order.payment.status = 'paid';
  if (order.status === 'pending_payment') {
    order.status = 'processing';
    order.statusHistory.push({ status: 'processing', message: 'Payment confirmed; order is being prepared' });
  }
}

// POST /api/payment/initiate  { orderId }
router.post('/initiate', limitPaymentStarts, async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment.status === 'paid') return res.status(409).json({ error: 'This order has already been paid' });
    if (['cancelled', 'delivered'].includes(order.status)) {
      return res.status(409).json({ error: 'This order can no longer accept payment' });
    }

    if (order.payment.status === 'pending' && order.payment.providerRef) {
      const existing = await momo.checkStatus(order.payment.providerRef);
      if (existing.status === 'COMPLETED') {
        confirmPayment(order);
        await order.save();
        return res.json({ orderCode: order.orderCode, depositId: order.payment.providerRef, status: 'COMPLETED' });
      }
      if (existing.status !== 'FAILED') {
        return res.json({ orderCode: order.orderCode, depositId: order.payment.providerRef, status: existing.status });
      }
      order.payment.status = 'failed';
    }

    const result = await momo.initiatePayment({
      provider: order.payment.provider,
      phone: order.payment.phone,
      amount: order.total,
      orderCode: order.orderCode
    });

    order.payment.providerRef = result.depositId;
  order.payment.status = 'pending';
    await order.save();

    res.json({ orderCode: order.orderCode, depositId: result.depositId, mode: result.mode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payment/status/:orderId — frontend polls this while waiting for
// the customer to approve the MoMo prompt on their phone
router.get('/status/:orderId', limitPaymentChecks, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment.status === 'paid') {
      return res.json({
        status: 'paid',
        order: { orderCode: order.orderCode, customer: { phone: order.customer.phone } }
      });
    }

    const result = await momo.checkStatus(order.payment.providerRef);
    if (result.status === 'COMPLETED') {
      confirmPayment(order);
      await order.save();
    } else if (result.status === 'FAILED') {
      order.payment.status = 'failed';
      await order.save();
    }
    res.json({
      status: order.payment.status,
      order: order.payment.status === 'paid'
        ? { orderCode: order.orderCode, customer: { phone: order.customer.phone } }
        : undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payment/webhook — pawaPay calls this in live mode when a
// deposit's status changes. Point your pawaPay dashboard callback URL here.
router.post('/webhook', async (req, res) => {
  try {
    const { depositId } = req.body;
    if (typeof depositId !== 'string' || !depositId) {
      return res.status(400).json({ error: 'Missing deposit ID' });
    }

    const order = await Order.findOne({ 'payment.providerRef': depositId });
    if (!order) return res.status(404).end();

    const verifiedPayment = await momo.checkStatus(depositId);
    if (verifiedPayment.status === 'COMPLETED') {
      confirmPayment(order);
    } else if (verifiedPayment.status === 'FAILED' && order.payment.status !== 'paid') {
      order.payment.status = 'failed';
    } else {
      return res.status(200).end();
    }

    await order.save();
    res.status(200).end();
  } catch (err) {
    console.error('Payment webhook verification failed:', err.message);
    res.status(500).end();
  }
});

module.exports = router;
