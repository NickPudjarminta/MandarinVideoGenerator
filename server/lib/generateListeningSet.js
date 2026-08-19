import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { synthesizeAzureMp3, normalizeRate, DEFAULT_VOICE } from './azureTts.js'
import { renderListeningVideo } from './listeningPipeline.js'
import { buildListeningSrt } from './srt.js'
import { getTemplateSet } from './templateSets.js'
import { buildTemplateMeta } from './templateMeta.js'
import { resolveTemplateAssets } from './templates.js'
import {
  renderListeningOverlayNode,
  renderHsk1SetThumbnail,
} from './listeningOverlayNode.js'
import { CACHE_DIR, OUTPUT_DIR, ensureDirs } from './paths.js'
import {
  packageDir,
  packageDirRel,
  loadCatalog,
  saveCatalog,
  upsertVideo,
  videoIdFor,
} from './catalog.js'

const SPEED_PASSES = [
  { rate: '0.7' },
  { rate: '0.85' },
  { rate: 'default' },
]

const CACHE_TAG = '48k-192'

async function ttsCached(text, rate) {
  ensureDirs()
  const normRate = normalizeRate(rate)
  const hash = crypto
    .createHash('sha256')
    .update(`${CACHE_TAG}|${DEFAULT_VOICE}|${normRate}|${text}`)
    .digest('hex')
    .slice(0, 24)
  const cachePath = path.join(CACHE_DIR, 'tts', `${hash}.mp3`)
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath).toString('base64')
  }
  const buf = await synthesizeAzureMp3({ text, rate: normRate })
  fs.writeFileSync(cachePath, buf)
  return buf.toString('base64')
}

/**
 * Generate a full listening set package for a template under output/{templateId}/Set_N/.
 */
