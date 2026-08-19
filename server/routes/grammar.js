import { enqueueOneOff, enqueueOneOffRegenerate, getQueueStatus } from '../lib/generateQueue.js'

function jsonOk(c, data) {
  return c.json(data)
}

export async function enqueueOneOffHandler(c) {
  const body = await c.req.json()
  const id = String(body.id || '').trim()

  if (body.regenerate || id.startsWith('grammar:')) {
    if (!id.startsWith('grammar:')) {
      throw new Error('id required to regenerate one-off (grammar:…)')
    }
    const status = enqueueOneOffRegenerate(id, {
      hskLevel: body.hskLevel,
      thumbnailText: body.thumbnailText,
      title: body.title,
      description: body.description,
      phrases: Array.isArray(body.phrases) ? body.phrases : undefined,
    })
    return jsonOk(c, status)
  }

  const hskLevel = String(body.hskLevel ?? '').trim() || '1'
  const thumbnailText = String(body.thumbnailText || '').replace(/\s+$/, '')
  const title = String(body.title || '').trim()
  const description = String(body.description || '')
  const phrases = Array.isArray(body.phrases) ? body.phrases : []
  if (!thumbnailText.trim()) throw new Error('thumbnailText required')
  if (!title) throw new Error('title required')
  if (!description.trim()) throw new Error('description required')
  if (!phrases.length) throw new Error('phrases required')

  const status = enqueueOneOff({
    hskLevel,
    thumbnailText,
    title,
    description,
    phrases,
    gapSec: Number(body.gapSec) || 2,
    revealGapSec: Number(body.revealGapSec) || 2,
    slug: body.slug || undefined,
  })
  return jsonOk(c, status)
}

export async function grammarQueueStatusHandler(c) {
  return jsonOk(c, getQueueStatus())
}
