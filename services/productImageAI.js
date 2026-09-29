const MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5';

const IMAGE_STYLES = {
  shoes: {
    command: '/showcase',
    prompt: 'Create one premium ecommerce showcase photograph of the exact shoe shown in the reference images. Treat all references as views of the same product. Faithfully preserve the shoe silhouette, colors, sole, laces, materials, stitching, logos, and details. Show only this pair, centered and clearly visible, with clean studio lighting and a simple complementary background. No text, no collage, no extra products, and do not invent branding.'
  },
  jeans: {
    command: '/lifestyle',
    prompt: 'Create one realistic fashion lifestyle photograph featuring the exact jeans garment shown in the reference images. Treat all references as views of the same product. Show the jeans worn naturally by one adult model in a tasteful casual setting, with the garment clearly visible and well lit. Faithfully preserve its wash, color, cut, fit, stitching, pockets, and hardware. No text, no collage, no extra products, and do not invent branding.'
  }
};

async function createProductImage({ category, images }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('Image AI is not configured. Set OPENAI_API_KEY on the server.');
    error.status = 503;
    throw error;
  }
  if (!Array.isArray(images) || images.length < 1 || images.length > 5) {
    const error = new Error('Upload between 1 and 5 reference photos.');
    error.status = 400;
    throw error;
  }

  const style = IMAGE_STYLES[category];
  if (!style) {
    const error = new Error('Choose shoes or jeans before processing images.');
    error.status = 400;
    throw error;
  }

  const requestBody = {
    model: MODEL,
    images: images.map(image => ({
      image_url: `data:${image.mimetype};base64,${image.buffer.toString('base64')}`
    })),
    prompt: style.prompt,
    n: 1,
    size: '1024x1024',
    quality: 'high',
    output_format: 'png',
    input_fidelity: 'high'
  };

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(120000)
    });
  } catch (cause) {
    const error = new Error(cause.name === 'TimeoutError'
      ? 'Image processing timed out. Try again with fewer or smaller photos.'
      : 'Could not reach the image processing service. Try again later.');
    error.status = cause.name === 'TimeoutError' ? 504 : 502;
    throw error;
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerError = result.error || {};
    const providerCode = `${providerError.code || ''} ${providerError.type || ''}`.toLowerCase();
    const quotaExceeded = /insufficient_quota|billing_hard_limit|quota/.test(providerCode);
    const error = new Error(response.status === 401
      ? 'Image AI rejected its API key. Check OPENAI_API_KEY on the server.'
      : response.status === 429 && quotaExceeded
        ? 'OpenAI API quota or spending limit reached. Check billing and usage limits for the API project that owns OPENAI_API_KEY.'
        : response.status === 429
          ? 'Image AI rate limit reached. Wait briefly, then try again.'
          : `Image processing failed (${response.status}). Try again or contact support.`);
    error.status = response.status === 429 ? (quotaExceeded ? 503 : 429) : 502;
    const retryAfter = response.headers?.get?.('retry-after');
    if (response.status === 429 && !quotaExceeded && /^\d+$/.test(retryAfter || '')) {
      error.retryAfter = retryAfter;
      error.message += ` Retry in about ${retryAfter} seconds.`;
    }
    throw error;
  }

  const imageBase64 = result.data?.[0]?.b64_json;
  if (!imageBase64) {
    const error = new Error('Image AI returned no finished image. Try again.');
    error.status = 502;
    throw error;
  }

  return {
    buffer: Buffer.from(imageBase64, 'base64'),
    command: style.command,
    model: MODEL
  };
}

module.exports = { createProductImage };