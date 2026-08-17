# Mandarin Listening Practice Generator

Local studio for HSK listening-practice videos (speed drills at 70% → 85% → 100%) plus an HSK 1 autopilot that packages sets and uploads to YouTube.

**Stack:** Vite + React UI · Node (Hono) API · Azure Neural TTS · `@napi-rs/canvas` overlays · native FFmpeg · Google YouTube API (autopilot).

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [FFmpeg](https://ffmpeg.org/) on your `PATH` (`ffmpeg -version`)
- Azure Speech API key
- For YouTube upload: Desktop OAuth `client_secret.json` in the project root

## Setup

```bash
npm install
copy .env.example .env   # Windows
# then edit .env with real keys
```

`.env` keys:

```env
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=eastus
```

## Run UI

```powershell
npm.cmd run dev
```

- Web UI: http://127.0.0.1:5173
- API: http://127.0.0.1:8787

## HSK 1 Autopilot

Source spreadsheet: `public/hsk1_vocabulary_sentences.xlsx` (300 rows → 15 sets of 20).

```bash
npm run autopilot:generate [N]      # Generate set N (default: nextSetIndex)
npm run autopilot:regenerate [N]    # Wipe package + render cache, then regenerate
npm run autopilot:upload [N]        # Upload set N to YouTube
npm run autopilot [N]               # Generate (if needed) then upload
npm run autopilot:update-meta       # Refresh titles/thumbnails for all uploaded sets
```

Packages land in `output/HSK1_Set_N/`. Autopilot ledger: `data/autopilot-state.json`.

## Notes

- TTS cache: `cache/tts/` (kept across regenerate)
- Render work dirs: `.tmp/render/`
- Secrets stay in `.env` / `client_secret.json` / `data/youtube-token.json` (gitignored)
