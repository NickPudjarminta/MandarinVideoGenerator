import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import fs from 'node:fs'
import path from 'node:path'
import { ensureDirs, OUTPUT_DIR } from './lib/paths.js'
import { ideasHandler } from './routes/ideas.js'
import { generateScriptHandler } from './routes/generate-script.js'
import { searchHandler } from './routes/search.js'
import { ttsHandler } from './routes/tts.js'
import { youtubeMetaHandler } from './routes/youtube-meta.js'
import { renderHandler } from './routes/render.js'
import { fetchImageHandler } from './routes/fetch-image.js'
import { styleImageHandler } from './routes/style-image.js'
import { keyNounsHandler } from './routes/key-nouns.js'
import { workbookHandler } from './routes/workbook.js'
import {
  listeningSentencesHandler,
  listeningRenderHandler,
  listeningMetaHandler,
} from './routes/listening.js'
import { ensureBumperAudioHandler } from './lib/ensureBumperAudio.js'
import {
  listSessionsHandler,
  getSessionHandler,
  getSessionFileHandler,
  saveSessionHandler,
} from './routes/sessions.js'

ensureDirs()

const app = new Hono()

app.use('*', cors())

app.get('/api/health', (c) => c.json({ ok: true }))

async function wrap(handler, c) {
  try {
    return await handler(c)
  } catch (err) {
    if (err?.name === 'AbortError' || c.req.raw?.signal?.aborted) {
      return c.json({ error: 'Request cancelled' }, 499)
    }
    console.error(err)
    return c.json({ error: err.message || String(err) }, 500)
  }
}

app.post('/api/ideas', (c) => wrap(ideasHandler, c))
app.post('/api/generate-script', (c) => wrap(generateScriptHandler, c))
app.post('/api/search', (c) => wrap(searchHandler, c))
app.post('/api/tts', (c) => wrap(ttsHandler, c))
app.post('/api/youtube-meta', (c) => wrap(youtubeMetaHandler, c))
app.post('/api/render', (c) => wrap(renderHandler, c))
app.post('/api/fetch-image', (c) => wrap(fetchImageHandler, c))
app.post('/api/style-image', (c) => wrap(styleImageHandler, c))
app.post('/api/key-nouns', (c) => wrap(keyNounsHandler, c))
app.post('/api/workbook', (c) => wrap(workbookHandler, c))
app.post('/api/listening/sentences', (c) => wrap(listeningSentencesHandler, c))
app.post('/api/listening/render', (c) => wrap(listeningRenderHandler, c))
app.post('/api/listening/meta', (c) => wrap(listeningMetaHandler, c))
app.post('/api/ensure-bumper-audio', (c) => wrap(ensureBumperAudioHandler, c))
app.get('/api/sessions', (c) => wrap(listSessionsHandler, c))
app.get('/api/sessions/:id', (c) => wrap(getSessionHandler, c))
app.get('/api/sessions/:id/files/:name', (c) => wrap(getSessionFileHandler, c))
app.post('/api/sessions', (c) => wrap(saveSessionHandler, c))

app.get('/output/:name', (c) => {
  const name = path.basename(c.req.param('name'))
  const filePath = path.join(OUTPUT_DIR, name)
  if (!fs.existsSync(filePath)) return c.json({ error: 'Not found' }, 404)
  const buf = fs.readFileSync(filePath)
  const lower = name.toLowerCase()
  const isPdf = lower.endsWith('.pdf')
  const isSrt = lower.endsWith('.srt')
  const contentType = isPdf
    ? 'application/pdf'
    : isSrt
      ? 'application/x-subrip; charset=utf-8'
      : 'video/mp4'
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'Content-Disposition': `${isPdf || isSrt ? 'attachment' : 'inline'}; filename="${name}"`,
    },
  })
})

const port = Number(process.env.PORT || 8787)
console.log(`API listening on http://127.0.0.1:${port}`)
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })
