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
      timeout: 240000 // 4 minute
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
      reject(new Error('Request timeout after 4 minutes'));
    });

    req.write(body);
    req.end();
  });
}

app.post('/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  // Keep connection alive
  res.setHeader('Connection', 'keep-alive');

  try {
    console.log('Starting image generation...');
    const { status, body } = await openAIRequest(prompt);
    console.log('OpenAI status:', status);
    console.log('OpenAI response:', JSON.stringify(body).substring(0, 300));

    if (status !== 200) {
      return res.status(status).json({ error: body.error?.message || 'OpenAI error' });
    }

    const imgData = body.data[0];
    const url = imgData.url || `data:image/png;base64,${imgData.b64_json}`;
    res.json({ url });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
server.timeout = 300000; // 5 minuta
server.keepAliveTimeout = 300000;
