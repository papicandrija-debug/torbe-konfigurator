const express = require('express');
const https = require('https');
const http = require('http');
const app = express();
app.use(express.json());
app.use(express.static('public'));

// Preuzmi sliku s URL-a kao base64
function fetchImageAsBase64(imageUrl) {
  return new Promise((resolve, reject) => {
    const protocol = imageUrl.startsWith('https') ? https : http;
    const req = protocol.get(imageUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchImageAsBase64(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          base64: buffer.toString('base64'),
          mime: res.headers['content-type'] || 'image/jpeg'
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

// Korak 1: gpt-4o gleda sliku i opisuje proizvod
function describeProductWithVision(imageBase64, imageMime, gender, age, season, model) {
  return new Promise((resolve, reject) => {
    const isNewborn = model === 'cloud';
    
    const genderHr = gender === 'djevojčica' ? 'girl' : 'boy';
    const sceneDesc = isNewborn
      ? `a peaceful sleeping newborn ${genderHr} lying in a white wooden baby crib in a cozy Scandinavian nursery with soft natural light`
      : `a happy smiling ${genderHr} toddler age ${age} standing upright in a cozy nursery room with ${
          season === 'proljeće' ? 'soft morning light' :
          season === 'ljeto' ? 'bright sunny daylight' :
          season === 'jesen' ? 'warm evening lamp light' : 'soft warm lamp light'
        }`;

    const labelInstruction = isNewborn
      ? `There is a small "mamino" woven label sewn on the side seam near the bottom of the sleep sack.`
      : `There is a small "mamino" woven label sewn on the outer side seam of the left leg, near the ankle.`;

    const bodyPart = JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${imageMime};base64,${imageBase64}`,
                detail: 'high'
              }
            },
            {
              type: 'text',
              text: `You are a professional product photographer's assistant. 
              
Look at this baby sleep sack product image carefully. Note the exact shape, structure, color, fabric texture, zipper placement, leg shape, and whether feet are open or closed.

Now write a detailed image generation prompt (for DALL-E/image AI) that shows:
- ${sceneDesc}
- wearing THIS EXACT sleep sack from the image — same shape, same color, same fabric texture, same zipper placement
- ${labelInstruction}
- The fabric must be PLAIN SOLID COLOR — no prints, no patterns, no animal motifs, no decorations
- NO other brand logos or text visible except the small "mamino" label described above

Write ONLY the image generation prompt, nothing else. Be very specific about the garment shape based on what you see in the image.`
            }
          ]
        }
      ]
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(bodyPart)
      },
      timeout: 60000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const prompt = parsed.choices?.[0]?.message?.content;
          if (!prompt) return reject(new Error('No prompt from gpt-4o: ' + data.substring(0, 200)));
          resolve(prompt);
        } catch (e) {
          reject(new Error('Parse error: ' + data.substring(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Vision timeout')); });
    req.write(bodyPart);
    req.end();
  });
}

// Korak 2: gpt-image-2 generira sliku na temelju prompta
function generateImage(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-image-2',
      prompt: prompt,
      n: 1,
      size: '1024x1024',
      quality: 'medium'
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 240000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error('Parse error: ' + data.substring(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Image gen timeout')); });
    req.write(body);
    req.end();
  });
}

// Slike proizvoda s mamino.hr
const modelImages = {
  cloud:    'https://mamino.hr/cdn/shop/files/Vreca_za_spavanje_novorodjence.png?v=1768914766',
  proljece: 'https://mamino.hr/cdn/shop/files/Mamino_white_product_photos_2_1.jpg?v=1754995072',
  ljeto:    'https://mamino.hr/cdn/shop/files/MAMINO_2-49.jpg?v=1748352986',
  jesen:    'https://mamino.hr/cdn/shop/files/mamino_jesen_2025-30.jpg?v=1758780056',
  zima:     'https://mamino.hr/cdn/shop/files/MAMINO_2-53.jpg?v=1768914766'
};

app.post('/generate', async (req, res) => {
  const { model, gender, age, season } = req.body;
  if (!model) return res.status(400).json({ error: 'Missing model' });

  res.setHeader('Connection', 'keep-alive');

  try {
    // Korak 1: preuzmi sliku proizvoda
    console.log('Fetching product image for:', model);
    const imageUrl = modelImages[model];
    const { base64, mime } = await fetchImageAsBase64(imageUrl);
    console.log('Product image fetched, size:', base64.length);

    // Korak 2: gpt-4o opisuje proizvod i piše prompt
    console.log('Asking gpt-4o to describe product...');
    const imagePrompt = await describeProductWithVision(base64, mime, gender, age, season, model);
    console.log('GPT-4o prompt:', imagePrompt.substring(0, 300));

    // Korak 3: gpt-image-2 generira sliku
    console.log('Generating final image...');
    const { status, body } = await generateImage(imagePrompt);
    console.log('Image gen status:', status);

    if (status !== 200) {
      return res.status(status).json({ error: body.error?.message || 'OpenAI error' });
    }

    if (!body.data?.[0]) {
      return res.status(500).json({ error: 'No image: ' + JSON.stringify(body).substring(0, 200) });
    }

    const imgData = body.data[0];
    if (imgData.url) return res.json({ url: imgData.url });
    if (imgData.b64_json) return res.json({ url: `data:image/png;base64,${imgData.b64_json}` });

    return res.status(500).json({ error: 'No url or b64_json' });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
server.timeout = 300000;
server.keepAliveTimeout = 300000;
