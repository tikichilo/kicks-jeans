// Cart state, shared across index/checkout via localStorage.
// Cart item shape: { productId, name, price, image, size, color, qty }

const CART_KEY = 'kj_cart_v1';
const MAX_ITEM_QTY = 20;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function getCart() {
  try {
    const cart = JSON.parse(localStorage.getItem(CART_KEY));
    if (!Array.isArray(cart)) return [];
    return cart.filter(item => item && typeof item.productId === 'string' &&
      Number.isInteger(item.qty) && item.qty > 0 && Number.isFinite(Number(item.price)))
      .map(item => ({ ...item, price: Number(item.price), qty: Math.min(item.qty, MAX_ITEM_QTY) }));
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadges();
  window.dispatchEvent(new Event('kj-cart-change'));
}

function cartKey(item) {
  return [item.productId, item.size, item.color].join('::');
}

function addToCart(item) {
  if (!item || !item.productId || !Number.isInteger(item.qty) || item.qty < 1) return false;
  const cart = getCart();
  const existing = cart.find(i => cartKey(i) === cartKey(item));
  if (existing) {
    if (existing.qty + item.qty > MAX_ITEM_QTY) return false;
    existing.qty += item.qty;
  } else {
    if (item.qty > MAX_ITEM_QTY) return false;
    cart.push(item);
  }
  saveCart(cart);
  return true;
}

function updateQty(item, delta) {
  const cart = getCart();
  const target = cart.find(i => cartKey(i) === cartKey(item));
  if (!target) return;
  if (delta > 0 && target.qty >= MAX_ITEM_QTY) return cart;
  target.qty += delta;
  const filtered = target.qty <= 0 ? cart.filter(i => cartKey(i) !== cartKey(item)) : cart;
  saveCart(filtered);
  return filtered;
}

function removeFromCart(item) {
  const cart = getCart().filter(i => cartKey(i) !== cartKey(item));
  saveCart(cart);
  return cart;
}

function cartCount(cart = getCart()) {
  return cart.reduce((sum, i) => sum + i.qty, 0);
}

function cartSubtotal(cart = getCart()) {
  return cart.reduce((sum, i) => sum + i.price * i.qty, 0);
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateCartBadges();
}

function updateCartBadges() {
  const count = cartCount();
  document.querySelectorAll('[data-cart-count]').forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? 'inline-flex' : 'none';
  });
  const bar = document.querySelector('.cart-bar');
  if (bar) {
    const countEl = document.getElementById('cartBarCount');
    if (countEl) countEl.textContent = count > 0 ? `${count} item${count === 1 ? '' : 's'}` : '';
    if (count > 0) {
      bar.classList.add('visible');
      const totalEl = bar.querySelector('[data-cart-bar-total]');
      if (totalEl) totalEl.textContent = `K${cartSubtotal().toFixed(0)}`;
    } else {
      bar.classList.remove('visible');
    }
  }
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

document.addEventListener('DOMContentLoaded', updateCartBadges);
window.addEventListener('storage', event => {
  if (event.key === CART_KEY) {
    updateCartBadges();
    window.dispatchEvent(new Event('kj-cart-change'));
  }
});
