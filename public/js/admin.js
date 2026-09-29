const authPanel = document.getElementById('adminAuth');
const dashboard = document.getElementById('adminDashboard');
const ordersContainer = document.getElementById('adminOrders');
const notice = document.getElementById('adminNotice');
const productNotice = document.getElementById('productNotice');
const productsContainer = document.getElementById('adminProducts');
const productForm = document.getElementById('productForm');
const productImage = document.getElementById('productImage');
const productImagePreviews = document.getElementById('productImagePreviews');
const productImageMode = document.getElementById('productImageMode');
const productCategory = document.getElementById('productCategory');
const loginForm = document.getElementById('adminLoginForm');
const signupForm = document.getElementById('adminSignupForm');
const ORDER_STATUSES = {
  pending_payment: 'Awaiting payment',
  processing: 'Processing',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
};
const AUDIENCE_LABELS = { men: "Men's", women: "Women's", unisex: 'Unisex' };
let orders = [];
let products = [];
let productPreviewUrls = [];
let imageAIEnabled = false;
let imageSettingsPromise;
let editingProductId = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function clearProductImagePreviews() {
  productPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  productPreviewUrls = [];
  productImagePreviews.replaceChildren();
}

function updateProductImageMode() {
  const command = productCategory.value === 'jeans' ? '/lifestyle' : '/showcase';
  const submit = productForm.querySelector('button[type="submit"]');
  productImage.multiple = imageAIEnabled;
  productImage.required = !editingProductId;
  productImageMode.textContent = editingProductId
    ? 'Leave empty to keep the current photo, or choose a replacement.'
    : imageAIEnabled
      ? `AI editing is on: ${command} will process up to 5 reference photos.`
      : 'AI editing is bypassed. The uploaded photo publishes directly.';
  submit.textContent = editingProductId
    ? 'Save product changes'
    : imageAIEnabled ? 'AI edit & add product' : 'Upload & add product';
  document.getElementById('cancelProductEdit').hidden = !editingProductId;
}

function loadImageSettings() {
  if (!imageSettingsPromise) {
    imageSettingsPromise = api('/api/products/image-settings')
      .then(settings => { imageAIEnabled = settings.aiEnabled === true; })
      .catch(() => { imageAIEnabled = false; })
      .finally(updateProductImageMode);
  }
  return imageSettingsPromise;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function showAuthError(form, message) {
  const element = form.querySelector('[data-auth-error]');
  element.textContent = message;
  element.hidden = false;
}

function showDashboard(admin) {
  authPanel.hidden = true;
  dashboard.hidden = false;
  document.getElementById('adminWelcome').textContent = `Signed in as ${admin.name} · ${admin.email}`;
  loadOrders();
  loadProducts();
}

async function checkSession() {
  try {
    const data = await api('/api/admin/me');
    showDashboard(data.admin);
  } catch (error) {
    authPanel.hidden = false;
    dashboard.hidden = true;
    if (error.message !== 'Admin sign-in required') {
      showAuthError(loginForm, error.message);
    }
  }
}

document.querySelectorAll('[data-auth-mode]').forEach(tab => {
  tab.addEventListener('click', () => {
    const signup = tab.dataset.authMode === 'signup';
    document.querySelectorAll('[data-auth-mode]').forEach(item => {
      const selected = item === tab;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    loginForm.hidden = signup;
    signupForm.hidden = !signup;
    loginForm.querySelector('[data-auth-error]').hidden = true;
    signupForm.querySelector('[data-auth-error]').hidden = true;
  });
});

document.querySelectorAll('[data-dashboard-view]').forEach(tab => {
  tab.addEventListener('click', () => {
    const productsSelected = tab.dataset.dashboardView === 'products';
    document.querySelectorAll('[data-dashboard-view]').forEach(item => {
      const selected = item === tab;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    document.getElementById('ordersView').hidden = productsSelected;
    document.getElementById('productsView').hidden = !productsSelected;
    if (productsSelected) loadProducts();
  });
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
      })
    });
    loginForm.reset();
    showDashboard(data.admin);
  } catch (error) {
    showAuthError(loginForm, error.message);
  } finally {
    submit.disabled = false;
  }
});

signupForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = signupForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const data = await api('/api/admin/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('signupName').value,
        email: document.getElementById('signupEmail').value,
        password: document.getElementById('signupPassword').value,
        inviteCode: document.getElementById('inviteCode').value
      })
    });
    signupForm.reset();
    showDashboard(data.admin);
  } catch (error) {
    showAuthError(signupForm, error.message);
  } finally {
    submit.disabled = false;
  }
});

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat('en-ZM', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lusaka'
  }).format(date);
}

