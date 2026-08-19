import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import fs from 'node:fs'
import path from 'node:path'
import { ensureDirs, OUTPUT_DIR } from './lib/paths.js'
import { ttsHandler } from './routes/tts.js'
import { listeningRenderHandler } from './routes/listening.js'
import { bootstrapStudio } from './lib/templates.js'
import { maybeCatchUpWeeklyUpload } from './lib/weeklyUpload.js'
import {
  hskBootstrapHandler,
  listTemplatesHandler,
  getTemplateHandler,
  createTemplateHandler,
  updateTemplateHandler,
  uploadTemplateAssetHandler,
  enqueueGenerateHandler,
  hskQueueStatusHandler,
} from './routes/hsk.js'
import { enqueueOneOffHandler, grammarQueueStatusHandler } from './routes/grammar.js'
import {
  listVideosHandler,
  getVideoHandler,
  patchVideoHandler,
  importPackagesHandler,
  queueUploadsHandler,
  weeklyUploadHandler,
  pushMetaHandler,
  schedulerQueueStatusHandler,
  schedulerBootstrapHandler,
  quotaHandler,
} from './routes/scheduler.js'
import {
  studioBootstrapHandler,
  queueStatusHandler,
} from './routes/studio.js'

ensureDirs()
bootstrapStudio()

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

app.post('/api/tts', (c) => wrap(ttsHandler, c))
app.post('/api/listening/render', (c) => wrap(listeningRenderHandler, c))

// --- HSK generator ---
app.get('/api/hsk/bootstrap', (c) => wrap(hskBootstrapHandler, c))
app.get('/api/hsk/templates', (c) => wrap(listTemplatesHandler, c))
app.get('/api/hsk/templates/:id', (c) => wrap(getTemplateHandler, c))
app.post('/api/hsk/templates', (c) => wrap(createTemplateHandler, c))
app.put('/api/hsk/templates/:id', (c) => wrap(updateTemplateHandler, c))
app.post('/api/hsk/templates/:id/assets/:kind', (c) => wrap(uploadTemplateAssetHandler, c))
app.post('/api/hsk/generate', (c) => wrap(enqueueGenerateHandler, c))
app.get('/api/hsk/queue', (c) => wrap(hskQueueStatusHandler, c))

// --- Grammar generator ---
app.post('/api/grammar/one-off', (c) => wrap(enqueueOneOffHandler, c))
app.get('/api/grammar/queue', (c) => wrap(grammarQueueStatusHandler, c))

// --- YouTube scheduler ---
app.get('/api/scheduler/bootstrap', (c) => wrap(schedulerBootstrapHandler, c))
app.get('/api/scheduler/videos', (c) => wrap(listVideosHandler, c))
app.get('/api/scheduler/videos/:id', (c) => wrap(getVideoHandler, c))
app.patch('/api/scheduler/videos/:id', (c) => wrap(patchVideoHandler, c))
app.post('/api/scheduler/import-packages', (c) => wrap(importPackagesHandler, c))
app.post('/api/scheduler/queue-uploads', (c) => wrap(queueUploadsHandler, c))
app.post('/api/scheduler/weekly-upload', (c) => wrap(weeklyUploadHandler, c))
app.post('/api/scheduler/videos/:id/push-meta', (c) => wrap(pushMetaHandler, c))
app.get('/api/scheduler/queue', (c) => wrap(schedulerQueueStatusHandler, c))
app.get('/api/scheduler/quota', (c) => wrap(quotaHandler, c))

// --- Legacy /api/studio/* aliases ---
app.get('/api/studio/bootstrap', (c) => wrap(studioBootstrapHandler, c))
app.get('/api/studio/templates', (c) => wrap(listTemplatesHandler, c))
app.get('/api/studio/templates/:id', (c) => wrap(getTemplateHandler, c))
app.post('/api/studio/templates', (c) => wrap(createTemplateHandler, c))
app.put('/api/studio/templates/:id', (c) => wrap(updateTemplateHandler, c))
app.post('/api/studio/templates/:id/assets/:kind', (c) => wrap(uploadTemplateAssetHandler, c))
app.get('/api/studio/videos', (c) => wrap(listVideosHandler, c))
app.get('/api/studio/videos/:id', (c) => wrap(getVideoHandler, c))
app.patch('/api/studio/videos/:id', (c) => wrap(patchVideoHandler, c))
app.post('/api/studio/generate', (c) => wrap(enqueueGenerateHandler, c))
app.post('/api/studio/one-off', (c) => wrap(enqueueOneOffHandler, c))
app.get('/api/studio/queue', (c) => wrap(queueStatusHandler, c))
app.post('/api/studio/queue-uploads', (c) => wrap(queueUploadsHandler, c))
app.post('/api/studio/weekly-upload', (c) => wrap(weeklyUploadHandler, c))
app.post('/api/studio/import-packages', (c) => wrap(importPackagesHandler, c))
app.post('/api/studio/videos/:id/push-meta', (c) => wrap(pushMetaHandler, c))

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

setTimeout(() => {
  maybeCatchUpWeeklyUpload().catch((err) => {
    console.error('[weekly-upload catch-up]', err.message || err)
  })
}, 2500)
