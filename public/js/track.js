const STATUS_STEPS = [
  { key: 'pending_payment', label: 'Order Placed' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' }
];
const STATUS_LABELS = Object.fromEntries(STATUS_STEPS.map(step => [step.key, step.label]));
STATUS_LABELS.cancelled = 'Cancelled';

const trackForm = document.getElementById('trackForm');
const trackError = document.getElementById('trackError');
const trackBtn = document.getElementById('trackBtn');
const orderResult = document.getElementById('orderResult');
let refreshTimer;
let activeLookup;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-ZM', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lusaka'
  }).format(date);
}

async function lookupOrder(code, phone, { background = false } = {}) {
  if (!background) {
    clearInterval(refreshTimer);
    activeLookup = { code, phone };
  }
  trackError.style.display = 'none';
  if (!background) {
    trackBtn.disabled = true;
    trackBtn.textContent = 'Looking up...';
  }
  try {
    const res = await fetch(`/api/orders/track/${encodeURIComponent(code.trim().toUpperCase())}?phone=${encodeURIComponent(phone)}`, {
      cache: 'no-store'
    });
    const order = await res.json();
    if (!res.ok) throw new Error(order.error || 'Order not found');
    renderOrder(order);
    clearInterval(refreshTimer);
    if (!['delivered', 'cancelled'].includes(order.status)) {
      refreshTimer = setInterval(() => {
        if (!document.hidden && activeLookup) lookupOrder(activeLookup.code, activeLookup.phone, { background: true });
      }, 30000);
    }
  } catch (err) {
    if (!background) {
      orderResult.innerHTML = '';
      trackError.textContent = err.message;
      trackError.style.display = 'block';
    }
  } finally {
    if (!background) {
      trackBtn.disabled = false;
      trackBtn.textContent = 'Track Order';
    }
  }
}

function renderOrder(order) {
  const stepIndex = STATUS_STEPS.findIndex(step => step.key === order.status);

  const stepsHtml = STATUS_STEPS.map((step, index) => {
    let cls = '';
    if (order.status === 'cancelled') cls = '';
    else if (index < stepIndex) cls = 'done';
    else if (index === stepIndex) cls = 'current';
    return `<div class="status-step ${cls}"><div class="status-dot"></div><div class="status-label">${step.label}</div></div>`;
  }).join('');

  const itemsHtml = (order.items || []).map(item => `
    <div class="drawer-item" style="border-bottom:1px dashed var(--ink);">
      <div class="drawer-item-info">
        <div class="drawer-item-name">${escapeHtml(item.name)}</div>
        <div class="drawer-item-meta">${escapeHtml([item.size, item.color].filter(Boolean).join(' / ') || 'Standard')} · Qty ${escapeHtml(item.qty)}</div>
      </div>
      <div class="price-tag">${(Number(item.price) * Number(item.qty)).toLocaleString('en-ZM')}</div>
    </div>
  `).join('');

  const historyHtml = (order.statusHistory || []).slice().reverse().map(event => `
    <li class="tracking-event">
      <span class="tracking-event-marker" aria-hidden="true"></span>
      <div>
        <strong>${escapeHtml(STATUS_LABELS[event.status] || event.status)}</strong>
        <p>${escapeHtml(event.message || 'Order status updated')}</p>
        <time datetime="${escapeHtml(event.createdAt)}">${escapeHtml(formatDate(event.createdAt))}</time>
      </div>
    </li>
  `).join('');

  const shipment = order.shipment || {};
  const hasTrackingUrl = /^https?:\/\//i.test(shipment.trackingUrl || '');
  const shipmentHtml = shipment.trackingNumber ? `
    <section class="shipment-details" aria-label="Shipment details">
      <h2>Shipment</h2>
      <dl>
        <div><dt>Courier</dt><dd>${escapeHtml(shipment.carrier || 'Courier')}</dd></div>
        <div><dt>Tracking number</dt><dd>${escapeHtml(shipment.trackingNumber)}</dd></div>
      </dl>
      ${hasTrackingUrl ? `<a class="shipment-link" href="${escapeHtml(shipment.trackingUrl)}" target="_blank" rel="noopener noreferrer">Open courier tracking</a>` : ''}
    </section>
  ` : '';

  const paymentMessage = order.paymentStatus === 'pending'
    ? 'Payment confirmation is still pending.'
    : order.paymentStatus === 'failed'
      ? 'Payment was not confirmed. Contact us before placing another order.'
      : '';

  orderResult.innerHTML = `
    <div class="order-card">
      <div class="tracking-card-head">
        <div>
          <div class="order-code">${escapeHtml(order.orderCode)}</div>
          <div class="tracking-current-status">${escapeHtml(STATUS_LABELS[order.status] || order.status)}</div>
        </div>
        <button type="button" class="refresh-order" data-refresh aria-label="Refresh tracking status" title="Refresh tracking status">Refresh</button>
      </div>
      <div class="tracking-updated">Updated ${escapeHtml(formatDate(order.updatedAt))} · Refreshes automatically</div>
      ${paymentMessage ? `<p class="payment-notice">${escapeHtml(paymentMessage)}</p>` : ''}
      ${order.status !== 'cancelled' ? `<div class="status-track">${stepsHtml}</div>` : '<p class="cancelled-notice">This order has been cancelled.</p>'}
      ${shipmentHtml}

      <section class="tracking-history">
        <h2>Order updates</h2>
        ${historyHtml ? `<ol>${historyHtml}</ol>` : '<p>No updates have been recorded yet.</p>'}
      </section>

      <div style="margin-top:20px;">${itemsHtml}</div>

      <div class="summary-row" style="margin-top:14px;"><span>Subtotal</span><span>K${Number(order.subtotal).toLocaleString('en-ZM')}</span></div>
      <div class="summary-row"><span>Delivery</span><span>K${Number(order.deliveryFee).toLocaleString('en-ZM')}</span></div>
      <div class="summary-row total"><span>Total</span><span>K${Number(order.total).toLocaleString('en-ZM')}</span></div>

      <div class="delivery-destination">Delivering to <strong>${escapeHtml(order.customer.town)}, ${escapeHtml(order.customer.province)}</strong></div>
    </div>
  `;

  orderResult.querySelector('[data-refresh]').addEventListener('click', () => {
    if (activeLookup) lookupOrder(activeLookup.code, activeLookup.phone, { background: true });
  });
}

trackForm.addEventListener('submit', e => {
  e.preventDefault();
  const code = document.getElementById('orderCode').value;
  const phone = document.getElementById('orderPhone').value;
  lookupOrder(code, phone);
});

// Auto-fill + lookup if arriving from checkout with ?code=&phone=
const params = new URLSearchParams(window.location.search);
if (params.get('code')) {
  document.getElementById('orderCode').value = params.get('code');
  if (params.get('phone')) {
    document.getElementById('orderPhone').value = params.get('phone');
    lookupOrder(params.get('code'), params.get('phone'));
  }
}
