// utils/cloudinaryUpload.js
//
// Fail-fast Cloudinary config + reusable multer upload middleware.
// Requiring this file (from server.js, before routes are mounted) makes
// the app refuse to start if the Cloudinary env vars are missing, instead
// of failing silently the first time someone tries to upload a product
// photo. Same pattern as bee-cee-logistics-website's utils/cloudinaryUpload.js.

const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error(
    'FATAL: Cloudinary env vars are missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in .env.'
  );
  process.exit(1);
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function fileFilter(req, file, cb) {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, or WEBP images are allowed.'));
  }
}

// Keep source images in memory; only the AI-generated final image is published.
const uploadProductSources = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
});

module.exports = { cloudinary, uploadProductSources };