function nextStatuses(order) {
  if (order.status === 'pending_payment') {
    return order.payment?.status === 'paid' ? ['processing'] : ['cancelled'];
  }
  if (order.status === 'processing') return ['shipped'];
  if (order.status === 'shipped') return ['out_for_delivery'];
  if (order.status === 'out_for_delivery') return ['delivered'];
  return [];
}

function renderOrders() {
  const query = document.getElementById('orderSearch').value.trim().toLowerCase();
  const status = document.getElementById('statusFilter').value;
  const filtered = orders.filter(order => {
    const searchable = [order.orderCode, order.customer?.name, order.customer?.phone, order.customer?.town]
      .filter(Boolean).join(' ').toLowerCase();
    return (status === 'all' || order.status === status) && (!query || searchable.includes(query));
  });

  if (!filtered.length) {
    ordersContainer.innerHTML = '<p class="admin-empty">No orders match this view.</p>';
    return;
  }

  ordersContainer.innerHTML = filtered.map(order => {
    const next = nextStatuses(order);
    const history = (order.statusHistory || []).slice().reverse().map(event => `
      <li><strong>${escapeHtml(ORDER_STATUSES[event.status] || event.status)}</strong><span>${escapeHtml(event.message || 'Status updated')}</span><time>${escapeHtml(formatDate(event.createdAt))}</time></li>
    `).join('');
    const items = (order.items || []).map(item => `${escapeHtml(item.name)} × ${escapeHtml(item.qty)}${item.size ? ` · ${escapeHtml(item.size)}` : ''}${item.color ? ` · ${escapeHtml(item.color)}` : ''}`).join('<br>');
    const shipment = order.shipment || {};

    return `<article class="admin-order">
      <div class="admin-order-heading">
        <div><div class="order-code">${escapeHtml(order.orderCode)}</div><div class="admin-order-date">Placed ${escapeHtml(formatDate(order.createdAt))}</div></div>
        <span class="admin-status">${escapeHtml(ORDER_STATUSES[order.status] || order.status)}</span>
      </div>
      <div class="admin-order-details">
        <div><h2>Customer</h2><p><strong>${escapeHtml(order.customer?.name)}</strong><br>${escapeHtml(order.customer?.phone)}<br>${escapeHtml(order.customer?.town)}, ${escapeHtml(order.customer?.province)}<br>${escapeHtml(order.customer?.address)}</p></div>
        <div><h2>Items · K${Number(order.total || 0).toLocaleString('en-ZM')}</h2><p>${items}</p><p class="admin-payment">Payment: ${escapeHtml(order.payment?.status || 'pending')}</p></div>
      </div>
      ${shipment.trackingNumber ? `<div class="admin-shipment">Courier: ${escapeHtml(shipment.carrier)} · Tracking: ${escapeHtml(shipment.trackingNumber)}</div>` : ''}
      <details class="admin-history"><summary>Order history (${(order.statusHistory || []).length})</summary><ol>${history || '<li>No updates recorded.</li>'}</ol></details>
      ${next.length ? `<form class="admin-update-form" data-order-code="${escapeHtml(order.orderCode)}">
        <div class="admin-update-fields"><div class="field"><label>Next status</label><select name="status">${next.map(value => `<option value="${value}">${escapeHtml(ORDER_STATUSES[value])}</option>`).join('')}</select></div>
        <div class="field admin-shipping-field" ${next[0] === 'shipped' ? '' : 'hidden'}><label>Courier</label><input name="carrier" maxlength="80" value="${escapeHtml(shipment.carrier)}" placeholder="Courier name"></div>
        <div class="field admin-shipping-field" ${next[0] === 'shipped' ? '' : 'hidden'}><label>Tracking number</label><input name="trackingNumber" maxlength="100" value="${escapeHtml(shipment.trackingNumber)}" placeholder="Shipment reference"></div>
        <div class="field admin-shipping-field" ${next[0] === 'shipped' ? '' : 'hidden'}><label>Tracking link (optional)</label><input name="trackingUrl" type="url" maxlength="500" value="${escapeHtml(shipment.trackingUrl)}" placeholder="https://"></div>
        <div class="field"><label>Customer update (optional)</label><input name="message" maxlength="180" placeholder="Short status update"></div>
        </div><button class="btn-primary" type="submit">Save status update</button>
      </form>` : '<p class="admin-terminal">This order is complete.</p>'}
    </article>`;
  }).join('');
}

async function loadOrders() {
  const refreshButton = document.getElementById('refreshOrders');
  refreshButton.disabled = true;
  try {
    orders = await api('/api/admin/orders');
    renderOrders();
    notice.hidden = true;
  } catch (error) {
    notice.textContent = error.message;
    notice.hidden = false;
  } finally {
    refreshButton.disabled = false;
  }
}

