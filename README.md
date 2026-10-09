# BhashaTranscribe + server Whisper

    cd server
    npm install
    cp .env.example .env      # add STT_API_KEY (OpenAI or Groq)
    node --env-file=.env server.js
    # open http://localhost:3000  (HTTPS required in production for mic/PWA)

- `public/`  → the PWA (index.html, sw.js, manifest.json; add your /icons folder)
- `server/`  → Express proxy: POST /api/transcribe (field `audio`, optional `language`, `prompt`), GET /api/health
- Hosting the PWA elsewhere? Set `API_BASE` in index.html and `CORS_ORIGINS` in .env.
