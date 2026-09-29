async function publishProductImage({ category, images, aiEnabled, cloudinary, createProductImage }) {
  if (!aiEnabled && images.length !== 1) {
    const error = new Error('Upload exactly one product photo while image editing is bypassed');
    error.status = 400;
    throw error;
  }

  const generated = aiEnabled ? await createProductImage({ category, images }) : null;
  const sourceImage = generated
    ? { buffer: generated.buffer, mimetype: 'image/png' }
    : images[0];
  const uploadOptions = {
    folder: 'kicks-and-jeans/products',
    transformation: [{ width: 1200, height: 1200, crop: 'limit' }]
  };
  if (generated) uploadOptions.format = 'png';

  const cloudinaryImage = await cloudinary.uploader.upload(
    `data:${sourceImage.mimetype};base64,${sourceImage.buffer.toString('base64')}`,
    uploadOptions
  );

  return { cloudinaryImage, generated };
}

module.exports = { publishProductImage };