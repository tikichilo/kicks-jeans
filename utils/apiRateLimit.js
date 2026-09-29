const { rateLimit } = require('express-rate-limit');

function apiRateLimit(limit, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: message }
  });
}

module.exports = apiRateLimit;