function renderProducts() {
  const query = document.getElementById('productSearch').value.trim().toLowerCase();
  const filtered = products.filter(product => [product.name, product.category, product.description]
    .filter(Boolean).join(' ').toLowerCase().includes(query));
  if (!filtered.length) {
    productsContainer.innerHTML = `<p class="admin-empty">${products.length ? 'No products match your search.' : 'No products in the catalog yet.'}</p>`;
    return;
  }
  productsContainer.innerHTML = filtered.map(product => `
    <article class="admin-product">
      <div class="admin-product-image"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy"></div>
      <div class="admin-product-info">
        <div class="admin-product-topline"><span class="admin-product-category">${escapeHtml(product.category)}</span><span class="admin-product-stock ${product.inStock ? 'is-available' : 'is-unavailable'}">${product.inStock ? 'Available' : 'Out of stock'}</span></div>
        <h4>${escapeHtml(product.name)}</h4>
        <p class="admin-product-variants">${escapeHtml(AUDIENCE_LABELS[product.audience] || 'Unisex')}</p>
        <p class="admin-product-price">K${Number(product.price).toLocaleString('en-ZM')}</p>
        ${product.imageStyle ? `<p class="admin-product-variants">AI style: /${escapeHtml(product.imageStyle)}</p>` : ''}
        <p class="admin-product-variants">${escapeHtml([product.sizes?.length ? `Sizes: ${product.sizes.join(', ')}` : '', product.colors?.length ? `Colours: ${product.colors.join(', ')}` : ''].filter(Boolean).join(' · ') || 'No size or colour options')}</p>
        ${product.description ? `<p class="admin-product-description">${escapeHtml(product.description)}</p>` : ''}
        <div class="admin-product-actions">
          <button class="admin-product-action" type="button" data-edit-product="${escapeHtml(product._id)}">Edit</button>
          <button class="admin-product-action is-danger" type="button" data-delete-product="${escapeHtml(product._id)}">Delete</button>
        </div>
      </div>
    </article>
  `).join('');
}

async function loadProducts() {
  try {
    products = await api('/api/products');
    renderProducts();
    productNotice.hidden = true;
  } catch (error) {
    productNotice.textContent = error.message;
    productNotice.hidden = false;
  }
}

function resetProductForm() {
  productForm.reset();
  editingProductId = null;
  clearProductImagePreviews();
  productImage.setCustomValidity('');
  productImage.required = true;
  productForm.querySelector('h3').textContent = 'Add a product';
  updateProductImageMode();
}

function editProduct(productId) {
  const product = products.find(item => item._id === productId);
  if (!product) return;

  editingProductId = productId;
  productForm.elements.name.value = product.name;
  productForm.elements.category.value = product.category;
  productForm.elements.audience.value = product.audience || 'unisex';
  productForm.elements.price.value = product.price;
  productForm.elements.description.value = product.description || '';
  productForm.elements.sizes.value = (product.sizes || []).join(', ');
  productForm.elements.colors.value = (product.colors || []).join(', ');
  productForm.elements.featured.checked = Boolean(product.featured);
  productForm.elements.inStock.checked = product.inStock !== false;
  productImage.value = '';
  clearProductImagePreviews();
  if (product.image) {
    const image = document.createElement('img');
    image.className = 'product-image-preview';
    image.src = product.image;
    image.alt = `Current photo for ${product.name}`;
    productImagePreviews.append(image);
  }
  productForm.querySelector('h3').textContent = `Edit ${product.name}`;
  updateProductImageMode();
  productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

productsContainer.addEventListener('click', async event => {
  const editButton = event.target.closest('[data-edit-product]');
  if (editButton) {
    editProduct(editButton.dataset.editProduct);
    return;
  }

  const deleteButton = event.target.closest('[data-delete-product]');
  if (!deleteButton) return;
  const product = products.find(item => item._id === deleteButton.dataset.deleteProduct);
  if (!product || !window.confirm(`Delete ${product.name}? This cannot be undone.`)) return;

  deleteButton.disabled = true;
  try {
    const result = await api(`/api/products/${encodeURIComponent(product._id)}`, { method: 'DELETE' });
    if (editingProductId === product._id) resetProductForm();
    await loadProducts();
    productNotice.textContent = result.imageCleanupPending
      ? `${product.name} was deleted, but its stored image could not be removed.`
      : `${product.name} was deleted.`;
    productNotice.hidden = false;
  } catch (error) {
    productNotice.textContent = error.message;
    productNotice.hidden = false;
    deleteButton.disabled = false;
  }
});

productImage.addEventListener('change', () => {
  const files = Array.from(productImage.files);
  clearProductImagePreviews();
  const maxFiles = imageAIEnabled ? 5 : 1;
  if (files.length > maxFiles) {
    productImage.setCustomValidity(`Choose no more than ${maxFiles} ${maxFiles === 1 ? 'photo' : 'photos'}.`);
    productImage.value = '';
    productNotice.textContent = `Choose ${maxFiles === 1 ? 'one product photo' : 'between one and five reference photos'}.`;
    productNotice.hidden = false;
    return;
  }
  const invalidFile = files.find(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024);
  if (invalidFile) {
    productImage.setCustomValidity('Use JPG, PNG, or WEBP photos up to 5 MB each.');
    productImage.value = '';
    productNotice.textContent = 'Use JPG, PNG, or WEBP photos up to 5 MB each.';
    productNotice.hidden = false;
    return;
  }
  productImage.setCustomValidity('');
  files.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    productPreviewUrls.push(url);
    const image = document.createElement('img');
    image.className = 'product-image-preview';
    image.src = url;
    image.alt = `Reference photo ${index + 1}: ${file.name}`;
    productImagePreviews.append(image);
  });
  productNotice.hidden = true;
});

