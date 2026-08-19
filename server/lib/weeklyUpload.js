import fs from 'node:fs'
import path from 'node:path'
import {
  loadCatalog,
  saveCatalog,
  upsertVideo,
  WEEKLY_LOCK_PATH,
  PLAYLIST_ID,
  packageDir,
} from './catalog.js'
import { OUTPUT_DIR } from './paths.js'
import { getYoutubeClient } from '../../scripts/youtubeAuth.mjs'

const DAILY_UPLOAD_LIMIT = 5
const UPLOAD_GAP_MS = 5 * 60 * 1000
const WEEK_MS = 7 * 24 * 3600 * 1000
const LOCK_MAX_AGE_MS = 3 * 60 * 60 * 1000 // allow multi-upload run with gaps

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pacificYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function uploadedTodayCount(catalog) {
  const today = pacificYmd()
  return (catalog.videos || []).filter((v) => {
    if (v.status !== 'uploaded' || !v.videoId || !v.uploadedAt) return false
    const t = Date.parse(v.uploadedAt)
    if (!Number.isFinite(t)) return false
    return pacificYmd(new Date(t)) === today
  }).length
}

function resolvePackageDir(video) {
  if (!video?.packageDir) return packageDir(video.templateId, video.setIndex)
  const abs = path.isAbsolute(video.packageDir)
    ? video.packageDir
    : path.join(OUTPUT_DIR, video.packageDir)
  return abs
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

function readLock() {
  if (!fs.existsSync(WEEKLY_LOCK_PATH)) return null
  try {
    const raw = fs.readFileSync(WEEKLY_LOCK_PATH, 'utf8').trim()
    if (raw.startsWith('{')) {
      const data = JSON.parse(raw)
      const startedAt = Date.parse(data.startedAt) || fs.statSync(WEEKLY_LOCK_PATH).mtimeMs
      return { startedAt, pid: Number(data.pid) || null }
    }
    // Legacy plain ISO timestamp
    const startedAt = Date.parse(raw) || fs.statSync(WEEKLY_LOCK_PATH).mtimeMs
    return { startedAt, pid: null }
  } catch {
    try {
      return { startedAt: fs.statSync(WEEKLY_LOCK_PATH).mtimeMs, pid: null }
    } catch {
      return null
    }
  }
}

function clearLock() {
  try {
    fs.unlinkSync(WEEKLY_LOCK_PATH)
  } catch {
    /* ignore */
  }
}

function writeLock() {
  const payload = JSON.stringify({
    startedAt: new Date().toISOString(),
    pid: process.pid,
  })
  fs.writeFileSync(WEEKLY_LOCK_PATH, payload, 'utf8')
}

function touchLock() {
  try {
    writeLock()
  } catch {
    /* ignore */
  }
}

function acquireLock() {
  const existing = readLock()
  if (existing) {
    const age = Date.now() - existing.startedAt
    if (age < LOCK_MAX_AGE_MS) {
      if (existing.pid != null && isPidAlive(existing.pid)) {
        return { ok: false, reason: 'Weekly upload already in progress' }
      }
      // Stale lock (dead PID or legacy file from interrupted run)
      clearLock()
    } else {
      clearLock()
    }
  }
  writeLock()
  return { ok: true }
}

let signalHandlersInstalled = false
function installLockSignalHandlers() {
  if (signalHandlersInstalled) return
  signalHandlersInstalled = true
  const release = () => {
    clearLock()
  }
  process.once('SIGINT', () => {
    release()
    process.exit(130)
  })
  process.once('SIGTERM', () => {
    release()
    process.exit(143)
  })
}

/**
 * Upload queued videos (already slotted). Max 5 per Pacific day; 5 min between inserts.
 */
export async function runWeeklyUpload({ force = false } = {}) {
  const catalog = loadCatalog()
  const last = catalog.schedule.lastWeeklyUploadAt
    ? Date.parse(catalog.schedule.lastWeeklyUploadAt)
    : 0
  if (!force && last && Date.now() - last < WEEK_MS - 12 * 3600 * 1000) {
    return {
      skipped: true,
      reason: `Weekly upload already ran at ${catalog.schedule.lastWeeklyUploadAt}`,
      uploaded: [],
    }
  }

  const alreadyToday = uploadedTodayCount(catalog)
  const remainingQuota = Math.max(0, DAILY_UPLOAD_LIMIT - alreadyToday)
  if (remainingQuota <= 0) {
    return {
      skipped: true,
      reason: `Daily upload limit reached (${DAILY_UPLOAD_LIMIT})`,
      uploaded: [],
    }
  }

  const lock = acquireLock()
  if (!lock.ok) {
    return { skipped: true, reason: lock.reason, uploaded: [] }
  }
  installLockSignalHandlers()

  const uploaded = []
  try {
    const candidates = catalog.videos
      .filter((v) => v.status === 'queued' && !v.videoId && v.publishAt)
      .sort((a, b) => {
        const ta = Date.parse(a.publishAt) || 0
        const tb = Date.parse(b.publishAt) || 0
        if (ta !== tb) return ta - tb
        if (a.templateId !== b.templateId) return a.templateId.localeCompare(b.templateId)
        return Number(a.setIndex) - Number(b.setIndex)
      })
      .slice(0, remainingQuota)

    if (!candidates.length) {
      return { skipped: false, uploaded: [], message: 'No queued videos to upload' }
    }

    console.log(
      `Uploading up to ${candidates.length} video(s) (daily quota remaining: ${remainingQuota}/${DAILY_UPLOAD_LIMIT})`,
    )

    const youtube = await getYoutubeClient()
    let lastPub = null

    for (let i = 0; i < candidates.length; i++) {
      const video = candidates[i]
      const dir = resolvePackageDir(video)
      const metaPath = path.join(dir, 'meta.json')
      const videoPath = path.join(dir, 'video.mp4')
      const thumbPath = path.join(dir, 'thumbnail.png')
      const srtPath = path.join(dir, 'subtitles-en.srt')
      if (!fs.existsSync(videoPath) || !fs.existsSync(metaPath)) {
        upsertVideo(catalog, {
          ...video,
          status: 'failed',
          error: `Package missing at ${dir}`,
        })
        saveCatalog(catalog)
        continue
      }
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      const publishAt = video.publishAt

      console.log(`Weekly upload ${video.id} → ${publishAt}`)
      console.log(`  Title: ${meta.title}`)

      const res = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: meta.title,
            description: meta.description,
            tags: [
              'HSK',
              'LearnChinese',
              'ChineseListeningPractice',
              'MandarinChinese',
              'LearnMandarin',
            ],
            categoryId: '27',
            defaultLanguage: 'en',
            defaultAudioLanguage: 'zh-CN',
          },
          status: {
            privacyStatus: 'private',
            publishAt,
            selfDeclaredMadeForKids: false,
          },
        },
        media: { body: fs.createReadStream(videoPath) },
      })

      const videoId = res.data.id
      if (!videoId) throw new Error('YouTube insert returned no id')

      if (fs.existsSync(thumbPath)) {
        await youtube.thumbnails.set({
          videoId,
          media: { body: fs.createReadStream(thumbPath) },
        })
      }

      try {
        await youtube.playlistItems.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              playlistId: catalog.playlistId || PLAYLIST_ID,
              resourceId: { kind: 'youtube#video', videoId },
            },
          },
        })
      } catch (err) {
        console.warn(`  playlist insert: ${err.message}`)
      }

      if (fs.existsSync(srtPath)) {
        try {
          await youtube.captions.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                videoId,
                language: 'en',
                name: 'English',
                isDraft: false,
              },
            },
            media: { body: fs.createReadStream(srtPath) },
          })
        } catch (err) {
          console.warn(`  captions: ${err.message}`)
        }
      }

      upsertVideo(catalog, {
        ...video,
        title: meta.title,
        description: meta.description,
        status: 'uploaded',
        publishAt,
        videoId,
        uploadedAt: new Date().toISOString(),
        error: null,
      })
      catalog.schedule.lastPublishAt = publishAt
      lastPub = publishAt
      saveCatalog(catalog)
      uploaded.push({ id: video.id, videoId, publishAt })
      touchLock()

      const moreLeft = i < candidates.length - 1
      if (moreLeft) {
        console.log('Waiting 5 minutes before next upload…')
        await sleep(UPLOAD_GAP_MS)
        touchLock()
      }
    }

    catalog.schedule.lastWeeklyUploadAt = new Date().toISOString()
    if (lastPub) catalog.schedule.lastPublishAt = lastPub
    saveCatalog(catalog)
    return { skipped: false, uploaded }
  } finally {
    clearLock()
  }
}

/**
 * Catch-up if last weekly run is older than ~7 days (or never).
 */
export async function maybeCatchUpWeeklyUpload() {
  const catalog = loadCatalog()
  const last = catalog.schedule.lastWeeklyUploadAt
    ? Date.parse(catalog.schedule.lastWeeklyUploadAt)
    : 0
  if (last && Date.now() - last < WEEK_MS) {
    return { skipped: true, reason: 'Within weekly window' }
  }
  if (uploadedTodayCount(catalog) >= DAILY_UPLOAD_LIMIT) {
    return { skipped: true, reason: `Daily upload limit reached (${DAILY_UPLOAD_LIMIT})` }
  }
  console.log('Weekly upload catch-up…')
  return runWeeklyUpload({ force: true })
}
