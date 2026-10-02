const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  safeJsonForHtml,
  renderProductCard,
  productStructuredData,
  renderSitemap
} = require('../utils/seo');

test('product cards escape catalog text and include responsive image hints', () => {
  const card = renderProductCard({
    _id: 'product-1',
    name: 'Denim "Blue" & Co.',
    image: 'https://example.com/jeans.jpg?size=600&crop=square',
    description: 'A <strong>classic</strong>',
    price: 800,
    inStock: true
  });

  assert.match(card, /Denim &quot;Blue&quot; &amp; Co\./);
  assert.match(card, /A &lt;strong&gt;classic&lt;\/strong&gt;/);
  assert.match(card, /width="600" height="600" loading="lazy" decoding="async"/);
  assert.doesNotMatch(card, /<strong>/);
});

test('JSON-LD safely encodes script-closing content and product offer details', () => {
  const products = productStructuredData([{
    _id: 'sku-1',
    name: 'Denim </script><script>alert(1)</script> & Co.',
    image: 'https://example.com/item.jpg',
    price: 800,
    inStock: false
  }], 'https://kicksandjeans.co.zm');
  const encoded = safeJsonForHtml(products);

  assert.doesNotMatch(encoded, /</);
  assert.equal(JSON.parse(encoded)[0].name, 'Denim </script><script>alert(1)</script> & Co.');
  assert.equal(JSON.parse(encoded)[0].sku, 'sku-1');
  assert.equal(JSON.parse(encoded)[0].offers.priceCurrency, 'ZMW');
  assert.equal(JSON.parse(encoded)[0].offers.availability, 'https://schema.org/OutOfStock');
});

test('sitemap escapes values and emits last-modified dates', () => {
  const sitemap = renderSitemap([{
    url: 'https://example.com/?a=1&b=2',
    lastmod: '2026-10-02'
  }]);

  assert.match(sitemap, /https:\/\/example\.com\/\?a=1&amp;b=2/);
  assert.match(sitemap, /<lastmod>2026-10-02<\/lastmod>/);
});
