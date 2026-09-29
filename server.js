require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const mongoose = require('mongoose');

require('./utils/cloudinaryUpload'); // fail-fast Cloudinary env check + config

const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payment');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.TRUST_PROXY_HOPS !== undefined) {
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(proxyHops) || proxyHops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.');
  }
  app.set('trust proxy', proxyHops);
}

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https:', 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'https:', 'data:', 'blob:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);

// Page routes (3 pages: store/index, checkout, track)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(__dirname, 'public', 'checkout.html')));
app.get('/track', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/ready', (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({
    ok: databaseReady,
    database: databaseReady ? 'connected' : 'disconnected'
  });
});

// Multer/Cloudinary upload errors (from routes/products.js) land here
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    const messages = {
      LIMIT_FILE_SIZE: 'Image is too large — max 5MB per file.',
      LIMIT_FILE_COUNT: 'Too many photos — upload between 1 and 5 per product.',
      LIMIT_UNEXPECTED_FILE: 'Too many photos — upload no more than 5 per product.',
    };
    return res.status(400).json({ error: messages[err.code] || err.message });
  }
  if (err && err.message && /JPG, PNG, or WEBP/i.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error' });
});

async function start() {
  try {
    if (process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('MongoDB connected');
    } else {
      console.warn('MONGODB_URI not set — running without a database. Set it in .env before going live.');
    }
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
  }
  app.listen(PORT, () => console.log(`Kicks & Jeans running on port ${PORT}`));
}

start();
