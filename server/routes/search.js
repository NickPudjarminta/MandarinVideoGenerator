import { callGemini } from '../lib/gemini.js'
import { requireEnv } from '../lib/env.js'
import { formatContextLine, resolveVideoFormat } from '../lib/videoFormat.js'

const MIN_SHORT_EDGE = 720
const MIN_LONG_EDGE = 1000

function dims(img) {
  return {
    w: Number(img.imageWidth || img.width || 0),
    h: Number(img.imageHeight || img.height || 0),
  }
}

/** HD enough to cover-crop to the export frame (any orientation). */
function isCropFriendlyHd(img) {
  const { w, h } = dims(img)
  if (!w || !h) return false
  return Math.min(w, h) >= MIN_SHORT_EDGE && Math.max(w, h) >= MIN_LONG_EDGE
}

function isDecentFallback(img) {
  const { w, h } = dims(img)
  if (!w || !h) return false
  return w >= 640 && h >= 640 && w * h >= 640 * 900
}

function score(img, preferPortrait) {
  const { w, h } = dims(img)
  if (!w || !h) return 0
  const orientBonus = preferPortrait
    ? h >= w
      ? 1.15
      : 1
    : w >= h
      ? 1.15
      : 1
  return w * h * orientBonus
}

export async function searchHandler(c) {
  const body = await c.req.json()
  const { prompt, sentence, query: queryOverride } = body
  const videoFormat = resolveVideoFormat(body)
  const preferPortrait = videoFormat.orientation === 'portrait'

  let query = (queryOverride || '').trim()

  if (!query) {
    if (!prompt?.trim()) return c.json({ error: 'prompt or query is required' }, 400)
    if (!sentence?.trim()) return c.json({ error: 'sentence is required when generating a query' }, 400)

    const keyNoun = String(body.keyNoun || '').trim()
    const keyNounEn = String(body.keyNounEn || '').trim()
    const context = [
      'Return JSON: { "query": string } — follow the user prompt exactly.',
      formatContextLine(videoFormat),
      preferPortrait
        ? 'Prefer high-resolution photos suitable for a portrait 9:16 crop (portrait or landscape OK).'
        : 'Prefer high-resolution photos suitable for a landscape 16:9 crop (landscape preferred when possible).',
      keyNoun || keyNounEn
        ? `Primary visual subject for this beat (build the query around this noun): ${keyNounEn || keyNoun}${keyNoun && keyNounEn ? ` (${keyNoun})` : ''}.`
        : '',
      'End with the exclusion string from the prompt.',
      `Sentence: ${sentence}`,
    ]
      .filter(Boolean)
      .join('\n')

    const data = await callGemini({ prompt, context, json: true })
    query = data.query || data.searchQuery || ''
    if (!query) return c.json({ error: 'Gemini did not return a query' }, 502)
  }

  const searchQ = query

  const apiKey = requireEnv('SERPER_API_KEY')
  const res = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: searchQ, num: 10 }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Serper error ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const raw = data.images || []

  const MAX_IMAGES = 4

  let filtered = raw
    .filter(isCropFriendlyHd)
    .sort((a, b) => score(b, preferPortrait) - score(a, preferPortrait))

  if (filtered.length < MAX_IMAGES) {
    const extras = raw
      .filter((img) => !filtered.includes(img) && isDecentFallback(img))
      .sort((a, b) => score(b, preferPortrait) - score(a, preferPortrait))
    filtered = [...filtered, ...extras]
  }

  if (filtered.length < MAX_IMAGES) {
    const extras = raw.filter((img) => {
      const { w, h } = dims(img)
      return (!w || !h) && !filtered.includes(img)
    })
    filtered = [...filtered, ...extras]
  }

  const images = filtered.slice(0, MAX_IMAGES).map((img, i) => ({
    id: `${i}-${img.imageUrl || img.link}`,
    url: img.imageUrl || img.link,
    thumbnail: img.thumbnailUrl || img.imageUrl || img.link,
    width: img.imageWidth || img.width || null,
    height: img.imageHeight || img.height || null,
    title: img.title || '',
  }))

  return c.json({
    query: searchQ,
    images,
    filter: {
      minShortEdge: MIN_SHORT_EDGE,
      minLongEdge: MIN_LONG_EDGE,
      orientation: preferPortrait ? 'prefer-portrait' : 'prefer-landscape',
      videoFormat,
      note: `FFmpeg center-crops to ${videoFormat.width}×${videoFormat.height}`,
    },
  })
}
