const checkoutItems = document.getElementById('checkoutItems');
const emptyCartNote = document.getElementById('emptyCartNote');
const provinceSelect = document.getElementById('province');
const expressField = document.getElementById('expressField');
const expressCheckbox = document.getElementById('express');
const sumSubtotal = document.getElementById('sumSubtotal');
const sumDelivery = document.getElementById('sumDelivery');
const sumTotal = document.getElementById('sumTotal');
const formError = document.getElementById('formError');
const payBtn = document.getElementById('payBtn');
const providerPick = document.getElementById('providerPick');

let selectedProvider = null;
let currentQuote = null;
let quoteVersion = 0;
let quoteController;
let quoteReady = false;
let activeOrder = null;
let paymentPollTimer;
let paymentAttempts = 0;

function updatePayButton() {
  payBtn.disabled = !getCart().length || !provinceSelect.value || !selectedProvider || !quoteReady || !!activeOrder;
}

function renderCheckoutItems() {
  const cart = getCart();
  if (!cart.length) {
    checkoutItems.style.display = 'none';
    emptyCartNote.style.display = 'block';
    updatePayButton();
    return;
  }
  checkoutItems.style.display = 'block';
  emptyCartNote.style.display = 'none';
  checkoutItems.innerHTML = cart.map(item => `
    <div class="drawer-item">
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" width="64" height="64" loading="lazy" decoding="async">
      <div class="drawer-item-info">
        <div class="drawer-item-name">${escapeHtml(item.name)}</div>
        <div class="drawer-item-meta">${escapeHtml([item.size, item.color].filter(Boolean).join(' / ') || 'Standard')} · K${item.price}</div>
        <div class="qty-control">
          <button type="button" data-checkout-dec="${cartKey(item)}" aria-label="Decrease ${escapeHtml(item.name)} quantity">-</button>
          <span aria-live="polite">${item.qty}</span>
          <button type="button" data-checkout-inc="${cartKey(item)}" aria-label="Increase ${escapeHtml(item.name)} quantity" ${item.qty >= MAX_ITEM_QTY ? 'disabled' : ''}>+</button>
          <button type="button" class="cart-remove" data-checkout-remove="${cartKey(item)}">Remove</button>
        </div>
      </div>
      <div class="price-tag">${(item.price * item.qty).toFixed(0)}</div>
    </div>
  `).join('');
  updatePayButton();
}

async function loadProvinces() {
  try {
    const res = await fetch('/api/orders/delivery-rates');
    const rates = await res.json();
    if (!res.ok) throw new Error(rates.error || 'Could not load delivery rates');
    provinceSelect.innerHTML = '<option value="">Select province</option>' +
      Object.keys(rates).map(province => `<option value="${escapeHtml(province)}">${escapeHtml(province)} — K${rates[province]}</option>`).join('');
  } catch {
    provinceSelect.innerHTML = '<option value="">Delivery rates unavailable</option>';
    formError.textContent = 'Delivery options could not be loaded. Refresh the page to try again.';
    formError.style.display = 'block';
  }
  updatePayButton();
}

