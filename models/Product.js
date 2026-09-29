const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, enum: ['shoes', 'jeans'], required: true },
  audience: { type: String, enum: ['men', 'women', 'unisex'], default: 'unisex' },
  price: { type: Number, required: true }, // ZMW
  sizes: [{ type: String }],
  colors: [{ type: String }],
  image: { type: String, required: true },
  imagePublicId: { type: String },
  imageStyle: { type: String, enum: ['showcase', 'lifestyle'] },
  description: { type: String, default: '' },
  inStock: { type: Boolean, default: true },
  featured: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', productSchema);
