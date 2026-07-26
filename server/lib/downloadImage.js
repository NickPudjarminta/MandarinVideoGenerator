import fs from 'node:fs'
import { sniffMime } from './normalizeImage.js'

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const IMAGE_MAGIC = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic'])

function looksLikeHtml(buf) {
  const head = buf.subarray(0, 200).toString('utf8').trim().toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<head')
}

/**
 * Download an image with browser-like headers.
 * Tries the primary URL, then optional fallbacks (e.g. Serper thumbnails).
 * Returns Buffer.
 */
export async function downloadImageBuffer(url, { fallbackUrls = [] } = {}) {
  const candidates = [url, ...fallbackUrls].filter(Boolean)
  const errors = []

  for (const candidate of candidates) {
    try {
      const buf = await fetchImageOnce(candidate)
      if (buf?.length) return buf
    } catch (err) {
      errors.push(`${candidate}: ${err.message}`)
    }
  }

  throw new Error(`Failed to download image. ${errors.join(' | ')}`)
}

export async function downloadImageTo(url, dest, opts = {}) {
  const buf = await downloadImageBuffer(url, opts)
  fs.writeFileSync(dest, buf)
  return dest
}

async function fetchImageOnce(url) {
  let origin = 'https://www.google.com/'
  try {
    origin = new URL(url).origin + '/'
  } catch {
    /* keep default */
  }

  // Prefer JPEG/PNG — AVIF/WebP are often what CDNs send and Gemini rejects more often
  const headerSets = [
    {
      'User-Agent': BROWSER_UA,
      Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.5',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: origin,
    },
    {
      'User-Agent': BROWSER_UA,
      Accept: 'image/jpeg,image/png,image/*;q=0.8',
      Referer: 'https://www.google.com/',
    },
    {
      'User-Agent': BROWSER_UA,
      Accept: '*/*',
    },
  ]

  let lastStatus = 0
  for (const headers of headerSets) {
    const res = await fetch(url, {
      headers,
      redirect: 'follow',
    })
    lastStatus = res.status
    if (!res.ok) continue

    const buf = Buffer.from(await res.arrayBuffer())
    // Reject tiny/error payloads and HTML soft-404s
    if (buf.length < 256) continue
    if (looksLikeHtml(buf)) continue
    const mime = sniffMime(buf)
    if (!IMAGE_MAGIC.has(mime)) {
      throw new Error(`not an image (${mime}, ${buf.length} bytes)`)
    }
    return buf
  }

  throw new Error(`${lastStatus || 'unknown'}`)
}
