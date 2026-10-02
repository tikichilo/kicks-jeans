const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReceiptEmail } = require('../services/orderReceipt');

test('receipt email includes order details, ZMW totals, and escaped customer content', () => {
  const receipt = buildReceiptEmail({
    orderCode: 'KJ-ABC234',
    items: [{
      name: '<Runner> "Limited"',
      size: '42',
      color: 'Blue & white',
      qty: 2,
      price: 500
    }],
    subtotal: 1000,
    deliveryFee: 50,
    total: 1050,
    customer: {
      name: 'A & B',
      email: 'customer@example.com',
      phone: '0970000000',
      address: '1 Main <Street>',
      town: 'Lusaka',
      province: 'Lusaka'
    },
    payment: { provider: 'mtn', phone: '0971111111' }
  });

  assert.match(receipt.subject, /KJ-ABC234/);
  assert.match(receipt.text, /Total paid: ZMW 1050\.00/);
  assert.match(receipt.text, /MTN Money/);
  assert.match(receipt.html, /&lt;Runner&gt; &quot;Limited&quot;/);
  assert.match(receipt.html, /Blue &amp; white/);
  assert.match(receipt.html, /1 Main &lt;Street&gt;/);
  assert.doesNotMatch(receipt.html, /<Runner>/);
});