export async function generateListeningSet({
  templateId = 'hsk1',
  setIndex,
  gapSec = 2,
  revealGapSec = 2,
  onProgress,
  signal,
  updateCatalog = true,
} = {}) {
  const assets = resolveTemplateAssets(templateId)
  const { config } = assets
  const set = await getTemplateSet(templateId, setIndex)
  const { phrases, firstWord, lastWord } = set
  const outDir = packageDir(config.id, set.setIndex)
  fs.mkdirSync(outDir, { recursive: true })

  if (updateCatalog) {
    const catalog = loadCatalog()
    upsertVideo(catalog, {
      id: videoIdFor(config.id, set.setIndex),
      templateId: config.id,
      setIndex: set.setIndex,
      firstWord,
      lastWord,
      status: 'generating',
      packageDir: packageDirRel(config.id, set.setIndex),
      error: null,
    })
    saveCatalog(catalog)
  }

  const plays = []
  const sentenceCount = phrases.length

  try {
    for (let i = 0; i < phrases.length; i++) {
      const s = phrases[i]
      onProgress?.({
        phase: 'tts',
        index: i + 1,
        total: sentenceCount,
        message: `${config.id} Set ${set.setIndex}: phrase ${i + 1}/${sentenceCount} TTS…`,
      })

      const audioByRate = {}
      for (const pass of SPEED_PASSES) {
        audioByRate[pass.rate] = await ttsCached(s.zh, pass.rate)
      }

      for (const pass of SPEED_PASSES) {
        const overlay = await renderListeningOverlayNode({
          zh: s.zh,
          sentenceIndex: i,
          sentenceCount,
          rate: pass.rate,
          reveal: false,
          earIconPath: assets.earIcon,
        })
        plays.push({
          overlayBase64: overlay,
          audioBase64: audioByRate[pass.rate],
          sentenceIndex: i,
          rate: pass.rate,
          reveal: false,
          zh: s.zh,
          en: s.en,
          chimeAfter: false,
        })
      }

      const fullPass = SPEED_PASSES[SPEED_PASSES.length - 1]
      const overlayReveal = await renderListeningOverlayNode({
        zh: s.zh,
        sentenceIndex: i,
        sentenceCount,
        rate: fullPass.rate,
        reveal: true,
        earIconPath: assets.earIcon,
      })
      plays.push({
        overlayBase64: overlayReveal,
        audioBase64: audioByRate[fullPass.rate],
        sentenceIndex: i,
        rate: fullPass.rate,
        reveal: true,
        zh: s.zh,
        en: s.en,
        chimeAfter: true,
      })
    }

    onProgress?.({
      phase: 'render',
      message: `${config.id} Set ${set.setIndex}: encoding video…`,
    })
    const result = await renderListeningVideo({
      plays,
      gapSec,
      revealGapSec,
      sessionId: `${config.id}-set-${set.setIndex}`,
      onProgress,
      signal,
      chimePath: assets.chime,
      endFramePath: assets.endFrame,
    })

    ensureDirs()
    const srcRel = String(result.videoUrl || '').replace(/^\/output\//, '')
    const srcPath = path.join(OUTPUT_DIR, path.basename(srcRel))
    const videoPath = path.join(outDir, 'video.mp4')
    if (!fs.existsSync(srcPath)) throw new Error(`Rendered video missing: ${srcPath}`)
    fs.renameSync(srcPath, videoPath)

    const enSrt = buildListeningSrt(result.timeline, 'en')
    const srtPath = path.join(outDir, 'subtitles-en.srt')
    fs.writeFileSync(srtPath, enSrt, 'utf8')

    const { title, description } = buildTemplateMeta({
      titleTemplate: config.titleTemplate,
      descriptionTemplate: config.descriptionTemplate,
      playlistUrl: config.playlistUrl,
      setIndex: set.setIndex,
      firstWord,
      lastWord,
      phrases,
      timeline: result.timeline,
    })
    fs.writeFileSync(path.join(outDir, 'youtube.txt'), `${title}\n\n${description}\n`, 'utf8')

    onProgress?.({
      phase: 'thumbnail',
      message: `${config.id} Set ${set.setIndex}: thumbnail…`,
    })
    const thumbPath = path.join(outDir, 'thumbnail.png')
    await renderHsk1SetThumbnail({
      setIndex: set.setIndex,
      firstWord,
      lastWord,
      outPath: thumbPath,
      thumbnailBasePath: assets.thumbnailBase,
      thumbFontPath: assets.thumbFont,
      textColor: config.thumbnailTextColor,
    })

    const meta = {
      templateId: config.id,
      setIndex: set.setIndex,
      firstWord,
      lastWord,
      title,
      description,
      phraseCount: phrases.length,
      durationSec: result.durationSec,
      words: phrases.map((p) => ({
        no: p.no,
        word: p.word,
        pinyin: p.pinyin,
        translation: p.translation,
        zh: p.zh,
        en: p.en,
      })),
    }
    fs.writeFileSync(path.join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

    if (updateCatalog) {
      const catalog = loadCatalog()
      const existing = catalog.videos.find(
        (v) => v.id === videoIdFor(config.id, set.setIndex),
      )
      upsertVideo(catalog, {
        id: videoIdFor(config.id, set.setIndex),
        templateId: config.id,
        setIndex: set.setIndex,
        firstWord,
        lastWord,
        title,
        description,
        status: existing?.videoId ? existing.status : 'ready',
        packageDir: packageDirRel(config.id, set.setIndex),
        publishAt: existing?.publishAt || null,
        videoId: existing?.videoId || null,
        uploadedAt: existing?.uploadedAt || null,
        error: null,
      })
      saveCatalog(catalog)
    }

    return {
      templateId: config.id,
      setIndex: set.setIndex,
      packageDir: outDir,
      packageName: `${config.id}/Set_${set.setIndex}`,
      videoPath,
      thumbPath,
      srtPath,
      title,
      description,
      meta,
      timeline: result.timeline,
      durationSec: result.durationSec,
    }
  } catch (err) {
    if (updateCatalog) {
      const catalog = loadCatalog()
      upsertVideo(catalog, {
        id: videoIdFor(config.id, set.setIndex),
        templateId: config.id,
        setIndex: set.setIndex,
        firstWord,
        lastWord,
        status: 'failed',
        packageDir: packageDirRel(config.id, set.setIndex),
        error: err.message || String(err),
      })
      saveCatalog(catalog)
    }
    throw err
  }
}
