import fs from 'node:fs'
import path from 'node:path'
import {
  loadCatalog,
  saveCatalog,
  upsertVideo,
  nextPublishSlot,
  packageDir,
} from './catalog.js'
import { OUTPUT_DIR } from './paths.js'

function resolvePackageDir(video) {
  if (!video?.packageDir) return packageDir(video.templateId, video.setIndex)
  return path.isAbsolute(video.packageDir)
    ? video.packageDir
    : path.join(OUTPUT_DIR, video.packageDir)
}

function hasLocalPackage(video) {
  const dir = resolvePackageDir(video)
  return (
    fs.existsSync(path.join(dir, 'video.mp4')) &&
    fs.existsSync(path.join(dir, 'meta.json'))
  )
}

function assignNextSlot(catalog) {
  let slot = nextPublishSlot(catalog)
  const minAhead =
    Date.now() + (Number(catalog.schedule.weeksAhead) || 1) * 6 * 24 * 3600 * 1000
  let guard = 0
  while (Date.parse(slot) < minAhead && guard < 30) {
    catalog.schedule.lastPublishAt = slot
    slot = nextPublishSlot(catalog)
    guard += 1
  }
  catalog.schedule.lastPublishAt = slot
  return slot
}

/**
 * Assign Mon–Fri noon publishAt slots to all locally ready videos (no YouTube calls).
 * Sets status to `queued`.
 */
export function queueUploads({ templateId } = {}) {
  const catalog = loadCatalog()
  const candidates = catalog.videos
    .filter((v) => {
      if (templateId && v.templateId !== templateId) return false
      if (v.videoId) return false
      if (v.status === 'queued' && v.publishAt) return false
      if (v.status !== 'ready' && v.status !== 'failed') return false
      return hasLocalPackage(v)
    })
    .sort((a, b) => {
      if (a.templateId !== b.templateId) return a.templateId.localeCompare(b.templateId)
      return Number(a.setIndex) - Number(b.setIndex)
    })

  const queued = []
  for (const video of candidates) {
    const publishAt = assignNextSlot(catalog)
    upsertVideo(catalog, {
      ...video,
      status: 'queued',
      publishAt,
      error: null,
    })
    queued.push({ id: video.id, publishAt })
  }
  saveCatalog(catalog)
  return { queued, count: queued.length }
}

/**
 * Derive calendar/UI label from catalog row + current time.
 */
export function displayStatus(video, now = Date.now()) {
  if (video?.videoId) {
    const t = Date.parse(video.publishAt)
    if (Number.isFinite(t) && t > now) return 'scheduled'
    return 'published'
  }
  if (video?.publishAt && (video.status === 'queued' || video.status === 'ready')) {
    return 'queued for upload'
  }
  if (video?.status === 'queued') return 'queued for upload'
  return video?.status || 'pending'
}
