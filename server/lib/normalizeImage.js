import fs from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import { v4 as uuid } from 'uuid'
import { TMP_DIR, ensureDirs } from './paths.js'

/**
 * Convert any image buffer to a Gemini-safe JPEG.
 * - Forces sRGB JPEG
 * - Caps long edge (default 1280) so payloads stay under API limits
 */
export async function normalizeToJpeg(inputBuf, { maxEdge = 1280, quality = 85 } = {}) {
  ensureDirs()
  const id = uuid()
  const inPath = path.join(TMP_DIR, `norm_in_${id}`)
  const outPath = path.join(TMP_DIR, `norm_out_${id}.jpg`)

  fs.writeFileSync(inPath, inputBuf)

  try {
    // Force baseline JPEG + yuv420p — Gemini often rejects exotic encodings / ICC / CMYK
    await execa(
      'ffmpeg',
      [
        '-y',
        '-i', inPath,
        '-vf',
        `scale='min(${maxEdge},iw)':'min(${maxEdge},ih)':force_original_aspect_ratio=decrease,format=yuv420p`,
        '-frames:v', '1',
        '-q:v', String(Math.max(2, Math.round((100 - quality) / 4))),
        outPath,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )

    if (!fs.existsSync(outPath)) {
      throw new Error('ffmpeg produced no output image')
    }
    const out = fs.readFileSync(outPath)
    if (out.length < 500) throw new Error('Normalized image is empty or corrupt')
    return {
      buffer: out,
      mimeType: 'image/jpeg',
      base64: out.toString('base64'),
    }
  } finally {
    try { fs.unlinkSync(inPath) } catch { /* ignore */ }
    try { fs.unlinkSync(outPath) } catch { /* ignore */ }
  }
}

export function sniffMime(buf) {
  if (!buf?.length) return 'application/octet-stream'
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf.toString('ascii', 0, 4) === 'RIFF') {
    return 'image/webp'
  }
  // AVIF / HEIC often fail Gemini — treat as unknown so we still convert
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'image/heic'
  return 'application/octet-stream'
}
