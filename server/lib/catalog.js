import fs from 'node:fs'
import path from 'node:path'
import { ROOT, OUTPUT_DIR, DATA_DIR, PUBLIC_DIR } from './paths.js'
import { FIRST_PUBLISH_AT, computeNextPublishAt, STATE_PATH } from './autopilotState.js'

export const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json')
export const TEMPLATES_DIR = path.join(DATA_DIR, 'templates')
export const WEEKLY_LOCK_PATH = path.join(DATA_DIR, 'weekly-upload.lock')
export const PLAYLIST_ID = 'PLSBjUp0GMW_c'

const DEFAULT_CATALOG = {
  version: 1,
  playlistId: PLAYLIST_ID,
  schedule: {
    timezone: 'America/Los_Angeles',
    weekdays: [1, 2, 3, 4, 5],
    hour: 12,
    weeksAhead: 1,
    lastWeeklyUploadAt: null,
    lastPublishAt: null,
  },
  videos: [],
}

export function videoIdFor(templateId, setIndex) {
  return `${templateId}:${Number(setIndex)}`
}

export function packageDir(templateId, setIndex) {
  return path.join(OUTPUT_DIR, String(templateId), `Set_${Number(setIndex)}`)
}

export function packageDirRel(templateId, setIndex) {
  return path.join(String(templateId), `Set_${Number(setIndex)}`).replace(/\\/g, '/')
}

export function ensureStudioDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true })
}

export function loadCatalog() {
  ensureStudioDirs()
  if (!fs.existsSync(CATALOG_PATH)) {
    const initial = structuredClone(DEFAULT_CATALOG)
    saveCatalog(initial)
    return initial
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'))
    return {
      ...DEFAULT_CATALOG,
      ...raw,
      schedule: { ...DEFAULT_CATALOG.schedule, ...(raw.schedule || {}) },
      videos: Array.isArray(raw.videos) ? raw.videos : [],
    }
  } catch {
    return structuredClone(DEFAULT_CATALOG)
  }
}

export function saveCatalog(catalog) {
  ensureStudioDirs()
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
}

export function upsertVideo(catalog, video) {
  const id = video.id || videoIdFor(video.templateId, video.setIndex)
  const idx = catalog.videos.findIndex((v) => v.id === id)
  const row = { ...video, id }
  if (idx >= 0) catalog.videos[idx] = { ...catalog.videos[idx], ...row }
  else catalog.videos.push(row)
  return row
}

export function getVideo(catalog, id) {
  return catalog.videos.find((v) => v.id === id) || null
}

export function listVideos(catalog, { templateId } = {}) {
  let rows = [...catalog.videos]
  if (templateId) rows = rows.filter((v) => v.templateId === templateId)
  return rows.sort((a, b) => {
    if (a.templateId !== b.templateId) return String(a.templateId).localeCompare(b.templateId)
    return Number(a.setIndex) - Number(b.setIndex)
  })
}

/**
 * One-time migrate autopilot-state.json uploads into catalog as hsk1:* rows.
 */
export function migrateAutopilotIntoCatalog(catalog) {
  if (!fs.existsSync(STATE_PATH)) return catalog
  let state
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return catalog
  }
  const uploads = Array.isArray(state.uploads) ? state.uploads : []
  for (const u of uploads) {
    const setIndex = Number(u.set)
    if (!setIndex) continue
    const id = videoIdFor('hsk1', setIndex)
    const existing = getVideo(catalog, id)
    const legacyDir = path.join(OUTPUT_DIR, `HSK1_Set_${setIndex}`)
    const newDir = packageDir('hsk1', setIndex)
    let pkgRel = packageDirRel('hsk1', setIndex)
    let status = u.videoId ? 'uploaded' : 'ready'
    if (fs.existsSync(path.join(legacyDir, 'video.mp4'))) {
      pkgRel = `HSK1_Set_${setIndex}`
    } else if (fs.existsSync(path.join(newDir, 'video.mp4'))) {
      pkgRel = packageDirRel('hsk1', setIndex)
    } else if (!u.videoId) {
      status = 'pending'
    }
    upsertVideo(catalog, {
      id,
      templateId: 'hsk1',
      setIndex,
      firstWord: existing?.firstWord || '',
      lastWord: existing?.lastWord || '',
      title: existing?.title || '',
      description: existing?.description || '',
      status,
      packageDir: pkgRel,
      publishAt: u.publishAt || existing?.publishAt || null,
      videoId: u.videoId || existing?.videoId || null,
      uploadedAt: u.uploadedAt || existing?.uploadedAt || null,
      error: null,
    })
  }
  if (state.lastPublishAt) {
    catalog.schedule.lastPublishAt = state.lastPublishAt
  }
  return catalog
}

export function lastAssignedPublishAt(catalog) {
  const withPub = catalog.videos
    .map((v) => v.publishAt)
    .filter(Boolean)
    .sort()
  if (withPub.length) return withPub[withPub.length - 1]
  return catalog.schedule.lastPublishAt || null
}

export function nextPublishSlot(catalog) {
  return computeNextPublishAt(lastAssignedPublishAt(catalog) || null)
}

export { FIRST_PUBLISH_AT, computeNextPublishAt, ROOT, PUBLIC_DIR }
