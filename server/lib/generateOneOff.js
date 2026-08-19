import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { synthesizeAzureMp3, normalizeRate, DEFAULT_VOICE } from './azureTts.js'
import { renderListeningVideo } from './listeningPipeline.js'
import { buildListeningSrt, chapterTimestamp } from './srt.js'
import { resolveTemplateAssets } from './templates.js'
import { renderListeningOverlayNode } from './listeningOverlayNode.js'
import { renderListeningThumbnail } from './listeningThumbnail.js'
import { sanitizePackageSegment } from './listeningMeta.js'
import { CACHE_DIR, OUTPUT_DIR, ensureDirs } from './paths.js'
import { loadCatalog, saveCatalog, upsertVideo, PLAYLIST_ID } from './catalog.js'

const SPEED_PASSES = [{ rate: '0.7' }, { rate: '0.85' }, { rate: 'default' }]
const CACHE_TAG = '48k-192'
const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`

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

function buildTimestamps(phrases, timeline) {
  return (Array.isArray(phrases) ? phrases : [])
    .map((s, i) => {
      const hit = (timeline || []).find(
        (t) => t.kind === 'play' && Number(t.sentenceIndex) === i,
      )
      const ts = chapterTimestamp(hit?.startSec ?? 0)
      const en = String(s.en || '').trim()
      return en
        ? `${ts} - Phrase ${i + 1}:\n${s.zh || ''}\n${en}`
        : `${ts} - Phrase ${i + 1}:\n${s.zh || ''}`
    })
    .join('\n')
}

function buildVocabList(phrases) {
  return (Array.isArray(phrases) ? phrases : [])
    .map((p) => String(p.zh || '').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Expand description placeholders. Throws if any {{…}} remain afterward.
 */
export function expandDescription(description, phrases, timeline) {
  const timestamps = buildTimestamps(phrases, timeline)
  const vocabList = buildVocabList(phrases)
  const expanded = String(description || '')
    .replace(/\{\{timestamps\}\}/g, timestamps)
    .replace(/\{\{playlistUrl\}\}/g, PLAYLIST_URL)
    .replace(/\{\{vocabList\}\}/g, vocabList)

  const leftover = [...expanded.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])
  if (leftover.length) {
    throw new Error(
      `Description still has unexpanded placeholders: ${[...new Set(leftover)].join(', ')}`,
    )
  }
  return expanded
}

export function makeGrammarSlug(thumbnailText) {
  const base = sanitizePackageSegment(thumbnailText) || 'grammar'
  const stamp = new Date().toISOString().slice(0, 10)
  const short = crypto.randomBytes(3).toString('hex')
  return `${base}_${stamp}_${short}`.slice(0, 80)
}

/**
 * Generate a one-off grammar listening package under output/grammar/{slug}/.
 * Catalog row is queued with the caller-provided publishAt.
 */
export async function generateOneOff({
  hskLevel,
  thumbnailText,
  title,
  description,
  phrases,
  publishAt,
  gapSec = 2,
  revealGapSec = 2,
  onProgress,
  signal,
  slug: slugIn,
} = {}) {
  const level = String(hskLevel ?? '1').trim() || '1'
  const thumbText = String(thumbnailText || '').replace(/\s+$/, '')
  const finalTitle = String(title || '').trim()
  const publish = String(publishAt || '').trim()
  const list = (Array.isArray(phrases) ? phrases : [])
    .map((p) => ({
      zh: String(p.zh || '').trim(),
      en: String(p.en || '').trim(),
    }))
    .filter((p) => p.zh)

  if (!thumbText.trim()) throw new Error('thumbnailText required')
  if (!finalTitle) throw new Error('title required')
  if (!String(description || '').trim()) throw new Error('description required')
  if (!publish) throw new Error('publishAt required')
  if (!list.length) throw new Error('phrases required')
  if (!Number.isFinite(Date.parse(publish))) {
    throw new Error('publishAt must be a valid datetime')
  }

  const assetTemplateId = `hsk${level}`
  let assets
  try {
    assets = resolveTemplateAssets(assetTemplateId)
  } catch (err) {
    throw new Error(
      `HSK ${level} template assets required for one-off videos (${err.message}). Seed/create the hsk${level} template first.`,
    )
  }

  const slug = slugIn || makeGrammarSlug(thumbText)
  const catalogId = `grammar:${slug}`
  const packageRel = `grammar/${slug}`
  const outDir = path.join(OUTPUT_DIR, 'grammar', slug)
  fs.mkdirSync(outDir, { recursive: true })

  const existing = loadCatalog().videos.find((v) => v.id === catalogId) || null

  {
    const catalog = loadCatalog()
    upsertVideo(catalog, {
      id: catalogId,
      templateId: 'grammar',
      setIndex: 0,
      firstWord: list[0]?.zh || '',
      lastWord: list[list.length - 1]?.zh || '',
      title: finalTitle,
      status: 'generating',
      packageDir: packageRel,
      publishAt: publish,
      videoId: existing?.videoId || null,
      uploadedAt: existing?.uploadedAt || null,
      error: null,
      hskLevel: level,
      thumbnailText: thumbText,
      phrases: list,
    })
    saveCatalog(catalog)
  }

  const plays = []
  const sentenceCount = list.length

  try {
    for (let i = 0; i < list.length; i++) {
      const s = list[i]
      onProgress?.({
        phase: 'tts',
        index: i + 1,
        total: sentenceCount,
        message: `grammar: phrase ${i + 1}/${sentenceCount} TTS…`,
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

    onProgress?.({ phase: 'render', message: 'grammar: encoding video…' })
    const result = await renderListeningVideo({
      plays,
      gapSec,
      revealGapSec,
      sessionId: `grammar-${slug}`,
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

    // Prefer English captions when present; otherwise Mandarin (grammar one-offs).
    const hasEn = list.some((p) => p.en)
    const srtBody = buildListeningSrt(result.timeline, hasEn ? 'en' : 'zh')
    const srtPath = path.join(outDir, 'subtitles-en.srt')
    fs.writeFileSync(srtPath, srtBody, 'utf8')

    const descriptionTemplate = String(description || '').trim()
    if (!descriptionTemplate) throw new Error('description required')
    const finalDescription = expandDescription(descriptionTemplate, list, result.timeline)
    if (!finalDescription.trim()) {
      throw new Error('description expanded to empty string')
    }
    fs.writeFileSync(
      path.join(outDir, 'youtube.txt'),
      `${finalTitle}\n\n${finalDescription}\n`,
      'utf8',
    )

    onProgress?.({ phase: 'thumbnail', message: 'grammar: thumbnail…' })
    const thumbPath = path.join(outDir, 'thumbnail.png')
    await renderListeningThumbnail({
      hskLevel: level,
      text: thumbText,
      outPath: thumbPath,
      signal,
    })

    const meta = {
      templateId: 'grammar',
      hskLevel: level,
      slug,
      thumbnailText: thumbText,
      title: finalTitle,
      descriptionTemplate,
      description: finalDescription,
      phraseCount: list.length,
      durationSec: result.durationSec,
      publishAt: publish,
      phrases: list,
    }
    fs.writeFileSync(path.join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

    const catalog = loadCatalog()
    const prev = catalog.videos.find((v) => v.id === catalogId)
    upsertVideo(catalog, {
      id: catalogId,
      templateId: 'grammar',
      setIndex: 0,
      firstWord: list[0]?.zh || '',
      lastWord: list[list.length - 1]?.zh || '',
      title: finalTitle,
      description: finalDescription,
      status: prev?.videoId ? prev.status : 'queued',
      packageDir: packageRel,
      publishAt: publish,
      videoId: prev?.videoId || null,
      uploadedAt: prev?.uploadedAt || null,
      error: null,
      hskLevel: level,
      thumbnailText: thumbText,
      phrases: list,
    })
    saveCatalog(catalog)

    return {
      id: catalogId,
      slug,
      packageDir: outDir,
      packageName: packageRel,
      videoPath,
      thumbPath,
      srtPath,
      title: finalTitle,
      description: finalDescription,
      publishAt: publish,
      meta,
      durationSec: result.durationSec,
    }
  } catch (err) {
    const catalog = loadCatalog()
    upsertVideo(catalog, {
      id: catalogId,
      templateId: 'grammar',
      setIndex: 0,
      status: 'failed',
      packageDir: packageRel,
      publishAt: publish,
      error: err.message || String(err),
      hskLevel: level,
      thumbnailText: thumbText,
      title: finalTitle,
    })
    saveCatalog(catalog)
    throw err
  }
}