productCategory.addEventListener('change', updateProductImageMode);

productForm.addEventListener('submit', async event => {
  event.preventDefault();
  await loadImageSettings();
  const maxFiles = imageAIEnabled ? 5 : 1;
  if ((!editingProductId && productImage.files.length < 1) || productImage.files.length > maxFiles) {
    productNotice.textContent = imageAIEnabled
      ? 'Choose between one and five reference photos.'
      : 'Choose one product photo.';
    productNotice.hidden = false;
    return;
  }
  const submit = productForm.querySelector('button[type="submit"]');
  const formData = new FormData(productForm);
  formData.set('featured', String(productForm.elements.featured.checked));
  formData.set('inStock', String(productForm.elements.inStock.checked));
  submit.disabled = true;
  const wasEditing = Boolean(editingProductId);
  const productId = editingProductId;
  const command = productCategory.value === 'jeans' ? '/lifestyle' : '/showcase';
  submit.textContent = wasEditing
    ? 'Saving changes...'
    : imageAIEnabled ? 'Creating edited image...' : 'Uploading photo...';
  productNotice.textContent = wasEditing
    ? 'Saving product details...'
    : imageAIEnabled
      ? `Running ${command} image edit and publishing one final photo...`
      : 'Uploading the selected photo directly to the product catalog...';
  productNotice.hidden = false;
  try {
    const result = await api(wasEditing ? `/api/products/${encodeURIComponent(productId)}` : '/api/products', {
      method: wasEditing ? 'PUT' : 'POST',
      body: formData
    });
    const product = result.product;
    resetProductForm();
    const successMessage = wasEditing
      ? `${product.name} was updated${result.imageCleanupPending ? '; the old image could not be removed' : ''}.`
      : result.imageMode === 'ai'
        ? `${product.name} was added using ${result.imageCommand}.`
        : `${product.name} was added with the uploaded photo.`;
    productNotice.textContent = successMessage;
    productNotice.hidden = false;
    await loadProducts();
    productNotice.textContent = successMessage;
    productNotice.hidden = false;
  } catch (error) {
    productNotice.textContent = error.message;
    productNotice.hidden = false;
  } finally {
    submit.disabled = false;
    updateProductImageMode();
  }
});

ordersContainer.addEventListener('change', event => {
  if (event.target.name === 'status') {
    const form = event.target.closest('.admin-update-form');
    form.querySelectorAll('.admin-shipping-field').forEach(field => {
      field.hidden = event.target.value !== 'shipped';
    });
  }
});

ordersContainer.addEventListener('submit', async event => {
  const form = event.target.closest('.admin-update-form');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form));
  button.disabled = true;
  try {
    await api(`/api/orders/${encodeURIComponent(form.dataset.orderCode)}/status`, {
      method: 'POST',
      body: JSON.stringify(values)
    });
    await loadOrders();
    notice.textContent = `Order ${form.dataset.orderCode} updated.`;
    notice.hidden = false;
  } catch (error) {
    notice.textContent = error.message;
    notice.hidden = false;
    button.disabled = false;
  }
});

document.getElementById('orderSearch').addEventListener('input', renderOrders);
document.getElementById('statusFilter').addEventListener('change', renderOrders);
document.getElementById('refreshOrders').addEventListener('click', loadOrders);
document.getElementById('productSearch').addEventListener('input', renderProducts);
document.getElementById('refreshProducts').addEventListener('click', loadProducts);
document.getElementById('cancelProductEdit').addEventListener('click', resetProductForm);
window.addEventListener('pagehide', clearProductImagePreviews);
document.getElementById('adminLogout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  dashboard.hidden = true;
  authPanel.hidden = false;
});

checkSession();
loadImageSettings();
updateProductImageMode();