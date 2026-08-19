import { loadCatalog, saveCatalog, listVideos, getVideo, upsertVideo } from '../lib/catalog.js'
import { bootstrapStudio } from '../lib/templates.js'
import { getQueueStatus } from '../lib/generateQueue.js'
import { runWeeklyUpload, getUploadQuota } from '../lib/weeklyUpload.js'
import { queueUploads, displayStatus } from '../lib/queueUploads.js'
import { importPackages } from '../lib/importPackages.js'
import { pushYoutubeMeta } from '../lib/pushYoutubeMeta.js'
import { syncYoutubeSchedule } from '../lib/syncYoutubeSchedule.js'
import {
  scheduleVideos,
  unscheduleVideos,
  reorderScheduled,
  placeVideos,
  pushLater,
  removeEmptySlots,
  buildTimeline,
  migrateYoutubePublishAt,
  isOutOfSync,
} from '../lib/rescheduleQueue.js'

function jsonOk(c, data) {
  return c.json(data)
}

export async function listVideosHandler(c) {
  bootstrapStudio()
  const templateId = c.req.query('templateId') || undefined
  const catalog = loadCatalog()
  if (migrateYoutubePublishAt(catalog)) saveCatalog(catalog)
  const videos = listVideos(catalog, { templateId }).map((v) => ({
    ...v,
    displayStatus: displayStatus(v),
    outOfSync: isOutOfSync(v),
  }))
  const timeline = buildTimeline(catalog).map((row) => ({
    publishAt: row.publishAt,
    locked: row.locked,
    displayStatus: row.displayStatus,
    outOfSync: row.outOfSync,
    video: row.video
      ? {
          ...row.video,
          displayStatus: displayStatus(row.video),
          outOfSync: isOutOfSync(row.video),
        }
      : null,
  }))
  return jsonOk(c, {
    schedule: catalog.schedule,
    playlistId: catalog.playlistId,
    quota: getUploadQuota(catalog),
    videos,
    timeline,
    outOfSyncCount: videos.filter((v) => v.outOfSync).length,
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

export async function scheduleHandler(c) {
  const body = await c.req.json()
  const result = scheduleVideos({
    ids: body?.ids,
    beforeId: body?.beforeId ?? null,
    publishAt: body?.publishAt ?? null,
  })
  return jsonOk(c, result)
}

export async function unscheduleHandler(c) {
  const body = await c.req.json()
  const result = unscheduleVideos({ ids: body?.ids })
  return jsonOk(c, result)
}

export async function reorderHandler(c) {
  const body = await c.req.json()
  const result = reorderScheduled({ orderedIds: body?.orderedIds })
  return jsonOk(c, result)
}

export async function placeHandler(c) {
  const body = await c.req.json()
  const result = placeVideos(body || {})
  return jsonOk(c, result)
}

export async function pushLaterHandler(c) {
  const body = await c.req.json()
  const result = pushLater({ ids: body?.ids, weeks: body?.weeks })
  return jsonOk(c, result)
}

export async function removeEmptySlotsHandler(c) {
  const result = removeEmptySlots()
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

export async function syncScheduleHandler(c) {
  const result = await syncYoutubeSchedule()
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
