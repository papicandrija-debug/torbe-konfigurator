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

    // Boje po spolu
    const colors = {
      djevojčica: { cloud: 'plain solid white OR plain solid light lilac', sleepy: 'plain solid mint green OR plain solid white OR plain solid light lilac' },
      dječak:     { cloud: 'plain solid white OR plain solid light blue',  sleepy: 'plain solid mint green OR plain solid light blue OR plain solid white' }
    };
    const colorKey = gender === 'djevojčica' ? 'djevojčica' : 'dječak';
    const color = isNewborn ? colors[colorKey].cloud : colors[colorKey].sleepy;

    // Opisi oblika po modelu
    const shapes = {
      cloud:    'closed cocoon sleep sack with NO legs — bottom is completely sealed like a bag, baby legs inside together. Double zipper down center front. Sleeveless with wide armholes. Soft crinkled muslin fabric.',
      proljece: 'sleep sack with TWO SEPARATE LEG TUBES like pants. Zipper down center front from chest to crotch. Sleeveless, arms completely free. Legs end at ankle with OPEN FEET — bare feet visible. Light double-layer muslin.',
      ljeto:    'sleep sack with TWO SEPARATE LEG TUBES like pants. Zipper down center front. Sleeveless. Legs end at ankle with OPEN FEET — bare feet visible. Ultra-thin single-layer muslin, very lightweight.',
      jesen:    'sleep sack with TWO SEPARATE LEG TUBES like pants. Zipper down center front. Sleeveless. Legs end with CLOSED FEET — integrated foot covers like built-in socks. Medium weight jersey with fleece lining.',
      zima:     'sleep sack with TWO SEPARATE LEG TUBES like pants. Zipper down center front. Sleeveless. Legs end with CLOSED FEET — integrated foot covers like built-in socks. Thick padded quilted fabric, very warm.'
    };
    const shape = shapes[model] || shapes.proljece;

    // Uzorak po modelu — stvarni Mamino uzorci
    const patterns = {
      cloud:    'completely plain solid color fabric, no prints or patterns',
      proljece: 'completely plain solid color fabric, no prints or patterns',
      ljeto:    'completely plain solid color fabric, no prints or patterns',
      jesen:    'white fabric with small brown teddy bear print pattern OR plain white OR plain beige with small star pattern',
      zima:     'white fabric with small brown teddy bear print pattern OR plain white OR plain beige with small star pattern'
    };
    const pattern = patterns[model] || 'plain solid color';

    let prompt;
    if (isNewborn) {
      prompt = `Realistic professional lifestyle photo of a peaceful sleeping newborn baby (${genderWord}) in a white wooden baby crib in a ${roomMood}.
The baby is wearing a baby sleep sack. Color: ${color}. Pattern: ${pattern}. Shape: ${shape}.
Small woven label with text "mamino" sewn on the side seam at the bottom of the sleep sack.
Baby sleeping peacefully, full body visible in crib with white wooden rails. Soft natural light from window. Warm lifestyle photography, shallow depth of field. No other text or logos visible.`;
    } else {
      prompt = `Realistic professional lifestyle photo of a happy smiling ${genderWord} toddler, age ${age}, standing upright in a ${roomMood}.
The child is wearing a toddler sleep sack. Color: ${color}. Pattern: ${pattern}. Shape: ${shape}.
Small woven label with text "mamino" sewn on the outer side seam of the left leg near the ankle.
Child standing smiling, full body visible head to toe, arms slightly out. Warm lifestyle photography, natural light, shallow depth of field. No other text or logos visible.`;
    }


    // Koristi /v1/images/generations s detaljnim promptom (edits ima problem s multipart)
    console.log(`[${jobId}] Sending to OpenAI generations...`);
    
    const bodyStr = JSON.stringify({
      model: 'gpt-image-2',
      prompt: prompt,
      n: 1,
      size: '1024x1024',
      quality: 'medium'
    });

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.openai.com',
        path: '/v1/images/generations',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Length': Buffer.byteLength(bodyStr)
        },
        timeout: 300000
      };

      const apiReq = https.request(options, (apiRes) => {
        let data = '';
        console.log(`[${jobId}] OpenAI HTTP status: ${apiRes.statusCode}`);
        apiRes.on('data', chunk => { data += chunk; });
        apiRes.on('end', () => {
          console.log(`[${jobId}] Response: ${data.substring(0, 400)}`);
          try {
            resolve({ status: apiRes.statusCode, body: JSON.parse(data) });
          } catch (e) {
            reject(new Error('Parse error: ' + data.substring(0, 300)));
          }
        });
      });
      apiReq.on('error', (err) => {
        console.error(`[${jobId}] Error: ${err.message}`);
        reject(err);
      });
      apiReq.on('timeout', () => {
        console.error(`[${jobId}] Timeout!`);
        apiReq.destroy();
        reject(new Error('OpenAI timeout'));
      });
      apiReq.write(bodyStr);
      apiReq.end();
      console.log(`[${jobId}] Request sent...`);
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
