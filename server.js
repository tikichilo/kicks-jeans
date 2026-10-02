require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');

require('./utils/cloudinaryUpload'); // fail-fast Cloudinary env check + config

const Product = require('./models/Product');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payment');
const adminRoutes = require('./routes/admin');
const { escapeHtml, safeJsonForHtml, renderProductCard, productStructuredData, renderSitemap } = require('./utils/seo');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = new URL(process.env.SITE_URL || 'https://kicksandjeans.co.zm').origin;
const OG_IMAGE_URL = process.env.OG_IMAGE_URL || `${SITE_URL}/og-image.svg`;
const GOOGLE_SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
} else if (process.env.TRUST_PROXY_HOPS !== undefined) {
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
app.use(compression());
app.use(express.json({ limit: '32kb' }));

if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const canonicalHost = new URL(SITE_URL).host;
    if (!req.secure || req.get('host')?.toLowerCase() !== canonicalHost.toLowerCase()) {
      return res.redirect(301, `https://${canonicalHost}${req.originalUrl}`);
    }
    next();
  });
}

async function sendPage(res, file, { title, description, canonicalPath }, replacements = {}) {
  const html = await fs.readFile(path.join(PUBLIC_DIR, file), 'utf8');
  const pageUrl = `${SITE_URL}${canonicalPath}`;
  const tokens = {
    TITLE: escapeHtml(title),
    DESCRIPTION: escapeHtml(description),
    PAGE_URL: escapeHtml(pageUrl),
    SITE_URL: escapeHtml(SITE_URL),
    OG_IMAGE_URL: escapeHtml(OG_IMAGE_URL),
    GOOGLE_SITE_VERIFICATION: escapeHtml(GOOGLE_SITE_VERIFICATION),
    ...replacements
  };
  const rendered = html.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => tokens[key] ?? match);
  res.type('html').send(rendered);
}

function pageRoute(file, metadata) {
  return (req, res, next) => sendPage(res, file, metadata).catch(next);
}

app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', async (req, res) => {
  try {
    const products = await Product.find().sort({ featured: -1, createdAt: -1 }).lean();
    const organization = {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'Kicks & Jeans',
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/logo.svg`,
      areaServed: 'Zambia'
    };
    const onlineStore = {
      '@type': 'OnlineStore',
      '@id': `${SITE_URL}/#store`,
      name: 'Kicks & Jeans',
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/logo.svg`,
      areaServed: 'Zambia',
      currenciesAccepted: 'ZMW',
      paymentAccepted: 'Mobile Money',
      parentOrganization: { '@id': organization['@id'] }
    };
    const structuredData = {
      '@context': 'https://schema.org',
      '@graph': [organization, onlineStore, ...productStructuredData(products, SITE_URL)]
    };

    await sendPage(res, 'index.html', {
      title: 'Kicks & Jeans | Buy Jeans & Shoes Online in Zambia – Nationwide Delivery',
      description: 'Shop trending jeans and sneakers online in Zambia. Pay with MTN or Airtel Money. Fast delivery to Lusaka, Kitwe, Ndola, Livingstone and nationwide.',
      canonicalPath: '/'
    }, {
      PRODUCT_CARDS: products.map(renderProductCard).join(''),
      PRODUCT_DATA: safeJsonForHtml(products),
      STRUCTURED_DATA: safeJsonForHtml(structuredData)
    });
  } catch (err) {
    console.error('Could not render store catalog:', err.message);
    res.status(503).send('The store catalog is temporarily unavailable. Please try again soon.');
  }
});
app.get('/checkout', pageRoute('checkout.html', {
  title: 'Checkout | Kicks & Jeans Zambia',
  description: 'Review your Kicks & Jeans order, choose delivery in Zambia, and pay securely with MTN or Airtel Money.',
  canonicalPath: '/checkout'
}));
app.get('/track', pageRoute('track.html', {
  title: 'Track Your Order | Kicks & Jeans Zambia',
  description: 'Check the delivery progress of your Kicks & Jeans order in Zambia.',
  canonicalPath: '/track'
}));

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /cart',
    'Disallow: /checkout',
    'Disallow: /order',
    'Disallow: /api',
    'Disallow: /admin',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    ''
  ].join('\n'));
});

app.get('/sitemap.xml', async (req, res) => {
  try {
    const latestProduct = await Product.findOne().sort({ createdAt: -1 }).select('createdAt').lean();
    const lastmod = (latestProduct?.createdAt || new Date()).toISOString().slice(0, 10);
    res.type('application/xml').send(renderSitemap([{ url: `${SITE_URL}/`, lastmod }]));
  } catch (err) {
    console.error('Could not generate sitemap:', err.message);
    res.status(503).type('text/plain').send('Sitemap is temporarily unavailable.');
  }
});

app.get('/index.html', (req, res) => res.redirect(301, '/'));
app.get('/checkout.html', (req, res) => res.redirect(301, '/checkout'));
app.get('/track.html', (req, res) => res.redirect(301, '/track'));
app.get('/admin.html', (req, res) => res.redirect(301, '/admin'));

app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (/\.(?:css|js|svg|png|jpe?g|webp|ico|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000');
    }
  }
}));

app.get('/admin', pageRoute('admin.html', {
  title: 'Admin Dashboard | Kicks & Jeans',
  description: 'Kicks & Jeans store administration.',
  canonicalPath: '/admin'
}));

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
