const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publishProductImage } = require('../services/productImagePublisher');

test('bypass mode publishes the uploaded photo without calling image AI', async () => {
  const calls = [];
  const uploaded = { secure_url: 'https://images.example/product.jpg', public_id: 'product' };
  const result = await publishProductImage({
    category: 'shoes',
    images: [{ buffer: Buffer.from('photo'), mimetype: 'image/jpeg' }],
    aiEnabled: false,
    createProductImage: async () => { throw new Error('AI must not run'); },
    cloudinary: { uploader: { upload: async (...args) => { calls.push(args); return uploaded; } } }
  });

  assert.equal(result.generated, null);
  assert.equal(result.cloudinaryImage, uploaded);
  assert.equal(calls[0][0], `data:image/jpeg;base64,${Buffer.from('photo').toString('base64')}`);
  assert.equal('format' in calls[0][1], false);
});

test('enabled mode edits the references and publishes the generated PNG', async () => {
  const source = { buffer: Buffer.from('reference'), mimetype: 'image/jpeg' };
  const generated = { buffer: Buffer.from('edited'), command: '/showcase', model: 'test-model' };
  const calls = [];
  const result = await publishProductImage({
    category: 'shoes',
    images: [source],
    aiEnabled: true,
    createProductImage: async input => {
      assert.deepEqual(input, { category: 'shoes', images: [source] });
      return generated;
    },
    cloudinary: { uploader: { upload: async (...args) => { calls.push(args); return {}; } } }
  });

  assert.equal(result.generated, generated);
  assert.equal(calls[0][0], `data:image/png;base64,${Buffer.from('edited').toString('base64')}`);
  assert.equal(calls[0][1].format, 'png');
});

test('bypass mode rejects multiple photos instead of silently ignoring them', async () => {
  await assert.rejects(
    publishProductImage({
      category: 'jeans',
      images: [
        { buffer: Buffer.from('one'), mimetype: 'image/jpeg' },
        { buffer: Buffer.from('two'), mimetype: 'image/jpeg' }
      ],
      aiEnabled: false,
      cloudinary: { uploader: { upload: async () => ({}) } },
      createProductImage: async () => { throw new Error('AI must not run'); }
    }),
    { message: 'Upload exactly one product photo while image editing is bypassed', status: 400 }
  );
});