const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Product = require('../models/Product');
const { requireAdmin } = require('../middleware/adminAuth');
const { cloudinary, uploadProductSources } = require('../utils/cloudinaryUpload');
const { createProductImage } = require('../services/productImageAI');
const { publishProductImage } = require('../services/productImagePublisher');

const IMAGE_AI_ENABLED = process.env.PRODUCT_IMAGE_AI_ENABLED === 'true';

function parseList(value, fieldName) {
  if (!value) return [];
  const values = String(value).split(',').map(item => item.trim()).filter(Boolean);
  if (values.length > 20 || values.some(item => item.length > 40)) {
    const error = new Error(`${fieldName} must contain no more than 20 values, each 40 characters or fewer`);
    error.status = 400;
    throw error;
  }
  return [...new Set(values)];
}

function parseProductFields(body) {
  const { name, category, price, description = '', sizes, colors, featured, inStock } = body;
  const audience = body.audience === undefined ? 'unisex' : body.audience;
  const numericPrice = Number(price);
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
    const error = new Error('Product name is required and must be 120 characters or fewer');
    error.status = 400;
    throw error;
  }
  if (!['shoes', 'jeans'].includes(category)) {
    const error = new Error('Category must be shoes or jeans');
    error.status = 400;
    throw error;
  }
  if (!['men', 'women', 'unisex'].includes(audience)) {
    const error = new Error('Audience must be men, women, or unisex');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    const error = new Error('Price must be a positive number');
    error.status = 400;
    throw error;
  }
  if (typeof description !== 'string' || description.length > 500) {
    const error = new Error('Description must be 500 characters or fewer');
    error.status = 400;
    throw error;
  }

  return {
    name: name.trim(),
    category,
    audience,
    price: numericPrice,
    description: description.trim(),
    sizes: parseList(sizes, 'Sizes'),
    colors: parseList(colors, 'Colours'),
    featured: featured === 'true',
    inStock: inStock !== 'false'
  };
}

// POST /api/products — publish a product photo, optionally AI-edited (admin only)
router.post('/', requireAdmin, uploadProductSources.array('images', 5), async (req, res) => {
  let uploadedPublicId;
  try {
    const fields = parseProductFields(req.body);
    if (!req.files?.length) return res.status(400).json({ error: 'Upload a product photo' });

    const { cloudinaryImage, generated } = await publishProductImage({
      category: fields.category,
      images: req.files,
      aiEnabled: IMAGE_AI_ENABLED,
      cloudinary,
      createProductImage
    });
    uploadedPublicId = cloudinaryImage.public_id;

    const product = await Product.create({
      ...fields,
      image: cloudinaryImage.secure_url,
      imagePublicId: cloudinaryImage.public_id,
      imageStyle: generated ? (fields.category === 'shoes' ? 'showcase' : 'lifestyle') : undefined
    });
    res.status(201).json({
      product,
      imageMode: generated ? 'ai' : 'direct',
      imageCommand: generated?.command || null,
      imageModel: generated?.model || null
    });
  } catch (err) {
    if (uploadedPublicId) {
      await cloudinary.uploader.destroy(uploadedPublicId).catch(() => {});
    }
    if (err.retryAfter) res.set('Retry-After', err.retryAfter);
    const status = err.status || (err.name === 'ValidationError' ? 400 : 500);
    res.status(status).json({ error: err.message || 'Could not create product' });
  }
});

router.put('/:id', requireAdmin, uploadProductSources.array('images', 5), async (req, res) => {
  let uploadedPublicId;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product ID' });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const fields = parseProductFields(req.body);
    let generated = null;
    const previousPublicId = product.imagePublicId;
    if (req.files?.length) {
      const uploaded = await publishProductImage({
        category: fields.category,
        images: req.files,
        aiEnabled: IMAGE_AI_ENABLED,
        cloudinary,
        createProductImage
      });
      generated = uploaded.generated;
      uploadedPublicId = uploaded.cloudinaryImage.public_id;
      product.image = uploaded.cloudinaryImage.secure_url;
      product.imagePublicId = uploadedPublicId;
      product.imageStyle = generated
        ? (fields.category === 'shoes' ? 'showcase' : 'lifestyle')
        : undefined;
    }

    Object.assign(product, fields);
    await product.save();

    let imageCleanupPending = false;
    if (uploadedPublicId && previousPublicId && previousPublicId !== uploadedPublicId) {
      try {
        await cloudinary.uploader.destroy(previousPublicId);
      } catch (error) {
        imageCleanupPending = true;
        console.error('Could not remove replaced product image:', error.message);
      }
    }

    res.json({ product, imageCleanupPending });
  } catch (err) {
    if (uploadedPublicId) await cloudinary.uploader.destroy(uploadedPublicId).catch(() => {});
    if (err.retryAfter) res.set('Retry-After', err.retryAfter);
    const status = err.status || (err.name === 'ValidationError' ? 400 : 500);
    res.status(status).json({ error: err.message || 'Could not update product' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product ID' });
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    let imageCleanupPending = false;
    if (product.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(product.imagePublicId);
      } catch (error) {
        imageCleanupPending = true;
        console.error('Could not remove deleted product image:', error.message);
      }
    }

    res.json({ deleted: true, imageCleanupPending });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete product' });
  }
});

router.get('/image-settings', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ aiEnabled: IMAGE_AI_ENABLED });
});

// GET /api/products?category=shoes
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.audience) {
      if (!['men', 'women', 'unisex'].includes(req.query.audience)) {
        return res.status(400).json({ error: 'Audience must be men, women, or unisex' });
      }
      if (req.query.audience === 'unisex') {
        filter.$or = [{ audience: 'unisex' }, { audience: { $exists: false } }];
      } else {
        filter.audience = req.query.audience;
      }
    }
    const products = await Product.find(filter).sort({ featured: -1, createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid product ID' });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
