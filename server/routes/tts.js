import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { synthesizeAzureMp3, normalizeRate, DEFAULT_VOICE } from '../lib/azureTts.js'
import { CACHE_DIR, ensureDirs } from '../lib/paths.js'

const CACHE_TAG = '48k-192'

export async function ttsHandler(c) {
  const body = await c.req.json()
  const text = (body.text || '').trim()
  if (!text) return c.json({ error: 'text is required' }, 400)

  const rate = normalizeRate(body.rate)
  const voice = body.voice || DEFAULT_VOICE

  ensureDirs()
  const hash = crypto
    .createHash('sha256')
    .update(`${CACHE_TAG}|${voice}|${rate}|${text}`)
    .digest('hex')
    .slice(0, 24)
  const cachePath = path.join(CACHE_DIR, 'tts', `${hash}.mp3`)

  if (fs.existsSync(cachePath)) {
    const buf = fs.readFileSync(cachePath)
    return c.json({
      audioBase64: buf.toString('base64'),
      mimeType: 'audio/mpeg',
      cached: true,
      rate,
      cachePath,
    })
  }

  const buf = await synthesizeAzureMp3({ text, voice, rate })
  fs.writeFileSync(cachePath, buf)

  return c.json({
    audioBase64: buf.toString('base64'),
    mimeType: 'audio/mpeg',
    cached: false,
    rate,
    cachePath,
  })
}
