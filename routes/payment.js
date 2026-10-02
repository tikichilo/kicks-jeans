const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const momo = require('../services/momo');
const orderReceipt = require('../services/orderReceipt');
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

async function trySendReceipt(order) {
  try {
    return await orderReceipt.sendReceipt(order);
  } catch (err) {
    console.error(`Could not email receipt for ${order.orderCode}:`, err.message);
    return 'failed';
  }
}

async function preparePayment(req, res, next) {
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
        const receiptStatus = await trySendReceipt(order);
        return res.json({
          orderCode: order.orderCode,
          depositId: order.payment.providerRef,
          status: 'COMPLETED',
          receiptStatus
        });
      }
      if (existing.status !== 'FAILED') {
        return res.json({ orderCode: order.orderCode, depositId: order.payment.providerRef, status: existing.status });
      }
      order.payment.status = 'failed';
    }

    res.locals.paymentOrder = order;
    next();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function startPayment(req, res) {
  try {
    const order = res.locals.paymentOrder;
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
    res.status(err.status || 500).json({ error: err.message });
  }
}

// POST /api/payment/initiate  { orderId }
router.post('/initiate', preparePayment, limitPaymentStarts, startPayment);

// GET /api/payment/status/:orderId — frontend polls this while waiting for
// the customer to approve the MoMo prompt on their phone
router.get('/status/:orderId', limitPaymentChecks, async (req, res) => {
  try {
    let receiptStatus;
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment.status === 'paid') {
      const receiptStatus = await trySendReceipt(order);
      return res.json({
        status: 'paid',
        receiptStatus,
        order: { orderCode: order.orderCode, customer: { phone: order.customer.phone } }
      });
    }

    const result = await momo.checkStatus(order.payment.providerRef);
    if (result.status === 'COMPLETED') {
      confirmPayment(order);
      await order.save();
      receiptStatus = await trySendReceipt(order);
    } else if (result.status === 'FAILED') {
      order.payment.status = 'failed';
      await order.save();
    }
    res.json({
      status: order.payment.status,
      receiptStatus: order.payment.status === 'paid' ? receiptStatus : undefined,
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
    if (verifiedPayment.status === 'COMPLETED') await trySendReceipt(order);
    res.status(200).end();
  } catch (err) {
    console.error('Payment webhook verification failed:', err.message);
    res.status(500).end();
  }
});

module.exports = router;
