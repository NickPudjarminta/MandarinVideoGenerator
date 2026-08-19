import { loadCatalog, saveCatalog, listVideos, getVideo, upsertVideo } from '../lib/catalog.js'
import { bootstrapStudio } from '../lib/templates.js'
import { getQueueStatus } from '../lib/generateQueue.js'
import { runWeeklyUpload, getUploadQuota } from '../lib/weeklyUpload.js'
import { queueUploads, displayStatus } from '../lib/queueUploads.js'
import { importPackages } from '../lib/importPackages.js'
import { pushYoutubeMeta } from '../lib/pushYoutubeMeta.js'

function jsonOk(c, data) {
  return c.json(data)
}

export async function listVideosHandler(c) {
  bootstrapStudio()
  const templateId = c.req.query('templateId') || undefined
  const catalog = loadCatalog()
  const videos = listVideos(catalog, { templateId }).map((v) => ({
    ...v,
    displayStatus: displayStatus(v),
  }))
  return jsonOk(c, {
    schedule: catalog.schedule,
    playlistId: catalog.playlistId,
    quota: getUploadQuota(catalog),
    videos,
  })
}

export async function getVideoHandler(c) {
  const catalog = loadCatalog()
  const video = getVideo(catalog, c.req.param('id'))
  if (!video) return c.json({ error: 'Not found' }, 404)
  return jsonOk(c, { video: { ...video, displayStatus: displayStatus(video) } })
}

export async function patchVideoHandler(c) {
  const id = c.req.param('id')
  const catalog = loadCatalog()
  const video = getVideo(catalog, id)
  if (!video) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json()
  const allowed = ['status', 'error', 'publishAt', 'title', 'description']
  const patch = {}
  for (const k of allowed) {
    if (body[k] !== undefined) patch[k] = body[k]
  }
  if (patch.publishAt !== undefined) {
    const raw = String(patch.publishAt || '').trim()
    if (raw && !Number.isFinite(Date.parse(raw))) {
      throw new Error('publishAt must be a valid datetime')
    }
    patch.publishAt = raw || null
    if (raw && (video.status === 'ready' || !video.status)) {
      patch.status = 'queued'
    }
  }
  const updated = upsertVideo(catalog, { ...video, ...patch })
  saveCatalog(catalog)
  return jsonOk(c, { video: { ...updated, displayStatus: displayStatus(updated) } })
}

export async function importPackagesHandler(c) {
  const result = importPackages()
  return jsonOk(c, result)
}

export async function queueUploadsHandler(c) {
  const body = await c.req.json().catch(() => ({}))
  const result = queueUploads({ templateId: body?.templateId || undefined })
  return jsonOk(c, result)
}

export async function weeklyUploadHandler(c) {
  const body = await c.req.json().catch(() => ({}))
  const result = await runWeeklyUpload({ force: Boolean(body?.force) })
  return jsonOk(c, result)
}

export async function pushMetaHandler(c) {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const result = await pushYoutubeMeta(id, {
    title: body?.title,
    description: body?.description,
  })
  return jsonOk(c, result)
}

export async function quotaHandler(c) {
  return jsonOk(c, getUploadQuota())
}

export async function schedulerQueueStatusHandler(c) {
  return jsonOk(c, getQueueStatus())
}

export async function schedulerBootstrapHandler(c) {
  return jsonOk(c, bootstrapStudio())
}
