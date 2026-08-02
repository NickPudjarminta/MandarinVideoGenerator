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
import { listeningRenderHandler } from './routes/listening.js'
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
app.post('/api/listening/render', (c) => wrap(listeningRenderHandler, c))
app.post('/api/ensure-bumper-audio', (c) => wrap(ensureBumperAudioHandler, c))
app.get('/api/sessions', (c) => wrap(listSessionsHandler, c))
app.get('/api/sessions/:id', (c) => wrap(getSessionHandler, c))
app.get('/api/sessions/:id/files/:name', (c) => wrap(getSessionFileHandler, c))
app.post('/api/sessions', (c) => wrap(saveSessionHandler, c))

app.get('/output/*', (c) => {
  const rel = decodeURIComponent(c.req.path.replace(/^\/output\//, ''))
  if (!rel || rel.includes('..')) return c.json({ error: 'Not found' }, 404)
  const filePath = path.resolve(OUTPUT_DIR, rel)
  if (!filePath.startsWith(path.resolve(OUTPUT_DIR) + path.sep) && filePath !== path.resolve(OUTPUT_DIR)) {
    return c.json({ error: 'Not found' }, 404)
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return c.json({ error: 'Not found' }, 404)
  }
  const buf = fs.readFileSync(filePath)
  const base = path.basename(filePath)
  const lower = base.toLowerCase()
  let contentType = 'application/octet-stream'
  if (lower.endsWith('.pdf')) contentType = 'application/pdf'
  else if (lower.endsWith('.srt')) contentType = 'application/x-subrip; charset=utf-8'
  else if (lower.endsWith('.mp4')) contentType = 'video/mp4'
  else if (lower.endsWith('.png')) contentType = 'image/png'
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) contentType = 'image/jpeg'
  else if (lower.endsWith('.txt')) contentType = 'text/plain; charset=utf-8'
  const asAttachment = lower.endsWith('.pdf') || lower.endsWith('.srt') || lower.endsWith('.txt')
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buf.length),
      'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename="${base}"`,
    },
  })
})

const port = Number(process.env.PORT || 8787)
console.log(`API listening on http://127.0.0.1:${port}`)
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })
