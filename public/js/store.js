let allProducts = [];
let activeFilter = ['shoes', 'jeans'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'all';
let activeAudience = 'all';
let sheetProduct = null;
let sheetSelection = { size: null, color: null };

const grid = document.getElementById('productGrid');
const sheetBackdrop = document.getElementById('sheetBackdrop');
const sheet = document.getElementById('quickAddSheet');
const sheetContent = document.getElementById('sheetContent');
const drawer = document.getElementById('cartDrawer');
const drawerItems = document.getElementById('drawerItems');
const drawerFooter = document.getElementById('drawerFooter');
const welcomeOverlay = document.getElementById('welcomeOverlay');
const welcomePanel = welcomeOverlay.querySelector('.welcome-panel');
const WELCOME_SEEN_KEY = 'kj_welcome_seen_v1';

function closeWelcome() {
  if (welcomeOverlay.hidden) return;
  welcomeOverlay.hidden = true;
  document.body.classList.remove('welcome-open');
}

function showWelcomeOnce() {
  try {
    if (localStorage.getItem(WELCOME_SEEN_KEY) === 'seen') return;
    localStorage.setItem(WELCOME_SEEN_KEY, 'seen');
  } catch {
    // Still show the welcome if browser storage is unavailable.
  }

  welcomeOverlay.hidden = false;
  document.body.classList.add('welcome-open');
  document.getElementById('welcomeClose').focus();
}

document.getElementById('welcomeClose').addEventListener('click', closeWelcome);
document.getElementById('welcomeDismiss').addEventListener('click', closeWelcome);
welcomeOverlay.addEventListener('click', event => {
  if (event.target === welcomeOverlay) closeWelcome();
});
document.getElementById('welcomeShop').addEventListener('click', () => {
  closeWelcome();
  document.getElementById('chipRow').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
welcomeOverlay.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeWelcome();
    return;
  }
  if (event.key !== 'Tab') return;

  const controls = welcomePanel.querySelectorAll('button:not([disabled])');
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

setTimeout(showWelcomeOnce, 350);

async function loadProducts() {
  try {
    const initialProducts = JSON.parse(document.getElementById('initialProducts').textContent);
    if (Array.isArray(initialProducts)) {
      allProducts = initialProducts;
      renderGrid();
      return;
    }
  } catch {
    // Fall back to the products API if server-rendered product data is unavailable.
  }

  try {
    const res = await fetch('/api/products');
    const products = await res.json();
    if (!res.ok || !Array.isArray(products)) throw new Error('Products are temporarily unavailable.');
    allProducts = products;
    renderGrid();
  } catch {
    grid.innerHTML = '<div class="store-error" role="status"><p>Products could not load right now.</p><button class="chip" id="retryProducts">Try again</button></div>';
    document.getElementById('retryProducts').addEventListener('click', loadProducts);
  }
}

function renderGrid() {
  const items = allProducts.filter(product =>
    (activeFilter === 'all' || product.category === activeFilter) &&
    (activeAudience === 'all' || (product.audience || 'unisex') === activeAudience)
  );
  if (!items.length) {
    grid.innerHTML = '<p style="grid-column:1/-1;padding:20px;">Nothing here yet.</p>';
    return;
  }
  grid.innerHTML = items.map(p => `
    <article class="card" id="product-${escapeHtml(p._id)}">
      <div class="card-img-wrap">
        ${p.featured ? '<span class="card-badge">New</span>' : ''}
        <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" width="600" height="600" loading="lazy" decoding="async">
      </div>
      <div class="card-body">
        <div class="card-name">${escapeHtml(p.name)}</div>
        <div class="card-desc">${escapeHtml(p.description || '')}</div>
        <div class="card-footer">
          <span class="price-tag">${p.price}</span>
          <button class="add-btn" data-id="${escapeHtml(p._id)}" aria-label="Add ${escapeHtml(p.name)} to cart" ${p.inStock ? '' : 'disabled'}>${p.inStock ? '+' : '×'}</button>
        </div>
      </div>
    </article>
  `).join('');

  grid.querySelectorAll('.card-img-wrap img').forEach(image => {
    image.addEventListener('error', () => { image.style.opacity = '0'; });
  });
  grid.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', () => openSheet(btn.dataset.id));
  });
}

function setActiveFilter(filter) {
  const selectedChip = document.querySelector(`#chipRow [data-filter="${filter}"]`);
  if (!selectedChip) return;
  activeFilter = filter;
  document.querySelectorAll('#chipRow .chip').forEach(chip => {
    const selected = chip === selectedChip;
    chip.classList.toggle('active', selected);
    chip.setAttribute('aria-pressed', String(selected));
  });
  renderGrid();
}

document.getElementById('chipRow').addEventListener('click', event => {
  const chip = event.target.closest('.chip');
  if (chip) setActiveFilter(chip.dataset.filter);
});

document.getElementById('audienceRow').addEventListener('click', event => {
  const chip = event.target.closest('[data-audience-filter]');
  if (!chip) return;
  activeAudience = chip.dataset.audienceFilter;
  document.querySelectorAll('#audienceRow [data-audience-filter]').forEach(option => {
    const selected = option === chip;
    option.classList.toggle('active', selected);
    option.setAttribute('aria-pressed', String(selected));
  });
  renderGrid();
});

document.querySelectorAll('.nav-links a[href="/#shoes"], .nav-links a[href="/#jeans"]').forEach(link => {
  link.addEventListener('click', event => {
    if (location.pathname !== '/') return;
    event.preventDefault();
    const filter = link.hash.slice(1);
    history.replaceState(null, '', `/#${filter}`);
    setActiveFilter(filter);
    document.getElementById('chipRow').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

if (activeFilter !== 'all') {
  document.querySelectorAll('#chipRow .chip').forEach(chip => {
    const selected = chip.dataset.filter === activeFilter;
    chip.classList.toggle('active', selected);
    chip.setAttribute('aria-pressed', String(selected));
  });
}

// ---------- Quick-add sheet ----------
function openSheet(productId) {
  sheetProduct = allProducts.find(p => p._id === productId);
  if (!sheetProduct) return;
  sheetSelection = { size: sheetProduct.sizes?.[0] || null, color: sheetProduct.colors?.[0] || null };
  renderSheet();
  sheetBackdrop.classList.add('open');
  sheet.classList.add('open');
}

function closeSheet() {
  sheetBackdrop.classList.remove('open');
  sheet.classList.remove('open');
}

function renderSheet() {
  const p = sheetProduct;
  sheetContent.innerHTML = `
    <div style="display:flex;gap:14px;margin-top:4px;">
      <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" width="88" height="88" loading="lazy" decoding="async" style="object-fit:cover;border:2px solid var(--ink);">
      <div>
        <div style="font-weight:700;font-size:16px;">${escapeHtml(p.name)}</div>
        <div class="price-tag" style="margin-top:4px;">${p.price}</div>
      </div>
    </div>
    ${p.sizes?.length ? `
      <div class="option-row">
        <div class="option-label">Size</div>
        <div class="option-pills" id="sizePills">
          ${p.sizes.map(s => `<button class="pill ${s === sheetSelection.size ? 'selected' : ''}" data-size="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
        </div>
      </div>` : ''}
    ${p.colors?.length ? `
      <div class="option-row">
        <div class="option-label">Colour</div>
        <div class="option-pills" id="colorPills">
          ${p.colors.map(c => `<button class="pill ${c === sheetSelection.color ? 'selected' : ''}" data-color="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
        </div>
      </div>` : ''}
    <button class="btn-primary" id="confirmAddBtn">Add to Cart — K${p.price}</button>
  `;

  sheetContent.querySelectorAll('[data-size]').forEach(btn => {
    btn.addEventListener('click', () => {
      sheetSelection.size = btn.dataset.size;
      renderSheet();
    });
  });
  sheetContent.querySelectorAll('[data-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      sheetSelection.color = btn.dataset.color;
      renderSheet();
    });
  });
  document.getElementById('confirmAddBtn').addEventListener('click', () => {
    const added = addToCart({
      productId: p._id,
      name: p.name,
      price: p.price,
      image: p.image,
      size: sheetSelection.size,
      color: sheetSelection.color,
      qty: 1
    });
    if (!added) {
      showToast('Maximum 20 of this option per order');
      return;
    }
    closeSheet();
    showToast(`Added ${p.name} to cart`);
    renderDrawer();
  });
}

sheetBackdrop.addEventListener('click', closeSheet);
document.getElementById('sheetClose').addEventListener('click', closeSheet);

// ---------- Cart drawer ----------
function openDrawer() {
  renderDrawer();
  drawer.classList.add('open');
  sheetBackdrop.classList.add('open');
}
function closeDrawer() {
  drawer.classList.remove('open');
  sheetBackdrop.classList.remove('open');
}

function renderDrawer() {
  const cart = getCart();
  if (!cart.length) {
    drawerItems.innerHTML = '<div class="empty-note">Your cart is empty. Go find something fresh.</div>';
    drawerFooter.innerHTML = '';
    return;
  }
  drawerItems.innerHTML = cart.map(item => `
    <div class="drawer-item">
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" width="64" height="64" loading="lazy" decoding="async">
      <div class="drawer-item-info">
        <div class="drawer-item-name">${escapeHtml(item.name)}</div>
        <div class="drawer-item-meta">${escapeHtml([item.size, item.color].filter(Boolean).join(' / ') || 'Standard')} · K${item.price}</div>
        <div class="qty-control">
          <button data-dec="${escapeHtml(cartKey(item))}" aria-label="Decrease ${escapeHtml(item.name)} quantity">-</button>
          <span aria-live="polite">${item.qty}</span>
          <button data-inc="${escapeHtml(cartKey(item))}" aria-label="Increase ${escapeHtml(item.name)} quantity" ${item.qty >= MAX_ITEM_QTY ? 'disabled' : ''}>+</button>
          <button class="cart-remove" data-remove="${escapeHtml(cartKey(item))}">Remove</button>
        </div>
      </div>
      <div class="price-tag">${(item.price * item.qty).toFixed(0)}</div>
    </div>
  `).join('');

  const subtotal = cartSubtotal(cart);
  drawerFooter.innerHTML = `
    <div class="summary-row"><span>Subtotal</span><span>K${subtotal.toFixed(0)}</span></div>
    <div class="helper-text">Delivery fee calculated at checkout based on your location.</div>
    <a class="btn-primary" href="/checkout" style="display:block;text-align:center;">Checkout</a>
  `;

  drawerItems.querySelectorAll('[data-inc]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = cart.find(i => cartKey(i) === btn.dataset.inc);
      updateQty(item, 1);
    });
  });
  drawerItems.querySelectorAll('[data-dec]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = cart.find(i => cartKey(i) === btn.dataset.dec);
      updateQty(item, -1);
    });
  });
  drawerItems.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = cart.find(i => cartKey(i) === btn.dataset.remove);
      if (item) removeFromCart(item);
    });
  });
}

document.getElementById('openCartBtn').addEventListener('click', openDrawer);
document.getElementById('cartBarBtn').addEventListener('click', openDrawer);
document.getElementById('drawerClose').addEventListener('click', closeDrawer);
sheetBackdrop.addEventListener('click', closeDrawer);

window.addEventListener('kj-cart-change', () => {
  if (drawer.classList.contains('open')) renderDrawer();
});

loadProducts();