async function refreshQuote() {
  formError.style.display = 'none';
  const version = ++quoteVersion;
  if (quoteController) quoteController.abort();
  quoteController = new AbortController();
  const cart = getCart();
  const province = provinceSelect.value;
  quoteReady = false;
  currentQuote = null;
  updatePayButton();
  if (!cart.length || !province) {
    sumSubtotal.textContent = `K${cartSubtotal(cart).toFixed(0)}`;
    sumDelivery.textContent = province ? 'K0' : 'Select province';
    sumTotal.textContent = `K${cartSubtotal(cart).toFixed(0)}`;
    return;
  }
  sumDelivery.textContent = 'Calculating...';
  try {
    const res = await fetch('/api/orders/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: quoteController.signal,
      body: JSON.stringify({
        items: cart.map(i => ({ productId: i.productId, qty: i.qty })),
        province,
        express: expressCheckbox.checked
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (version !== quoteVersion) return;
    currentQuote = data;
    sumSubtotal.textContent = `K${data.subtotal.toFixed(0)}`;
    sumDelivery.textContent = `K${data.deliveryFee.toFixed(0)}`;
    sumTotal.textContent = `K${data.total.toFixed(0)}`;
    quoteReady = true;
  } catch (err) {
    if (err.name !== 'AbortError' && version === quoteVersion) {
      sumDelivery.textContent = 'Unable to calculate';
      formError.textContent = err.message || 'Unable to calculate your order total.';
      formError.style.display = 'block';
    }
  } finally {
    if (version === quoteVersion) updatePayButton();
  }
}

checkoutItems.addEventListener('click', event => {
  const button = event.target.closest('[data-checkout-dec], [data-checkout-inc], [data-checkout-remove]');
  if (!button) return;
  const cart = getCart();
  const key = button.dataset.checkoutDec || button.dataset.checkoutInc || button.dataset.checkoutRemove;
  const item = cart.find(cartItem => cartKey(cartItem) === key);
  if (!item) return;
  if (button.hasAttribute('data-checkout-remove')) removeFromCart(item);
  else updateQty(item, button.hasAttribute('data-checkout-inc') ? 1 : -1);
});

window.addEventListener('kj-cart-change', () => {
  renderCheckoutItems();
  refreshQuote();
});

provinceSelect.addEventListener('change', () => {
  expressField.style.display = provinceSelect.value === 'Lusaka' ? 'block' : 'none';
  if (provinceSelect.value !== 'Lusaka') expressCheckbox.checked = false;
  refreshQuote();
});
expressCheckbox.addEventListener('change', refreshQuote);

providerPick.addEventListener('click', e => {
  const card = e.target.closest('.provider-card');
  if (!card) return;
  selectedProvider = card.dataset.provider;
  document.querySelectorAll('.provider-card').forEach(c => {
    c.classList.toggle('selected', c === card);
    c.setAttribute('aria-pressed', String(c === card));
  });
  updatePayButton();
});

// ---------- Submit ----------
document.getElementById('checkoutForm').addEventListener('submit', async e => {
  e.preventDefault();
  formError.style.display = 'none';

  const cart = getCart();
  if (!cart.length || !quoteReady || !currentQuote) {
    formError.textContent = 'Check your delivery location and wait for the order total to finish calculating.';
    formError.style.display = 'block';
    return;
  }
  if (!selectedProvider) {
    formError.textContent = 'Choose MTN or Airtel Money to continue.';
    formError.style.display = 'block';
    return;
  }

  const payload = {
    items: cart.map(i => ({ productId: i.productId, size: i.size, color: i.color, qty: i.qty })),
    express: expressCheckbox.checked,
    customer: {
      name: document.getElementById('name').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      email: document.getElementById('email').value.trim(),
      province: provinceSelect.value,
      town: document.getElementById('town').value.trim(),
      address: document.getElementById('address').value.trim()
    },
    payment: {
      provider: selectedProvider,
      phone: document.getElementById('momoPhone').value.trim()
    }
  };

  payBtn.disabled = true;
  payBtn.textContent = 'Placing order...';

  try {
    const orderRes = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const order = await orderRes.json();
    if (!orderRes.ok) throw new Error(order.error || 'Could not create order');
    activeOrder = order;
    await startPayment(order);
  } catch (err) {
    formError.textContent = err.message;
    formError.style.display = 'block';
    activeOrder = null;
    payBtn.textContent = 'Pay Now';
    updatePayButton();
  }
});

async function startPayment(order) {
  clearTimeout(paymentPollTimer);
  paymentAttempts = 0;
  payBtn.disabled = true;
  showPaymentOverlay('prompt', order);
  try {
    const initRes = await fetch('/api/payment/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order._id })
    });
    const initData = await initRes.json();
    if (!initRes.ok) throw new Error(initData.error || 'Payment could not be started');
    pollPaymentStatus(order);
  } catch (err) {
    showPaymentOverlay('retry', order, err.message);
  }
}

async function pollPaymentStatus(order) {
  paymentAttempts++;
  try {
    const res = await fetch(`/api/payment/status/${encodeURIComponent(order._id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not check payment status');
    if (data.status === 'paid') {
      clearTimeout(paymentPollTimer);
      clearCart();
      activeOrder = null;
      showPaymentOverlay('success', data.order);
      return;
    }
    if (data.status === 'failed') {
      clearTimeout(paymentPollTimer);
      showPaymentOverlay('failed', order);
      return;
    }
  } catch {
    // A temporary status-check failure should not cancel the payment attempt.
  }

  if (paymentAttempts >= 40) {
    showPaymentOverlay('pending', order);
    return;
  }
  paymentPollTimer = setTimeout(() => pollPaymentStatus(order), 3000);
}

function showPaymentOverlay(state, order, detail = '') {
  const backdrop = document.getElementById('payBackdrop');
  const sheet = document.getElementById('payStatusSheet');
  const content = document.getElementById('payStatusContent');
  backdrop.classList.add('open');
  sheet.classList.add('open');

  const provider = order.payment?.provider === 'mtn' ? 'MTN Money' : 'Airtel Money';

  if (state === 'prompt') {
    content.innerHTML = `
      <h2 style="text-transform:uppercase;font-size:18px;">Check your phone</h2>
      <p style="margin-top:10px;color:var(--ink-soft);font-size:14px;">
        A payment request for <strong>K${escapeHtml(order.total)}</strong> to
        <strong>${escapeHtml(order.payment.phone)}</strong> via ${provider} is being started. Approve it to confirm your order.
      </p>
      <div class="order-code" style="margin-top:16px;">${escapeHtml(order.orderCode)}</div>
      <p class="helper-text">Keep this page open while payment is confirmed.</p>
    `;
  } else if (state === 'success') {
    content.innerHTML = `
      <h2 style="text-transform:uppercase;font-size:18px;color:var(--denim-mid);">Payment received</h2>
      <p style="margin-top:10px;color:var(--ink-soft);font-size:14px;">Your order is confirmed and heading into processing.</p>
      <div class="order-code" style="margin-top:16px;">${escapeHtml(order.orderCode)}</div>
      <a class="btn-primary" style="display:block;text-align:center;margin-top:18px;"
        href="/track?code=${encodeURIComponent(order.orderCode)}">Track Order</a>
    `;
  } else if (['failed', 'retry', 'pending'].includes(state)) {
    const heading = state === 'failed' ? 'Payment not completed' : state === 'pending' ? 'Payment still pending' : 'Payment could not start';
    const message = detail || (state === 'failed'
      ? 'The payment provider did not confirm this payment. Retry using the same order.'
      : state === 'pending'
        ? 'We have not received a final payment update yet. You can check again or retry this order.'
        : 'Your order is saved. Retry payment without creating another order.');
    content.innerHTML = `
      <h2 style="text-transform:uppercase;font-size:18px;color:#B3261E;">${escapeHtml(heading)}</h2>
      <p style="margin-top:10px;color:var(--ink-soft);font-size:14px;">
        ${escapeHtml(message)}
      </p>
      <div class="order-code" style="margin-top:16px;">${escapeHtml(order.orderCode)}</div>
      <button class="btn-primary" id="retryPayBtn" style="margin-top:18px;">${state === 'pending' ? 'Check Again' : 'Retry Payment'}</button>
    `;
    document.getElementById('retryPayBtn').addEventListener('click', () => {
      if (state === 'pending') {
        showPaymentOverlay('prompt', order);
        paymentAttempts = 0;
        pollPaymentStatus(order);
      } else {
        startPayment(order);
      }
    });
  }
}

renderCheckoutItems();
loadProvinces();
