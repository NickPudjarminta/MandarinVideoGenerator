# Mandarin Listening Studio

Local studio for HSK listening-practice videos: **templates**, **bulk generate queue**, and a **calendar** backed by one catalog (`data/catalog.json`).

**Stack:** Vite + React · Hono API · Azure Neural TTS · `@napi-rs/canvas` · FFmpeg · YouTube Data API

## Prerequisites

- Node.js 20+
- FFmpeg on `PATH`
- Azure Speech key in `.env`
- For uploads: Desktop OAuth `client_secret.json` in the project root (token saved to `data/youtube-token.json`)

## Setup

```bash
npm install
copy .env.example .env
```

```env
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=eastus
```

## Run UI

```powershell
npm.cmd run dev
```

- Web: http://127.0.0.1:5173  
- API: http://127.0.0.1:8787  

### Studio tabs

1. **Templates** — Create/edit templates (spreadsheet, images, title/description templates with `{{setIndex}}`, `{{firstWord}}`, `{{lastWord}}`, `{{playlistUrl}}`)
2. **Queue** — Generate all sets (or missing only); **Queue YouTube uploads** assigns Mon–Fri noon slots to all ready videos (no API upload yet)
3. **Calendar** — Shows **queued for upload** / **scheduled** / **published** from `publishAt` + whether a YouTube `videoId` exists

## Weekly YouTube upload

Uploads at most **5 videos per Pacific calendar day**, with a **5-minute pause** between each YouTube insert (avoids API spam). Only videos with status `queued` (slots already assigned) are uploaded.

```bash
npm run studio:weekly-upload
```

On API startup, if the last weekly run is older than ~7 days (or never), the same job runs as catch-up (still subject to the daily limit).

### Windows Task Scheduler

1. Create a Basic Task → trigger **Weekly** (e.g. Monday 9:00 AM)
2. Action: Start a program  
   - Program: full path to `node.exe` (e.g. `C:\Program Files\nodejs\node.exe`)  
   - Arguments: `scripts/weeklyUpload.mjs`  
   - Start in: this project folder  

Prefer `node.exe` over `npm.cmd run …` so the task exits cleanly when uploads finish (Task Scheduler stays “Running” until the process exits).

## Data layout

| Path | Role |
|------|------|
| `data/catalog.json` | **Source of truth** for all videos/schedule |
| `data/templates/{id}/` | `template.json`, `spreadsheet.xlsx`, `assets/` |
| `output/{templateId}/Set_N/` | Generated packages |
| `cache/tts/` | TTS cache |
| `.tmp/render/` | FFmpeg work dirs |

## Legacy CLI

Older autopilot commands still exist (`autopilot:generate`, etc.) but the Studio UI + catalog is the primary workflow going forward.
