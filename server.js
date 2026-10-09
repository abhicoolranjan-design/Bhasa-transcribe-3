// BhashaTranscribe — server-side STT proxy (Whisper-compatible APIs)
// Keeps the API key on the server, serves the PWA from ../public.
// Run:  cd server && npm i && cp .env.example .env && node --env-file=.env server.js

const express = require('express');
const multer = require('multer');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.STT_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const API_KEY = process.env.STT_API_KEY || '';
const MODEL = process.env.STT_MODEL || 'whisper-1';
const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || '25', 10);
const APP_TOKEN = process.env.APP_TOKEN || '';
const ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// Languages Whisper accepts (ISO-639-1 / 639-3 where noted). Anything else -> auto-detect.
const WHISPER_LANGS = new Set(['en','hi','bn','ta','te','mr','gu','kn','ml','pa','ur','ne','as','sa']);

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024 } });

// Minimal CORS (only needed when the PWA is not served by this server)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-app-token');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function auth(req, res, next) {
  if (APP_TOKEN && req.headers['x-app-token'] !== APP_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/health', (req, res) => {
  res.json({ stt: !!API_KEY, model: MODEL, maxMb: MAX_MB });
});

app.post('/api/transcribe', auth, upload.single('audio'), async (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'STT not configured on server' });
  if (!req.file) return res.status(400).json({ error: 'No audio file (field name: audio)' });

  try {
    const lang = String(req.body.language || '').split('-')[0].toLowerCase();
    const prompt = String(req.body.prompt || '').slice(0, 800);

    const form = new FormData();
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }),
                req.file.originalname || 'audio.webm');
    form.append('model', MODEL);
    form.append('response_format', 'verbose_json'); // gives segments + timestamps (whisper-1 / groq)
    form.append('temperature', '0');
    if (WHISPER_LANGS.has(lang)) form.append('language', lang);
    if (prompt) form.append('prompt', prompt); // custom vocabulary biases spelling

    let r = await fetch(BASE_URL + '/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + API_KEY },
      body: form
    });

    // gpt-4o-* transcribe models only support json/text — retry plain if verbose_json is rejected
    if (r.status === 400) {
      const form2 = new FormData();
      form2.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }),
                   req.file.originalname || 'audio.webm');
      form2.append('model', MODEL);
      form2.append('response_format', 'json');
      if (WHISPER_LANGS.has(lang)) form2.append('language', lang);
      if (prompt) form2.append('prompt', prompt);
      r = await fetch(BASE_URL + '/audio/transcriptions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + API_KEY }, body: form2
      });
    }

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({ error: (data.error && data.error.message) || 'Upstream STT error' });
    }
    res.json({
      text: (data.text || '').trim(),
      language: data.language || lang || null,
      duration: data.duration || null,
      segments: (data.segments || []).map(s => ({ start: s.start, end: s.end, text: (s.text || '').trim() }))
    });
  } catch (e) {
    console.error('transcribe failed:', e);
    res.status(502).json({ error: 'Transcription failed: ' + e.message });
  }
});

// Multer errors (file too large etc.)
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max ' + MAX_MB + ' MB). Trim or compress it first.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.listen(PORT, () => console.log('BhashaTranscribe on http://localhost:' + PORT + ' | STT ' + (API_KEY ? 'ON (' + MODEL + ')' : 'OFF (no STT_API_KEY)')));
