const express = require('express');
const router = express.Router();
const { customAlphabet } = require('nanoid');
const Order = require('../models/Order');
const Product = require('../models/Product');
const { calculateDeliveryFee, PROVINCE_RATES } = require('../services/delivery');
const { requireAdmin } = require('../middleware/adminAuth');
const apiRateLimit = require('../utils/apiRateLimit');

const limitQuotes = apiRateLimit(30, 'Too many delivery quotes. Please wait before trying again.');
const limitOrders = apiRateLimit(8, 'Too many orders from this connection. Please wait before trying again.');
const limitTracking = apiRateLimit(60, 'Too many tracking lookups. Please wait before trying again.');

const genCode = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 6);
const ORDER_STATUSES = ['pending_payment', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];

function validateOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 'Cart is empty';
  if (items.length > 50) return 'Cart has too many line items';
  if (items.some(item => !item || typeof item.productId !== 'string' || !item.productId.trim() ||
    !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 20 ||
    (item.size != null && typeof item.size !== 'string') ||
    (item.color != null && typeof item.color !== 'string'))) {
    return 'Each item must have a valid product, size, colour, and quantity from 1 to 20';
  }
  return null;
}

function validateProductSelection(item, product) {
  if (!product || !product.inStock) return 'This product is currently unavailable';
  if (item.size && !product.sizes.includes(item.size)) return `Size ${item.size} is not available for ${product.name}`;
  if (item.color && !product.colors.includes(item.color)) return `Colour ${item.color} is not available for ${product.name}`;
  return null;
}

function publicOrder(order) {
  return {
    orderCode: order.orderCode,
    items: order.items.map(({ name, price, size, color, qty }) => ({ name, price, size, color, qty })),
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    customer: { town: order.customer.town, province: order.customer.province },
    paymentStatus: order.payment.status,
    status: order.status,
    statusHistory: order.statusHistory?.length
      ? order.statusHistory
      : [{ status: order.status, message: 'Latest order status', createdAt: order.updatedAt || order.createdAt }],
    shipment: order.shipment || {},
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

// GET /api/orders/delivery-rates — province list + fees, for the checkout UI
router.get('/delivery-rates', (req, res) => {
  res.json(PROVINCE_RATES);
});

// POST /api/orders/quote — recompute total server-side before payment
router.post('/quote', limitQuotes, async (req, res) => {
  try {
    const { items, province, express } = req.body;
    const itemsError = validateOrderItems(items);
    if (itemsError) return res.status(400).json({ error: itemsError });

    let deliveryFee;
    try {
      deliveryFee = calculateDeliveryFee({ province, express: !!express });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let subtotal = 0;
    for (const item of items) {
      const product = await Product.findById(item.productId);
      const selectionError = validateProductSelection(item, product);
      if (selectionError) return res.status(400).json({ error: selectionError });
      subtotal += product.price * item.qty;
    }

    res.json({ subtotal, deliveryFee, total: subtotal + deliveryFee });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/orders — create a pending order (payment initiated separately)
router.post('/', limitOrders, async (req, res) => {
  try {
    const { items, customer, payment, express } = req.body;
    const itemsError = validateOrderItems(items);
    if (itemsError) return res.status(400).json({ error: itemsError });
    if (!customer || !customer.name || !customer.phone || !customer.province || !customer.town || !customer.address) {
      return res.status(400).json({ error: 'Missing delivery details' });
    }
    if (!payment || !['mtn', 'airtel'].includes(payment.provider) || !payment.phone) {
      return res.status(400).json({ error: 'Missing payment details' });
    }

    let deliveryFee;
    try {
      deliveryFee = calculateDeliveryFee({ province: customer.province, express: !!express });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let subtotal = 0;
    const lineItems = [];
    for (const item of items) {
      const product = await Product.findById(item.productId);
      const selectionError = validateProductSelection(item, product);
      if (selectionError) return res.status(400).json({ error: selectionError });
      subtotal += product.price * item.qty;
      lineItems.push({
        productId: product._id,
        name: product.name,
        price: product.price,
        size: item.size,
        color: item.color,
        qty: item.qty
      });
    }

    const total = subtotal + deliveryFee;

    let orderCode;
    // Ensure uniqueness (very unlikely to collide, but check anyway)
    do {
      orderCode = `KJ-${genCode()}`;
    } while (await Order.findOne({ orderCode }));

    const order = await Order.create({
      orderCode,
      items: lineItems,
      subtotal,
      deliveryFee,
      total,
      customer,
      payment: {
        method: 'momo',
        provider: payment.provider,
        phone: payment.phone,
        status: 'pending'
      },
      status: 'pending_payment',
      statusHistory: [{ status: 'pending_payment', message: 'Order placed; awaiting payment confirmation' }]
    });

    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/track/:code — order tracking page looks orders up by code + phone
router.get('/track/:code', limitTracking, async (req, res) => {
  try {
    const { phone } = req.query;
    const order = await Order.findOne({ orderCode: req.params.code.toUpperCase() });
    if (!order) return res.status(404).json({ error: 'No order found with that code' });
    if (!phone || order.customer.phone.replace(/\D/g, '').slice(-9) !== String(phone).replace(/\D/g, '').slice(-9)) {
      return res.status(403).json({ error: 'Phone number does not match this order' });
    }
    res.set('Cache-Control', 'no-store');
    res.json(publicOrder(order));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders/:code/status — protected staff update for fulfillment milestones
router.post('/:code/status', requireAdmin, async (req, res) => {
  try {
    const { status, message, carrier, trackingNumber, trackingUrl } = req.body;
    if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid order status' });

    const order = await Order.findOne({ orderCode: req.params.code.toUpperCase() });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === status) return res.status(409).json({ error: 'Order is already at this status' });
    if (order.status === 'cancelled' || order.status === 'delivered') {
      return res.status(409).json({ error: 'This order can no longer be updated' });
    }

    const currentIndex = ORDER_STATUSES.slice(0, 5).indexOf(order.status);
    const nextStatus = ORDER_STATUSES.slice(0, 5)[currentIndex + 1];
    if (status !== 'cancelled' && status !== nextStatus) {
      return res.status(409).json({ error: `Next allowed status is ${nextStatus || 'none'}` });
    }
    if (status === 'cancelled' && order.payment.status === 'paid') {
      return res.status(409).json({ error: 'Paid orders cannot be cancelled through tracking' });
    }
    if (status === 'processing' && order.payment.status !== 'paid') {
      return res.status(409).json({ error: 'Payment must be confirmed before processing' });
    }

    if (status === 'shipped') {
      if (!carrier || !trackingNumber) {
        return res.status(400).json({ error: 'Carrier and tracking number are required when shipping' });
      }
      if (trackingUrl && !/^https?:\/\//i.test(trackingUrl)) {
        return res.status(400).json({ error: 'Tracking URL must use http or https' });
      }
      order.shipment = { carrier, trackingNumber, trackingUrl };
    }

    order.status = status;
    order.statusHistory.push({
      status,
      message: typeof message === 'string' && message.trim() ? message.trim().slice(0, 180) : undefined
    });
    await order.save();
    res.json({ orderCode: order.orderCode, status: order.status, updatedAt: order.updatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
