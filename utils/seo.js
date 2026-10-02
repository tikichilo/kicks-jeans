function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function safeJsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function renderProductCard(product) {
  const id = escapeHtml(product._id);
  const name = escapeHtml(product.name);
  const image = escapeHtml(product.image);
  const description = escapeHtml(product.description);

  return `<article class="card" id="product-${id}">
    <div class="card-img-wrap">
      ${product.featured ? '<span class="card-badge">New</span>' : ''}
      <img src="${image}" alt="${name}" width="600" height="600" loading="lazy" decoding="async">
    </div>
    <div class="card-body">
      <div class="card-name">${name}</div>
      <div class="card-desc">${description}</div>
      <div class="card-footer">
        <span class="price-tag">${escapeHtml(product.price)}</span>
        <button class="add-btn" data-id="${id}" aria-label="Add ${name} to cart" ${product.inStock ? '' : 'disabled'}>${product.inStock ? '+' : '×'}</button>
      </div>
    </div>
  </article>`;
}

function productStructuredData(products, siteUrl) {
  return products.map(product => ({
    '@type': 'Product',
    name: product.name,
    image: product.image,
    description: product.description || '',
    sku: String(product.sku || product._id),
    brand: { '@type': 'Brand', name: 'Kicks & Jeans' },
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'ZMW',
      availability: product.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url: `${siteUrl}/#product-${product._id}`
    }
  }));
}

function renderSitemap(urls) {
  const entries = urls.map(({ url, lastmod }) =>
    `<url><loc>${escapeHtml(url)}</loc><lastmod>${escapeHtml(lastmod)}</lastmod></url>`
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
}

module.exports = { escapeHtml, safeJsonForHtml, renderProductCard, productStructuredData, renderSitemap };
