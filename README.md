# Mandarin Video Generator

Monorepo with three apps joined by a package folder contract:

| App | Route | Role |
|-----|-------|------|
| **HSK Generator** | `/hsk` | Templates + set generation → `output/{templateId}/Set_N/` |
| **Grammar Generator** | `/grammar` | One-off packages → `output/grammar/{slug}/` (no publish datetime) |
| **YouTube Scheduler** | `/scheduler` | Owns `data/catalog.json`, import packages, calendar, queue/weekly upload, reschedule, push meta to YouTube |

**Stack:** Vite + React · Hono API · Azure Neural TTS · `@napi-rs/canvas` · FFmpeg · YouTube Data API

## Prerequisites

- Node.js 20+
- FFmpeg on `PATH`
- Azure Speech key in `.env` (generators)
- For uploads: Desktop OAuth `client_secret.json` in the project root (token saved to `data/youtube-token.json`) — scheduler only

## Setup

```bash
npm install
copy .env.example .env
```

```env
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=eastus
```

## Run

```powershell
npm.cmd run dev
```

- Hub: http://127.0.0.1:5173  
- Apps: `/hsk`, `/grammar`, `/scheduler`  
- API: http://127.0.0.1:8787  

Per-app scripts: `npm run dev:hsk` · `npm run dev:grammar` · `npm run dev:scheduler`

### Layout

```
apps/hsk-generator/
apps/grammar-generator/
apps/youtube-scheduler/
packages/shared/          # package contract helpers, playlist id
server/routes/hsk.js | grammar.js | scheduler.js
```

### Package contract

Each finished video folder contains at least `video.mp4` + `meta.json` (optional thumbnail / SRT / youtube.txt). Scheduler **Import packages** scans `output/` and adds missing rows as `ready`.

## Weekly YouTube upload

Uploads at most **5 videos per Pacific calendar day**, with a **5-minute pause** between inserts. Only `queued` videos (slots assigned in the scheduler) are uploaded.

```bash
npm run scheduler:weekly-upload
# alias: npm run studio:weekly-upload
```

### Windows Task Scheduler

1. Create a Basic Task → trigger **Weekly** (e.g. Monday 9:00 AM)
2. Action: Start a program  
   - Program: full path to `node.exe`  
   - Arguments: `scripts/weeklyUpload.mjs`  
   - Start in: this project folder  

Prefer `node.exe` over `npm.cmd run …` so the task exits cleanly.

## Data layout

| Path | Role |
|------|------|
| `data/catalog.json` | Scheduler source of truth |
| `data/templates/{id}/` | HSK template assets |
| `output/{templateId}/Set_N/` | HSK packages |
| `output/grammar/{slug}/` | Grammar packages |
| `cache/tts/` | TTS cache |
| `.tmp/render/` | FFmpeg work dirs |
