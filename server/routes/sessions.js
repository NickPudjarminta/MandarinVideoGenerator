import fs from 'node:fs'
import path from 'node:path'
import { SESSIONS_DIR, OUTPUT_DIR, ensureDirs } from '../lib/paths.js'

function sessionDir(id) {
  const safe = path.basename(String(id || ''))
  if (!safe || safe !== id) return null
  return path.join(SESSIONS_DIR, safe)
}

function readManifest(dir) {
  const p = path.join(dir, 'manifest.json')
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function writeBase64File(dest, b64) {
  if (!b64) return false
  const cleaned = String(b64).replace(/^data:[^;]+;base64,/, '')
  fs.writeFileSync(dest, Buffer.from(cleaned, 'base64'))
  return true
}

/** List recent sessions for the Load UI. */
export async function listSessionsHandler(c) {
  ensureDirs()
  if (!fs.existsSync(SESSIONS_DIR)) return c.json({ sessions: [] })

  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
  const sessions = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const dir = path.join(SESSIONS_DIR, ent.name)
    const manifest = readManifest(dir)
    if (!manifest) continue
    const videoName = manifest.videoFileName || ''
    const hasVideo = Boolean(
      videoName && fs.existsSync(path.join(OUTPUT_DIR, path.basename(videoName))),
    )
    sessions.push({
      id: ent.name,
      title: manifest.concept?.title || manifest.title || ent.name,
      updatedAt: manifest.updatedAt || null,
      createdAt: manifest.createdAt || null,
      beatCount: Array.isArray(manifest.beats) ? manifest.beats.length : 0,
      hasVideo,
      videoUrl: hasVideo ? `/output/${path.basename(videoName)}` : null,
      aspectId: manifest.aspectId || null,
    })
  }

  sessions.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return c.json({ sessions: sessions.slice(0, 40) })
}

/** Return full manifest + file URLs for restore. */
export async function getSessionHandler(c) {
  ensureDirs()
  const id = c.req.param('id')
  const dir = sessionDir(id)
  if (!dir || !fs.existsSync(dir)) return c.json({ error: 'Session not found' }, 404)
  const manifest = readManifest(dir)
  if (!manifest) return c.json({ error: 'manifest.json missing' }, 404)

  const styledFiles = []
  const beats = Array.isArray(manifest.beats) ? manifest.beats : []
  for (let i = 0; i < beats.length; i++) {
    const name = `beat_${i}_styled.jpg`
    if (fs.existsSync(path.join(dir, name))) {
      styledFiles.push({
        index: i,
        url: `/api/sessions/${id}/files/${name}`,
      })
    }
  }

  const videoName = manifest.videoFileName || ''
  const hasVideo = Boolean(
    videoName && fs.existsSync(path.join(OUTPUT_DIR, path.basename(videoName))),
  )

  return c.json({
    id,
    manifest,
    styledFiles,
    videoUrl: hasVideo ? `/output/${path.basename(videoName)}` : null,
  })
}

/** Serve a file from a session folder (styled jpgs only). */
export async function getSessionFileHandler(c) {
  const id = c.req.param('id')
  const name = path.basename(c.req.param('name') || '')
  const dir = sessionDir(id)
  if (!dir || !fs.existsSync(dir)) return c.json({ error: 'Session not found' }, 404)
  if (!/^beat_\d+_styled\.jpg$/i.test(name)) {
    return c.json({ error: 'Invalid file' }, 400)
  }
  const filePath = path.join(dir, name)
  if (!fs.existsSync(filePath)) return c.json({ error: 'Not found' }, 404)
  const buf = fs.readFileSync(filePath)
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * Save / update a session snapshot.
 * Body: { sessionId?, concept, englishScript, mandarinScript, keyNounRows, prompts,
 *   aspectId, style, videoUrl?, beats: [{ ...meta, styledImageBase64? }] }
 */
export async function saveSessionHandler(c) {
  ensureDirs()
  const body = await c.req.json()
  const sessionId =
    String(body.sessionId || '').trim() ||
    `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`

  const dir = sessionDir(sessionId)
  if (!dir) return c.json({ error: 'Invalid sessionId' }, 400)
  fs.mkdirSync(dir, { recursive: true })

  const prev = readManifest(dir) || {}
  const now = new Date().toISOString()
  const beatsIn = Array.isArray(body.beats) ? body.beats : []

  const beats = beatsIn.map((b, i) => {
    const styledName = `beat_${i}_styled.jpg`
    const styledPath = path.join(dir, styledName)
    if (b.styledImageBase64) {
      writeBase64File(styledPath, b.styledImageBase64)
    }
    const hasStyled = fs.existsSync(styledPath)
    return {
      index: i,
      mandarin: b.mandarin || '',
      english: b.english || '',
      pinyin: b.pinyin || '',
      keyNoun: b.keyNoun || '',
      keyNounEn: b.keyNounEn || '',
      keyNounPinyin: b.keyNounPinyin || '',
      keyword: b.keyword || '',
      query: b.query || '',
      selectedImageUrl: b.selectedImageUrl || '',
      selectedImageThumbnail: b.selectedImageThumbnail || '',
      audioDurationSec: b.durationSec || b.audioDurationSec || null,
      hasStyled,
      styledFile: hasStyled ? styledName : null,
    }
  })

  let videoFileName = prev.videoFileName || null
  if (body.videoUrl) {
    const m = String(body.videoUrl).match(/\/output\/([^/?#]+)/i)
    if (m) videoFileName = m[1]
  }

  const manifest = {
    id: sessionId,
    createdAt: prev.createdAt || now,
    updatedAt: now,
    title: body.concept?.title || body.title || prev.title || sessionId,
    concept: body.concept ?? prev.concept ?? null,
    englishScript: body.englishScript ?? prev.englishScript ?? '',
    mandarinScript: body.mandarinScript ?? prev.mandarinScript ?? '',
    keyNounRows: body.keyNounRows ?? prev.keyNounRows ?? [],
    prompts: body.prompts ?? prev.prompts ?? null,
    aspectId: body.aspectId ?? prev.aspectId ?? 'portrait',
    style: body.style ?? prev.style ?? null,
    videoFileName,
    beats,
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  // Also drop a generations-compatible snapshot for convenience
  const generations = {
    exportedAt: now,
    selected: {
      concept: manifest.concept,
      englishScript: manifest.englishScript,
      mandarinScript: manifest.mandarinScript,
      youtubeMeta: null,
      subtitleStyle: manifest.style,
      beats: beats.map((b) => ({
        index: b.index,
        mandarin: b.mandarin,
        english: b.english,
        pinyin: b.pinyin,
        imageQuery: b.query,
        keyword: b.keyword,
        keyNoun: b.keyNoun,
        keyNounEn: b.keyNounEn,
        selectedImageUrl: b.selectedImageUrl,
        selectedImageThumbnail: b.selectedImageThumbnail,
      })),
    },
  }
  fs.writeFileSync(
    path.join(dir, 'run-generations.json'),
    JSON.stringify(generations, null, 2),
    'utf8',
  )

  return c.json({
    sessionId,
    updatedAt: now,
    beatCount: beats.length,
    videoFileName,
  })
}
