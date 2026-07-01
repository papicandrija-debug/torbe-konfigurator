const express = require('express');
const https = require('https');
const http = require('http');
const FormData = require('form-data');
const { randomUUID } = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// In-memory job store
const jobs = {};

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

// Slike proizvoda s mamino.hr
const modelImages = {
  cloud:    'https://mamino.hr/cdn/shop/files/Vreca_za_spavanje_novorodjence.png?v=1768914766',
  proljece: 'https://mamino.hr/cdn/shop/files/Mamino_white_product_photos_2_1.jpg?v=1754995072',
  ljeto:    'https://mamino.hr/cdn/shop/files/MAMINO_2-49.jpg?v=1748352986',
  jesen:    'https://mamino.hr/cdn/shop/files/mamino_jesen_2025-30.jpg?v=1758780056',
  zima:     'https://mamino.hr/cdn/shop/files/MAMINO_2-53.jpg?v=1768914766'
};

// Generiraj sliku u pozadini
async function processJob(jobId, model, gender, age, season) {
  try {
    jobs[jobId].status = 'processing';

    // Preuzmi sliku proizvoda
    console.log(`[${jobId}] Fetching product image: ${model}`);
    const { buffer, mime } = await fetchImageBuffer(modelImages[model]);
    console.log(`[${jobId}] Image fetched: ${buffer.length} bytes`);

    const isNewborn = model === 'cloud';
    const genderWord = gender === 'djevojčica' ? 'girl' : 'boy';

    const roomMood = {
      proljeće: 'bright airy Scandinavian nursery, soft natural morning light, white wooden furniture',
      ljeto: 'bright sunny nursery room, light linen curtains, warm daylight',
      jesen: 'cozy warm nursery, warm lamp light, wooden accents',
      zima: 'cozy warm nursery, soft lamp light, winter atmosphere'
    }[season] || 'cozy Scandinavian nursery with soft natural light';

    let prompt;
    if (isNewborn) {
      prompt = `Realistic professional lifestyle photo of a peaceful sleeping newborn baby (${genderWord}) lying in a white wooden baby crib in a ${roomMood}.
The baby is dressed in the EXACT sleep sack shown in the reference image — same color, same pattern, same shape, same zipper, same fabric texture. Reproduce the garment faithfully.
Small woven "mamino" label sewn on the side seam at the bottom of the sleep sack.
Baby sleeping peacefully, full body visible in crib with white wooden rails. Soft natural light. Warm lifestyle photography, shallow depth of field. No other text or logos.`;
    } else {
      prompt = `Realistic professional lifestyle photo of a happy smiling ${genderWord} toddler, age ${age}, standing upright in a ${roomMood}.
The child is dressed in the EXACT sleep sack with legs shown in the reference image — same color, same pattern (reproduce exactly), same shape, same zipper, same leg shape, same feet (open or closed). Reproduce the garment faithfully.
Small woven "mamino" label sewn on the outer side seam of the left leg near the ankle.
Child standing smiling, full body visible head to toe, arms slightly out. Warm lifestyle photography, natural light, shallow depth of field. No other text or logos.`;
    }

    // Pošalji na OpenAI /v1/images/edits s referentnom slikom
    console.log(`[${jobId}] Sending to OpenAI...`);
    const form = new FormData();
    form.append('model', 'gpt-image-2');
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('quality', 'medium');

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

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.openai.com',
        path: '/v1/images/edits',
        method: 'POST',
        headers: {
          ...formHeaders,
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Length': formBuffer.length
        },
        timeout: 300000
      };

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
      apiReq.on('timeout', () => { apiReq.destroy(); reject(new Error('OpenAI timeout')); });
      apiReq.write(formBuffer);
      apiReq.end();
    });

    console.log(`[${jobId}] OpenAI status: ${result.status}`);
    console.log(`[${jobId}] Response: ${JSON.stringify(result.body).substring(0, 300)}`);

    if (result.status !== 200) {
      throw new Error(result.body.error?.message || 'OpenAI error ' + result.status);
    }

    const imgData = result.body.data?.[0];
    if (!imgData) throw new Error('No image data in response');

    const imageUrl = imgData.url || (imgData.b64_json ? `data:image/png;base64,${imgData.b64_json}` : null);
    if (!imageUrl) throw new Error('No url or b64_json');

    jobs[jobId].status = 'done';
    jobs[jobId].url = imageUrl;
    console.log(`[${jobId}] Done!`);

  } catch (err) {
    console.error(`[${jobId}] Error: ${err.message}`);
    jobs[jobId].status = 'error';
    jobs[jobId].error = err.message;
  }
}

// POST /generate — odmah vrati job_id, procesiranje u pozadini
app.post('/generate', (req, res) => {
  const { model, gender, age, season } = req.body;
  if (!model) return res.status(400).json({ error: 'Missing model' });

  const jobId = randomUUID();
  jobs[jobId] = { status: 'pending', createdAt: Date.now() };

  // Pokreni u pozadini (ne čekamo)
  processJob(jobId, model, gender, age, season);

  res.json({ jobId });
});

// GET /status/:jobId — provjeri status
app.get('/status/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Čisti stare jobove svakih 10 minuta
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of Object.entries(jobs)) {
    if (now - job.createdAt > 10 * 60 * 1000) delete jobs[id];
  }
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
