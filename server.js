const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.json());
app.use(express.static('public'));

app.post('/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  console.log('API KEY exists:', !!process.env.OPENAI_API_KEY);
  console.log('Prompt:', prompt.substring(0, 50));

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
body: JSON.stringify({
  prompt: prompt,
  n: 1,
  size: '256x256'
})
    });

    const data = await response.json();
    console.log('OpenAI response:', JSON.stringify(data).substring(0, 200));

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'OpenAI error' });
    }

    res.json({ url: data.data[0].url });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
