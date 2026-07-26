import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { stylizeImage } from '../lib/geminiImage.js'
import { downloadImageBuffer } from '../lib/downloadImage.js'
import { normalizeToJpeg, sniffMime } from '../lib/normalizeImage.js'
import { CACHE_DIR, ensureDirs } from '../lib/paths.js'
import { resolveVideoFormat } from '../lib/videoFormat.js'

const DEFAULT_STYLE_PROMPT = `Restyle this photo in an archival architectural blueprint, watercolor, and ink wash style on textured cream paper with visible deckled edges.
The image must feature an explicit fine-line ink technical drafting grid, architectural alignment guidelines, and subtle blueprint markings like scale indicators, 'NTS' labels, and drafting annotations. Everything from the source photo should be rendered with detailed fine-line ink contours and dense, uniform cross-hatch shading that wraps across the surfaces to define volume and form.
The aesthetic relies on a highly desaturated, earthy palette dominated by dusty rose and terracotta watercolor bleeds and washes, accented with warm grays, straw tones, and subtle olive-green highlights. Preserve the core elements, layout, and composition of the source photo.`

export async function styleImageHandler(c) {
  const body = await c.req.json()
  const prompt = (body.prompt || DEFAULT_STYLE_PROMPT).trim()
  if (!prompt) return c.json({ error: 'prompt is required' }, 400)
  const videoFormat = resolveVideoFormat(body)
  const aspectRatio = videoFormat.geminiAspect

  ensureDirs()
  const styledDir = path.join(CACHE_DIR, 'styled')
  fs.mkdirSync(styledDir, { recursive: true })

  let sourceBuf = null

  if (body.imageBase64) {
    const cleaned = String(body.imageBase64).replace(/^data:[^;]+;base64,/, '')
    sourceBuf = Buffer.from(cleaned, 'base64')
  } else if (body.imageUrl) {
    try {
      sourceBuf = await downloadImageBuffer(body.imageUrl, {
        fallbackUrls: body.fallbackUrl ? [body.fallbackUrl] : [],
      })
    } catch (err) {
      // Thumbnail fallback often works when CDN blocks the full image
      if (body.fallbackUrl && body.fallbackUrl !== body.imageUrl) {
        sourceBuf = await downloadImageBuffer(body.fallbackUrl)
      } else {
        throw err
      }
    }
  }

  if (!sourceBuf?.length) {
    return c.json({ error: 'imageBase64 or imageUrl is required' }, 400)
  }

  // Normalize before hashing/caching so WebP/AVIF/etc. don't poison the key as raw bytes
  const normalized = await normalizeToJpeg(sourceBuf, { maxEdge: 1280, quality: 85 })
  const detected = sniffMime(sourceBuf)
  const force = Boolean(body.force)

  const cacheKey = crypto
    .createHash('sha256')
    .update(
      `v5-textstyle|${aspectRatio}|${prompt}|${normalized.base64.slice(0, 2400)}|${normalized.buffer.length}`,
    )
    .digest('hex')
    .slice(0, 28)
  const cachePath = path.join(styledDir, `${cacheKey}.png`)

  // Restyle passes force=true so Gemini runs again instead of returning the same cache hit
  if (!force && fs.existsSync(cachePath)) {
    const buf = fs.readFileSync(cachePath)
    return c.json({
      imageBase64: buf.toString('base64'),
      mimeType: 'image/png',
      cached: true,
      sourceMime: detected,
      aspectRatio,
    })
  }

  let result
  try {
    result = await stylizeImage({
      imageBuffer: normalized.buffer,
      imageBase64: normalized.base64,
      mimeType: 'image/jpeg',
      prompt,
      aspectRatio,
    })
  } catch (err) {
    const msg = String(err.message || '')
    const retriable =
      msg.includes('Unable to process input image') ||
      msg.includes('INVALID_ARGUMENT') ||
      msg.includes('Gemini image edit error 400')
    const thumb = body.fallbackUrl
    if (!retriable || !thumb || thumb === body.imageUrl) throw err

    // Full-size CDN bytes sometimes normalize but Gemini still rejects — try Serper thumb
    const thumbBuf = await downloadImageBuffer(thumb)
    const thumbNorm = await normalizeToJpeg(thumbBuf, { maxEdge: 1024, quality: 85 })
    result = await stylizeImage({
      imageBuffer: thumbNorm.buffer,
      imageBase64: thumbNorm.base64,
      mimeType: 'image/jpeg',
      prompt,
      aspectRatio,
    })
  }

  const outBuf = Buffer.from(result.imageBase64, 'base64')
  fs.writeFileSync(cachePath, outBuf)

  return c.json({
    imageBase64: result.imageBase64,
    mimeType: result.mimeType || 'image/png',
    cached: false,
    sourceMime: detected,
    aspectRatio,
  })
}
