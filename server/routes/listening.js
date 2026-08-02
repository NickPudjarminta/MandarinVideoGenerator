import fs from 'node:fs'
import path from 'node:path'
import { renderListeningVideo } from '../lib/listeningPipeline.js'
import { buildListeningSrt } from '../lib/srt.js'
import { buildListeningMeta, listeningPackageDirName } from '../lib/listeningMeta.js'
import { renderListeningThumbnail } from '../lib/listeningThumbnail.js'
import { OUTPUT_DIR, ensureDirs } from '../lib/paths.js'

function sentencesFromBody(body, plays) {
  if (Array.isArray(body.sentences) && body.sentences.length) {
    return body.sentences.map((s) => ({
      zh: String(s.zh || '').trim(),
      en: String(s.en || '').trim(),
    }))
  }
  const byIndex = []
  for (const play of plays) {
    const i = Number(play.sentenceIndex) || 0
    if (!byIndex[i]) {
      byIndex[i] = {
        zh: String(play.zh || '').trim(),
        en: String(play.en || '').trim(),
      }
    }
  }
  return byIndex.filter(Boolean)
}

export async function listeningRenderHandler(c) {
  const body = await c.req.json()
  const plays = body.plays
  if (!Array.isArray(plays) || !plays.length) {
    return c.json({ error: 'plays must be a non-empty array' }, 400)
  }

  const hskLevel = String(body.hskLevel || '').trim()
  const chapterIndex = String(body.chapterIndex || '').trim()
  const chapterHeader = String(body.chapterHeader || '').trim()
  if (!hskLevel || !chapterIndex || !chapterHeader) {
    return c.json(
      { error: 'hskLevel, chapterIndex, and chapterHeader are required for packaging' },
      400,
    )
  }

  const gapSec = Number(body.gapSec)
  const revealGapSec = Number(body.revealGapSec)
  const signal = c.req.raw?.signal

  const result = await renderListeningVideo({
    plays,
    gapSec: Number.isFinite(gapSec) ? gapSec : 2,
    revealGapSec: Number.isFinite(revealGapSec) ? revealGapSec : 2,
    sessionId: String(body.sessionId || ''),
    signal,
  })

  ensureDirs()
  const packageName = listeningPackageDirName(hskLevel, chapterIndex)
  const packageDir = path.join(OUTPUT_DIR, packageName)
  fs.mkdirSync(packageDir, { recursive: true })

  // Move rendered video into package as video.mp4
  const srcVideoRel = String(result.videoUrl || '').replace(/^\/output\//, '')
  const srcVideoPath = path.join(OUTPUT_DIR, path.basename(srcVideoRel))
  const videoPath = path.join(packageDir, 'video.mp4')
  if (fs.existsSync(srcVideoPath)) {
    fs.renameSync(srcVideoPath, videoPath)
  } else {
    throw new Error(`Rendered video missing: ${srcVideoPath}`)
  }

  const enSrt = buildListeningSrt(result.timeline, 'en')
  const srtPath = path.join(packageDir, 'subtitles-en.srt')
  fs.writeFileSync(srtPath, enSrt, 'utf8')

  const sentences = sentencesFromBody(body, plays)
  const { title, description } = buildListeningMeta({
    hskLevel,
    chapterIndex,
    chapterHeader,
    sentences,
    timeline: result.timeline,
  })
  const youtubePath = path.join(packageDir, 'youtube.txt')
  fs.writeFileSync(youtubePath, `${title}\n\n${description}\n`, 'utf8')

  let thumbnailUrl = null
  const thumbPath = path.join(packageDir, 'thumbnail.png')
  const renderedThumb = await renderListeningThumbnail({
    hskLevel,
    chapterIndex,
    outPath: thumbPath,
    signal,
  })
  if (renderedThumb) {
    thumbnailUrl = `/output/${packageName}/thumbnail.png`
  }

  const videoUrl = `/output/${packageName}/video.mp4`
  const srtEnUrl = `/output/${packageName}/subtitles-en.srt`
  const youtubeTxtUrl = `/output/${packageName}/youtube.txt`

  return c.json({
    videoUrl,
    timeline: result.timeline,
    durationSec: result.durationSec,
    srtEnUrl,
    thumbnailUrl,
    youtubeTxtUrl,
    packageDir: packageName,
    title,
    description,
  })
}
