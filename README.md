# Mandarin Tech News Video Generator

Local human-in-the-loop studio that turns AI/tech news concepts into ~60s TikTok-style **9:16 (720×1280)** Mandarin-learning videos (HSK 3 base).

**Stack:** Vite + React UI · Node (Hono) API · Gemini · Serper.dev · Azure Neural TTS · native FFmpeg on your machine.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [FFmpeg](https://ffmpeg.org/) on your `PATH` (`ffmpeg -version`)
- API keys:
  - Google Gemini
  - Brave Search (recent articles for ideation)
  - Serper.dev
  - Azure Speech (Neural TTS)

## Setup

```bash
npm install
copy .env.example .env   # Windows
# then edit .env with real keys
```

`.env` keys:

```env
GEMINI_API_KEY=...
BRAVE_API_KEY=...
SERPER_API_KEY=...
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=eastus
```

## Run

```powershell
npm.cmd run dev
```

If PowerShell blocks `npm` (`npm.ps1` execution policy), use `npm.cmd` as above, or allow scripts once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

- Web UI: http://127.0.0.1:5173  
- API: http://127.0.0.1:8787  

## Wizard flow

1. **Ideas** — Brave Search pulls recent articles, then Gemini proposes 5 grounded concepts (editable prompt + search query)
2. **Script** — English draft + HSK 3 Mandarin panes (separate editable prompts)
3. **Assets** — Azure TTS per beat + Serper HD portrait images (editable image-query prompt)
4. **Style** — Gemini image edit restyles each beat from a text style prompt (watercolor / ink wash)
5. **Subtitles** — TikTok-style plate preview (font, colors, opacity, radius)
6. **Render** — native FFmpeg Ken Burns zoom + canvas subtitle overlays
7. **Export** — download MP4 + YouTube title/description JSON (editable prompt)

Every Gemini call exposes its prompt in the UI with **Reset default** and **Run / Rerun**.

Edit default prompts anytime in [`public/prompts.json`](public/prompts.json), then refresh the app.

## Notes

- Export is **720×1280** vertical; image search prefers HD portrait (≥720×1280).
- Outputs land in `output/`; TTS/image caches in `cache/`.
- Fonts for preview/render live in `public/fonts/` (Roboto) + system CJK faces.
- Secrets stay server-side in `.env` (gitignored).
