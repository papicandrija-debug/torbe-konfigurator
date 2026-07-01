const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());
app.use(express.static('public'));

app.post('/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  // Produlji timeout na 3 minute (180s) za AI generiranje
  req.setTimeout(180000);
  res.setTimeout(180000);

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium'
      }),
      timeout: 170000  // 170 sekundi timeout za fetch
    });

    const data = await response.json();
    console.log('OpenAI response status:', response.status);
    console.log('OpenAI data:', JSON.stringify(data).substring(0, 300));

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'OpenAI error' });
    }

    const imgData = data.data[0];
    const url = imgData.url || `data:image/png;base64,${imgData.b64_json}`;
    res.json({ url });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Globalni server timeout — 3 minute
server.setTimeout(180000);
