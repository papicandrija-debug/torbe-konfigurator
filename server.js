const express = require('express');
const https = require('https');
const http = require('http');
const FormData = require('form-data');
const app = express();
app.use(express.json());
app.use(express.static('public'));

// Preuzmi sliku s URL-a kao Buffer
function fetchImageBuffer(imageUrl) {
  return new Promise((resolve, reject) => {
    const protocol = imageUrl.startsWith('https') ? https : http;
    protocol.get(imageUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchImageBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        mime: res.headers['content-type'] || 'image/jpeg'
      }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Slike proizvoda s mamino.hr — čiste bijele pozadine za bolju referencu
const modelImages = {
  cloud:    'https://mamino.hr/cdn/shop/files/Vreca_za_spavanje_novorodjence.png?v=1768914766',
  proljece: 'https://mamino.hr/cdn/shop/files/Mamino_white_product_photos_2_1.jpg?v=1754995072',
  ljeto:    'https://mamino.hr/cdn/shop/files/MAMINO_2-49.jpg?v=1748352986',
  jesen:    'https://mamino.hr/cdn/shop/files/mamino_jesen_2025-30.jpg?v=1758780056',
  zima:     'https://mamino.hr/cdn/shop/files/MAMINO_2-53.jpg?v=1768914766'
};

const modelNames = {
  cloud:    'Cloud™ Vreća za Spavanje',
  proljece: 'Sleepy™ Proljeće',
  ljeto:    'Sleepy™ Ljeto',
  jesen:    'Sleepy™ Jesen',
  zima:     'Sleepy™ Zima'
};

app.post('/generate', async (req, res) => {
  const { model, gender, age, season } = req.body;
  if (!model) return res.status(400).json({ error: 'Missing model' });

  res.setHeader('Connection', 'keep-alive');

  try {
    // Preuzmi sliku proizvoda
    console.log('Fetching product image:', model);
    const { buffer, mime } = await fetchImageBuffer(modelImages[model]);
    console.log('Image fetched, bytes:', buffer.length, 'mime:', mime);

    const isNewborn = model === 'cloud';
    const genderWord = gender === 'djevojčica' ? 'girl' : 'boy';

    const roomMood = {
      proljeće: 'bright airy Scandinavian nursery with soft natural morning light, white wooden furniture',
      ljeto: 'bright sunny nursery room with light linen curtains and warm daylight',
      jesen: 'cozy warm nursery with warm lamp light and wooden accents',
      zima: 'cozy warm nursery with soft lamp light, knitted blanket in background'
    }[season] || 'cozy Scandinavian nursery with soft natural light';

    let prompt;
    if (isNewborn) {
      prompt = `Realistic professional lifestyle photo of a peaceful sleeping newborn baby (${genderWord}) lying in a white wooden baby crib in a ${roomMood}.

The baby is dressed in the EXACT sleep sack shown in the reference image — same color, same pattern, same shape, same zipper placement, same fabric texture. Reproduce the garment faithfully.

The sleep sack label "mamino" is a small woven tag sewn on the side seam at the bottom of the sleep sack.

The baby is sleeping peacefully, full body visible in the crib. White wooden crib rails visible. Soft natural light. Warm lifestyle photography, shallow depth of field. No other text or logos visible.`;
    } else {
      prompt = `Realistic professional lifestyle photo of a happy smiling ${genderWord} toddler, age ${age}, standing upright in a ${roomMood}.

The child is dressed in the EXACT sleep sack with legs shown in the reference image — same color, same pattern (if any), same shape, same zipper placement, same leg shape, same fabric texture, same feet (open or closed). Reproduce the garment faithfully.

The sleep sack label "mamino" is a small woven tag sewn on the outer side seam of the left leg near the ankle.

The child stands smiling, full body visible from head to toe, arms slightly out to sides. Warm lifestyle photography, natural light, shallow depth of field. No other text or logos visible.`;
    }

    console.log('Building multipart request with image...');

    // Šalji na /v1/images/edits s referentnom slikom
    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('quality', 'medium');

    // Dodaj referentnu sliku
    const ext = mime.includes('png') ? 'png' : 'jpg';
    form.append('image[]', buffer, {
      filename: `product.${ext}`,
      contentType: mime
    });

    const formHeaders = form.getHeaders();
    const formBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      form.on('data', chunk => chunks.push(chunk));
      form.on('end', () => resolve(Buffer.concat(chunks)));
      form.on('error', reject);
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/images/edits',
      method: 'POST',
      headers: {
        ...formHeaders,
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Length': formBuffer.length
      },
      timeout: 240000
    };

    const result = await new Promise((resolve, reject) => {
      const apiReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
          try {
            resolve({ status: apiRes.statusCode, body: JSON.parse(data) });
          } catch (e) {
            reject(new Error('Parse error: ' + data.substring(0, 300)));
          }
        });
      });
      apiReq.on('error', reject);
      apiReq.on('timeout', () => { apiReq.destroy(); reject(new Error('Timeout')); });
      apiReq.write(formBuffer);
      apiReq.end();
    });

    console.log('OpenAI status:', result.status);
    console.log('Response:', JSON.stringify(result.body).substring(0, 300));

    if (result.status !== 200) {
      return res.status(result.status).json({ error: result.body.error?.message || 'OpenAI error' });
    }

    const imgData = result.body.data?.[0];
    if (!imgData) return res.status(500).json({ error: 'No image data' });

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
