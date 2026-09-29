// Delivery fee table — flat rate per province, from the Lusaka warehouse.
// Adjust these to match real courier rates whenever you have them.
const PROVINCE_RATES = {
  'Lusaka': 30,
  'Copperbelt': 60,
  'Central': 55,
  'Southern': 65,
  'Eastern': 80,
  'Northern': 90,
  'North-Western': 95,
  'Luapula': 95,
  'Muchinga': 95,
  'Western': 85
};

const EXPRESS_SURCHARGE = 25; // same-day / next-day within Lusaka

function calculateDeliveryFee({ province, express = false }) {
  const base = PROVINCE_RATES[province];
  if (base === undefined) {
    throw new Error(`Unknown province: ${province}`);
  }
  let fee = base;
  if (express) {
    if (province !== 'Lusaka') {
      throw new Error('Express delivery is only available within Lusaka');
    }
    fee += EXPRESS_SURCHARGE;
  }
  return fee;
}

module.exports = { calculateDeliveryFee, PROVINCE_RATES, EXPRESS_SURCHARGE };
