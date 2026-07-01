const express = require('express');
const https = require('https');
const http = require('http');
const app = express();
app.use(express.json());
app.use(express.static('public'));

// Preuzmi sliku s URL-a i vrati kao base64
function fetchImageAsBase64(imageUrl) {
  return new Promise((resolve, reject) => {
    const protocol = imageUrl.startsWith('https') ? https : http;
    protocol.get(imageUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchImageAsBase64(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString('base64');
        const mime = res.headers['content-type'] || 'image/jpeg';
        resolve({ base64, mime });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// OpenAI chat completions s image input (gpt-4o za image reference)
function openAIImageRef(prompt, imageBase64, imageMime) {
  return new Promise((resolve, reject) => {
    const messages = [
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
            text: prompt
          }
        ]
      }
    ];

    const body = JSON.stringify({
      model: 'gpt-image-2',
      prompt: prompt,
      n: 1,
      size: '1024x1024',
      quality: 'medium'
    });

    // Koristimo gpt-image-2 s detaljnim promptom koji opisuje točan izgled
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
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// Opisi vreća za svaki model — jako detaljni
const modelDescriptions = {
  cloud: {
    imageUrl: 'https://mamino.hr/cdn/shop/files/Vreca_za_spavanje_novorodjence.png?v=1768914766',
    shapeDesc: `A baby sleep sack (sleep bag) for newborns. It is a CLOSED COCOON SHAPE with NO legs and NO leg holes — the bottom is completely closed like a bag. The baby's legs are inside the bag together. It has a double zipper running down the CENTER FRONT from top to bottom. The fabric is soft muslin. It is sleeveless with wide armholes. The overall shape is like an egg or cocoon — wider at the bottom, narrower at the top.`
  },
  proljece: {
    imageUrl: 'https://mamino.hr/cdn/shop/files/6.jpg?v=1748352986',
    shapeDesc: `A toddler sleep sack with TWO SEPARATE LEG TUBES (like pants). The legs are separate and the child can walk in it. It has a zipper down the CENTER FRONT from chest to crotch. It is sleeveless — no sleeves, wide armholes, arms completely free. The torso/body part is like a vest. The leg tubes end at the ANKLE with OPEN FEET — bare feet visible. Light, airy double-layer muslin fabric that is slightly crinkled/textured.`
  },
  ljeto: {
    imageUrl: 'https://mamino.hr/cdn/shop/files/MAMINO_2-49.jpg?v=1748352986',
    shapeDesc: `A toddler sleep sack with TWO SEPARATE LEG TUBES (like pants). The legs are separate and the child can walk in it. It has a zipper down the CENTER FRONT from chest to crotch. It is sleeveless — no sleeves, wide armholes, arms completely free. The torso/body part is like a vest. The leg tubes end at the ANKLE with OPEN FEET — bare feet visible. Very thin, ultra-light single layer muslin fabric.`
  },
  jesen: {
    imageUrl: 'https://mamino.hr/cdn/shop/files/mamino_jesen_2025-30.jpg?v=1758780056',
    shapeDesc: `A toddler sleep sack with TWO SEPARATE LEG TUBES (like pants). The legs are separate and the child can walk in it. It has a zipper down the CENTER FRONT from chest to crotch. It is sleeveless — no sleeves, wide armholes, arms completely free. The torso/body part is like a vest. The leg tubes end with CLOSED FEET — integrated foot covers like socks built into the fabric, no bare feet visible. Medium weight jersey fabric with soft inner lining.`
  },
  zima: {
    imageUrl: 'https://mamino.hr/cdn/shop/files/MAMINO_2-53.jpg?v=1768914766',
    shapeDesc: `A toddler sleep sack with TWO SEPARATE LEG TUBES (like pants). The legs are separate and the child can walk in it. It has a zipper down the CENTER FRONT from chest to crotch. It is sleeveless — no sleeves, wide armholes, arms completely free. The torso/body part is like a vest. The leg tubes end with CLOSED FEET — integrated foot covers like socks built into the fabric, no bare feet visible. Thick padded quilted fabric, warm and puffy.`
  }
};

app.post('/generate', async (req, res) => {
  const { prompt, model, gender, age, season } = req.body;
  if (!prompt || !model) return res.status(400).json({ error: 'Missing params' });

  res.setHeader('Connection', 'keep-alive');

  try {
    const modelInfo = modelDescriptions[model];
    const isNewborn = model === 'cloud';

    // Boje po spolu
    const colors = {
      djevojčica: {
        cloud: 'plain solid white OR plain solid light lilac (pale purple)',
        sleepy: 'plain solid mint green OR plain solid white OR plain solid light lilac'
      },
      dječak: {
        cloud: 'plain solid white OR plain solid light blue',
        sleepy: 'plain solid mint green OR plain solid light blue OR plain solid white'
      }
    };

    const colorChoice = gender === 'djevojčica'
      ? (isNewborn ? colors.djevojčica.cloud : colors.djevojčica.sleepy)
      : (isNewborn ? colors.dječak.cloud : colors.dječak.sleepy);

    const roomMood = {
      proljeće: 'bright airy Scandinavian nursery with soft morning light, white furniture',
      ljeto: 'bright sunny nursery with light linen curtains and natural daylight',
      jesen: 'cozy warm nursery with warm lamp light, wooden accents',
      zima: 'cozy warm nursery with soft lamp light, knit blankets in background'
    }[season] || 'cozy Scandinavian nursery';

    let finalPrompt;
    if (isNewborn) {
      finalPrompt = `Realistic professional lifestyle photo of a peaceful sleeping newborn baby (${gender === 'djevojčica' ? 'girl' : 'boy'}) lying in a white wooden baby crib in a ${roomMood}.

The baby is wearing a MAMINO CLOUD™ BABY SLEEP SACK. The sleep sack shape:
${modelInfo.shapeDesc}

Color of the sleep sack: ${colorChoice}. The fabric is PLAIN SOLID COLOR with absolutely zero prints, zero patterns, zero decorations, zero motifs on the fabric — completely plain like a solid colored bedsheet.

On the sleep sack there is a small woven fabric label/tag sewn on the front lower area that reads "mamino" in lowercase cursive script — small and subtle.

The baby is sleeping peacefully, full body visible in the crib. White wooden crib rails visible. Soft natural light from window. Warm, soft lifestyle photography style, shallow depth of field.`;
    } else {
      finalPrompt = `Realistic professional lifestyle photo of a happy smiling ${gender === 'djevojčica' ? 'girl' : 'boy'} toddler, age ${age}, standing upright in a ${roomMood}.

The child is wearing a MAMINO SLEEPY™ SLEEP SACK. The sleep sack shape:
${modelInfo.shapeDesc}

Color of the sleep sack: ${colorChoice}. The fabric is PLAIN SOLID COLOR with absolutely zero prints, zero patterns, zero decorations, zero motifs on the fabric — completely plain like a solid colored garment.

On the sleep sack there is a small woven fabric label/tag sewn on the front chest area that reads "mamino" in lowercase cursive script — small and subtle.

The child stands smiling, full body visible from head to toe, arms slightly out to the sides. Warm lifestyle photography style, natural light, shallow depth of field.`;
    }

    console.log('Generating for model:', model, 'gender:', gender);
    const { status, body } = await openAIImageRef(finalPrompt, null, null);
    console.log('OpenAI status:', status);
    console.log('Response:', JSON.stringify(body).substring(0, 300));

    if (status !== 200) {
      return res.status(status).json({ error: body.error?.message || 'OpenAI error' });
    }

    if (!body.data || !body.data[0]) {
      return res.status(500).json({ error: 'No image in response: ' + JSON.stringify(body).substring(0, 200) });
    }

    const imgData = body.data[0];
    if (imgData.url) return res.json({ url: imgData.url });
    if (imgData.b64_json) return res.json({ url: `data:image/png;base64,${imgData.b64_json}` });

    return res.status(500).json({ error: 'No url or b64_json in response' });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
server.timeout = 300000;
server.keepAliveTimeout = 300000;
