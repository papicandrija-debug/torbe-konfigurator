const express = require('express');
const https = require('https');
const app = express();
app.use(express.json());
app.use(express.static('public'));

function openAIRequest(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-image-2',
      prompt: prompt,
      n: 1,
      size: '1024x1024',
      quality: 'low'
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
          reject(new Error('Failed to parse response: ' + data.substring(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(body);
    req.end();
  });
}

app.post('/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  res.setHeader('Connection', 'keep-alive');

  try {
    console.log('Starting image generation...');
    const { status, body } = await openAIRequest(prompt);
    console.log('OpenAI status:', status);
    console.log('OpenAI full response:', JSON.stringify(body).substring(0, 500));

    if (status !== 200) {
      return res.status(status).json({ error: body.error?.message || 'OpenAI error' });
    }

    if (!body.data || !body.data[0]) {
      return res.status(500).json({ error: 'OpenAI nije vratio sliku. Response: ' + JSON.stringify(body).substring(0, 200) });
    }

    const imgData = body.data[0];
    console.log('Image data keys:', Object.keys(imgData));

    // Provjeri url ili b64_json
    if (imgData.url) {
      return res.json({ url: imgData.url });
    } else if (imgData.b64_json) {
      return res.json({ url: `data:image/png;base64,${imgData.b64_json}` });
    } else {
      return res.status(500).json({ error: 'Nema url ni b64_json u odgovoru: ' + JSON.stringify(imgData).substring(0, 200) });
    }

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
server.timeout = 300000;
server.keepAliveTimeout = 300000;
