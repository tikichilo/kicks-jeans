const { test } = require('node:test');
const assert = require('node:assert/strict');
const Product = require('../models/Product');

test('legacy products default to unisex when loaded without an audience', () => {
  const product = Product.hydrate({
    name: 'Legacy product',
    category: 'jeans',
    price: 100,
    image: 'https://example.com/product.jpg'
  });

  assert.equal(product.audience, 'unisex');
});

test('products accept only men, women, or unisex audiences', () => {
  const audiencePath = Product.schema.path('audience');
  assert.deepEqual(audiencePath.enumValues, ['men', 'women', 'unisex']);
});