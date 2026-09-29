const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: String,
  price: Number,
  size: String,
  color: String,
  qty: Number
}, { _id: false });

const statusEventSchema = new mongoose.Schema({
  status: { type: String, required: true },
  message: { type: String, trim: true, maxlength: 180 },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderCode: { type: String, required: true, unique: true }, // e.g. KJ-7X2P9
  items: [orderItemSchema],
  subtotal: { type: Number, required: true },
  deliveryFee: { type: Number, required: true },
  total: { type: Number, required: true },

  customer: {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String },
    province: { type: String, required: true },
    town: { type: String, required: true },
    address: { type: String, required: true }
  },

  payment: {
    method: { type: String, default: 'momo' },
    provider: { type: String, enum: ['mtn', 'airtel'], required: true },
    phone: { type: String, required: true },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    providerRef: { type: String }
  },

  status: {
    type: String,
    enum: ['pending_payment', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'],
    default: 'pending_payment'
  },

  statusHistory: { type: [statusEventSchema], default: [] },
  shipment: {
    carrier: { type: String, trim: true },
    trackingNumber: { type: String, trim: true },
    trackingUrl: { type: String, trim: true }
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

orderSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Order', orderSchema);
