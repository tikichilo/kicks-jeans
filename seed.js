require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

const products = [
  {
    name: 'Air Step Low',
    category: 'shoes',
    price: 850,
    sizes: ['40', '41', '42', '43', '44'],
    colors: ['White', 'Black'],
    image: 'https://placehold.co/600x600/C7D6EF/1F3768?text=Air+Step+Low',
    description: 'Clean low-top sneaker, everyday rotation piece.',
    featured: true
  },
  {
    name: 'Court Classic',
    category: 'shoes',
    price: 920,
    sizes: ['39', '40', '41', '42', '43'],
    colors: ['White', 'Denim Blue'],
    image: 'https://placehold.co/600x600/C7D6EF/1F3768?text=Court+Classic',
    description: 'Retro court silhouette with a denim-blue heel tab.'
  },
  {
    name: 'Street Runner',
    category: 'shoes',
    price: 1050,
    sizes: ['40', '41', '42', '43', '44', '45'],
    colors: ['Black', 'White'],
    image: 'https://placehold.co/600x600/C7D6EF/1F3768?text=Street+Runner',
    description: 'Chunky sole, built for the daily commute and then some.',
    featured: true
  },
  {
    name: 'Straight Cut Denim',
    category: 'jeans',
    price: 650,
    sizes: ['28', '30', '32', '34', '36'],
    colors: ['Jean Blue'],
    image: 'https://placehold.co/600x600/1F3768/FFFFFF?text=Straight+Cut',
    description: 'Mid-rise straight leg in classic jean blue wash.',
    featured: true
  },
  {
    name: 'Baggy Fit Denim',
    category: 'jeans',
    price: 700,
    sizes: ['28', '30', '32', '34', '36', '38'],
    colors: ['Jean Blue', 'Black'],
    image: 'https://placehold.co/600x600/1F3768/FFFFFF?text=Baggy+Fit',
    description: 'Relaxed baggy cut, stacks at the ankle.'
  },
  {
    name: 'Slim Stack Denim',
    category: 'jeans',
    price: 680,
    sizes: ['28', '30', '32', '34'],
    colors: ['Black', 'Jean Blue'],
    image: 'https://placehold.co/600x600/1F3768/FFFFFF?text=Slim+Stack',
    description: 'Slim through the leg with a stacked hem.',
    featured: true
  }
];

async function seed() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set in .env');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const productNames = products.map(product => product.name);
  const existingNames = await Product.distinct('name', { name: { $in: productNames } });
  const existingNameSet = new Set(existingNames);
  const newProducts = products.filter(product => !existingNameSet.has(product.name));

  if (newProducts.length > 0) {
    await Product.insertMany(newProducts);
  }

  console.log(`Seeded ${newProducts.length} products; ${products.length - newProducts.length} already existed`);
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error(err);
  mongoose.disconnect();
  process.exit(1);
});
