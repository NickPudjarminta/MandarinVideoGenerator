import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { requireEnv } from '../lib/env.js'
import { CACHE_DIR, ensureDirs } from '../lib/paths.js'

/** High-quality Azure output — avoid 16kHz which sounds muffled. */
const OUTPUT_FORMAT = 'audio-48khz-192kbitrate-mono-mp3'
const CACHE_TAG = '48k-192'

/** Normalize rate for SSML + cache key. Accepts "-10%", "0.9", "slow", etc. */
function normalizeRate(raw) {
  if (raw == null || raw === '') return 'default'
  const s = String(raw).trim()
  if (!s || s === '1' || s === '1.0' || s === '+0%' || s === '0%' || s === 'default' || s === 'medium') {
    return 'default'
  }
  return s
}

export async function ttsHandler(c) {
  const body = await c.req.json()
  const text = (body.text || '').trim()
  if (!text) return c.json({ error: 'text is required' }, 400)

  const rate = normalizeRate(body.rate)
  const voice = body.voice || 'zh-CN-XiaochenNeural'

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

  const key = requireEnv('AZURE_SPEECH_KEY')
  const region = requireEnv('AZURE_SPEECH_REGION')
  const safeText = escapeXml(text)

  const spoken =
    rate === 'default'
      ? safeText
      : `<prosody rate='${escapeXml(rate)}'>${safeText}</prosody>`

  const ssml =
    `<speak version='1.0' xml:lang='zh-CN'>` +
    `<voice xml:lang='zh-CN' name='${escapeXml(voice)}'>${spoken}</voice>` +
    `</speak>`

  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
        'User-Agent': 'MandarinVideoGenerator',
      },
      body: ssml,
    },
  )

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Azure TTS error ${res.status}: ${errText}`)
  }

  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(cachePath, buf)

  return c.json({
    audioBase64: buf.toString('base64'),
    mimeType: 'audio/mpeg',
    cached: false,
    rate,
    cachePath,
  })
}

function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
