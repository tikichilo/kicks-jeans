const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateDeliveryFee, PROVINCE_RATES } = require('../services/delivery');

test('delivery fees are available for every configured province', () => {
  for (const [province, fee] of Object.entries(PROVINCE_RATES)) {
    assert.equal(calculateDeliveryFee({ province }), fee);
  }
});

test('express delivery is limited to Lusaka', () => {
  assert.equal(calculateDeliveryFee({ province: 'Lusaka', express: true }), PROVINCE_RATES.Lusaka + 25);
  assert.throws(() => calculateDeliveryFee({ province: 'Copperbelt', express: true }), /only available within Lusaka/);
});

test('unknown provinces are rejected', () => {
  assert.throws(() => calculateDeliveryFee({ province: 'Unknown' }), /Unknown province/);
});