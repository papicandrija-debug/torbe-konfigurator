const express = require('express');
const https = require('https');
const http = require('http');

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

const modelImages = {
  cloud:    'https://mamino.hr/cdn/shop/files/Vreca_za_spavanje_novorodjence.png?v=1768914766',
  proljece: 'https://mamino.hr/cdn/shop/files/Mamino_white_product_photos_2_1.jpg?v=1754995072',
  ljeto:    'https://mamino.hr/cdn/shop/files/MAMINO_2-49.jpg?v=1748352986',
  jesen:    'https://mamino.hr/cdn/shop/files/mamino_jesen_2025-30.jpg?v=1758780056',
  zima:     'https://mamino.hr/cdn/shop/files/MAMINO_2-53.jpg?v=1768914766'
};

function buildPrompt(model, gender, age, season) {
  const isNewborn = model === 'cloud';
  const genderWord = gender === 'djevojčica' ? 'girl' : 'boy';

  const roomMood = {
    proljeće: 'bright airy Scandinavian nursery, soft natural morning light, white wooden furniture',
    ljeto: 'bright sunny nursery room, light linen curtains, warm daylight',
    jesen: 'cozy warm nursery, warm lamp light, wooden accents',
    zima: 'cozy warm nursery, soft lamp light, winter atmosphere'
  }[season] || 'cozy Scandinavian nursery with soft natural light';

  const colors = {
    djevojčica: { cloud: 'plain solid white OR plain solid light lilac', sleepy: 'plain solid mint green OR plain solid white OR plain solid light lilac' },
    dječak:     { cloud: 'plain solid white OR plain solid light blue',  sleepy: 'plain solid mint green OR plain solid light blue OR plain solid white' }
  };
  const colorKey = gender === 'djevojčica' ? 'djevojčica' : 'dječak';
  const color = isNewborn ? colors[colorKey].cloud : colors[colorKey].sleepy;

  const shapes = {
    cloud:    'closed cocoon sleep sack with NO legs — bottom completely sealed. Double zipper down center front. Sleeveless. Soft crinkled muslin.',
    proljece: 'sleep sack with TWO SEPARATE LEG TUBES. Zipper down center front. Sleeveless. OPEN FEET — bare feet visible. Light double-layer muslin.',
    ljeto:    'sleep sack with TWO SEPARATE LEG TUBES. Zipper down center front. Sleeveless. OPEN FEET — bare feet visible. Ultra-thin single-layer muslin.',
    jesen:    'sleep sack with TWO SEPARATE LEG TUBES. Zipper down center front. Sleeveless. CLOSED FEET — integrated foot covers like socks. Medium weight jersey with fleece lining.',
    zima:     'sleep sack with TWO SEPARATE LEG TUBES. Zipper down center front. Sleeveless. CLOSED FEET — integrated foot covers like socks. Thick padded quilted fabric.'
  };

  const patterns = {
    cloud:    'completely plain solid color, no prints',
    proljece: 'completely plain solid color, no prints',
    ljeto:    'completely plain solid color, no prints',
    jesen:    'white fabric with small brown teddy bear print OR plain white',
    zima:     'white fabric with small brown teddy bear print OR plain white'
  };

  if (isNewborn) {
    return `Realistic professional lifestyle photo of a peaceful sleeping newborn baby (${genderWord}) in a white wooden baby crib in a ${roomMood}.
Baby wearing a sleep sack. Color: ${color}. Pattern: ${patterns[model]}. Shape: ${shapes[model]}.
Small woven "mamino" label sewn on side seam at bottom of sleep sack.
Baby sleeping peacefully, full body visible, white wooden crib rails. Soft natural light. Warm lifestyle photography, shallow depth of field. No other text or logos.`;
  } else {
    return `Realistic professional lifestyle photo of a happy smiling ${genderWord} toddler, age ${age}, standing upright in a ${roomMood}.
Child wearing a toddler sleep sack. Color: ${color}. Pattern: ${patterns[model]}. Shape: ${shapes[model]}.
Small woven "mamino" label on outer side seam of left leg near ankle.
Child standing smiling, full body visible head to toe, arms slightly out. Warm lifestyle photography, natural light, shallow depth of field. No other text or logos.`;
  }
}

function callOpenAI(prompt) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({
      model: 'gpt-image-2',
      prompt,
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
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      console.log('OpenAI status:', res.statusCode);
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log('OpenAI response:', data.substring(0, 300));
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error('Parse error: ' + data.substring(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// SSE endpoint — drži konekciju otvorenom dok AI generira
app.get('/generate-stream', async (req, res) => {
  const { model, gender, age, season } = req.query;

  // Postavi SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Ping svakih 20 sekundi da Railway ne zatvori konekciju
  const ping = setInterval(() => {
    res.write(': ping\n\n');
  }, 20000);

  try {
    send('status', { message: 'Dohvaćam sliku proizvoda...' });
    console.log('Fetching product image:', model);
    await fetchImageBuffer(modelImages[model]);
    console.log('Product image fetched');

    send('status', { message: 'AI generira sliku...' });
    const prompt = buildPrompt(model, gender, age, season);
    console.log('Calling OpenAI...');

    const result = await callOpenAI(prompt);

    if (result.status !== 200) {
      throw new Error(result.body.error?.message || 'OpenAI error ' + result.status);
    }

    const imgData = result.body.data?.[0];
    if (!imgData) throw new Error('No image data');

    const imageUrl = imgData.url || (imgData.b64_json ? `data:image/png;base64,${imgData.b64_json}` : null);
    if (!imageUrl) throw new Error('No url or b64_json');

    send('done', { url: imageUrl });
    console.log('Done!');

  } catch (err) {
    console.error('Error:', err.message);
    send('error', { message: err.message });
  } finally {
    clearInterval(ping);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
server.timeout = 0; // bez timeoutra na serveru
