const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

async function convertImages() {
  const sourceDir = path.resolve(process.argv[2] || 'public/images/products');
  const outputDir = path.resolve(process.argv[3] || path.join(sourceDir, 'webp'));
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const images = entries.filter(entry =>
    entry.isFile() && /\.(?:jpe?g|png)$/i.test(entry.name)
  );

  await fs.mkdir(outputDir, { recursive: true });
  for (const image of images) {
    const source = path.join(sourceDir, image.name);
    const destination = path.join(outputDir, `${path.parse(image.name).name}.webp`);
    await sharp(source).webp({ quality: 82 }).toFile(destination);
    console.log(`Converted ${source} -> ${destination}`);
  }
}

convertImages().catch(error => {
  console.error('Image conversion failed:', error.message);
  process.exitCode = 1;
});
