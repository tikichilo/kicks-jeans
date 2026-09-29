# Kicks & Jeans

Sneakers and denim, delivered anywhere in Zambia. Pay by MTN or Airtel Mobile Money.
Node.js / Express / MongoDB — same stack as your other projects.

## Pages

1. **`/` — Store (index)**: product grid, quick-add sheet (size/colour), sticky
   cart bar, slide-out cart drawer. Cart lives in `localStorage` so it survives
   a refresh.
2. **`/checkout`**: delivery form (name, phone, province/town/address),
   live delivery-fee quote by province, MTN/Airtel Money payment, polls
   payment status and shows a confirmation with the order code.
3. **`/track`**: look up an order by order code + phone number, see a timestamped
   status timeline, courier tracking details, and automatic refresh.
4. **`/admin`**: invite-only admin sign-in, searchable orders, and fulfillment
   status updates with courier tracking details.

## Setup

```bash
# create .env in the project root and set MongoDB, Cloudinary, and admin values
npm install
npm run seed     # loads 6 sample products (placeholder images)
npm run dev       # http://localhost:3000
```

Run `npm test` before deployment. For local payment-flow testing, set
`PAYMENT_MODE=mock`; simulated payments are unavailable in production.

## Payments — MTN & Airtel Mobile Money

`services/momo.js` uses **pawaPay** (https://pawapay.io) as the aggregator —
one API for both MTN Mobile Money and Airtel Money in Zambia, so you don't
need two separate merchant integrations. To go live:

1. Sign up at pawaPay, get sandbox → then production API tokens.
2. Set `PAWAPAY_API_TOKEN` and `PAWAPAY_BASE_URL` in `.env`.
3. Point your pawaPay dashboard's callback/webhook URL at
   `https://yourdomain.com/api/payment/webhook`.

Mock payments must be explicitly enabled with `PAYMENT_MODE=mock` for local
development. Without a token or explicit mock mode, payments fail closed.
Production requires `NODE_ENV=production`, `PAYMENT_MODE=live`,
`PAWAPAY_API_TOKEN`, and `PAWAPAY_BASE_URL` set to the pawaPay production URL;
sandbox URLs and simulated payments are rejected at startup. Provider callbacks
are treated as notifications and verified against pawaPay before an order is
marked paid.

If you'd rather integrate MTN and Airtel directly instead of through an
aggregator, `services/momo.js` is the only file that needs to change —
`initiatePayment()` / `checkStatus()` are the two functions the rest of the
app calls.

## Delivery fees

Flat rate per province in `services/delivery.js`, plus an optional Lusaka-only
express surcharge. Edit `PROVINCE_RATES` to match real courier pricing —
these are placeholder numbers.

## Order fulfillment tracking

Set `ADMIN_INVITE_CODE` to a private invite code and `ADMIN_SESSION_SECRET` to
a random secret of at least 32 characters. Share the invite code only with
trusted staff; anyone with it can create an admin account. The dashboard is at
`/admin`; sessions are signed, HTTP-only cookies that expire after eight
hours. Rotate the invite code after onboarding if you want to close account
creation.

Admin users can advance orders through the dashboard. Only the next valid
fulfillment status is accepted; shipping requires a courier and tracking
number. Payment confirmation moves a pending order into processing. Status
updates can include a customer-facing message of up to 180 characters.

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Product images

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and
`CLOUDINARY_API_SECRET` in `.env`. Admins can create products with one JPG,
PNG, or WEBP reference photo using the protected admin product form. Set
`PRODUCT_IMAGE_AI_ENABLED=true` and `OPENAI_API_KEY` to enable image editing;
optionally set `OPENAI_IMAGE_MODEL` (defaults to `gpt-image-1.5`). Image editing
is bypassed by default: one uploaded photo (up to 5 MB) is published directly
to Cloudinary. When re-enabled, upload between one and five reference photos;
shoes use the `/showcase` prompt and jeans use the `/lifestyle` prompt. The AI
creates one final image, which is stored in Cloudinary and published with the
product; the reference photos are not published. Each product sends one
image-edit request to OpenAI.

Products can be assigned an audience of `men`, `women`, or `unisex` in the
admin product form. Existing products without an audience default to Unisex;
update them in the Products tab to populate the Men's and Women's storefront
filters. Audience filters can be combined with Shoes and Jeans.

The protected `POST /api/products` endpoint accepts `multipart/form-data`
with repeated `images` file fields plus `name`, `category` (`shoes` or
`jeans`), `price`, and optional `description`, comma-separated `sizes` and
`colors`, `featured`, and `inStock` fields. Seeded products continue to use
their placeholder images until replaced.

`/api/health` checks that the process is running. `/api/ready` returns `503`
until MongoDB is connected, which is the readiness signal for deployments.

## Deploy

Same pattern as your other client sites — Render works well:
- Build command: `npm install`
- Start command: `npm start`
- Add the same env vars from `.env` in Render's dashboard
- Run `npm run seed` once (Render shell or a one-off job) after the DB is live
- Set `NODE_ENV=production`, `PAYMENT_MODE=live`, the pawaPay production URL and
   token, and `TRUST_PROXY_HOPS` to the exact number of trusted reverse proxies
   in front of Express (usually `1`). Do not enable mock payments in production.
- Keep `.env` out of source control; this repository ignores local environment
   files and installed dependencies.
