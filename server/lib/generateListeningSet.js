import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { synthesizeAzureMp3, normalizeRate, DEFAULT_VOICE } from './azureTts.js'
import { renderListeningVideo } from './listeningPipeline.js'
import { buildListeningSrt } from './srt.js'
import { getSet } from './hsk1Sets.js'
import { buildHsk1SetMeta } from './hsk1SetMeta.js'
import {
  renderListeningOverlayNode,
  renderHsk1SetThumbnail,
} from './listeningOverlayNode.js'
import { CACHE_DIR, OUTPUT_DIR, ensureDirs } from './paths.js'
import { packageDirForSet } from './autopilotState.js'

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
 * Generate a full HSK1 listening set package under output/HSK1_Set_N/.
 */
export async function generateListeningSet({
  setIndex,
  gapSec = 2,
  revealGapSec = 2,
  onProgress,
  signal,
} = {}) {
  const set = await getSet(setIndex)
  const { phrases, firstWord, lastWord } = set
  const packageDir = packageDirForSet(set.setIndex)
  fs.mkdirSync(packageDir, { recursive: true })

  const plays = []
  const sentenceCount = phrases.length

  for (let i = 0; i < phrases.length; i++) {
    const s = phrases[i]
    onProgress?.({
      phase: 'tts',
      index: i + 1,
      total: sentenceCount,
      message: `Set ${set.setIndex}: phrase ${i + 1}/${sentenceCount} TTS…`,
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

  onProgress?.({ phase: 'render', message: `Set ${set.setIndex}: encoding video…` })
  const result = await renderListeningVideo({
    plays,
    gapSec,
    revealGapSec,
    sessionId: `hsk1-set-${set.setIndex}`,
    onProgress,
    signal,
  })

  ensureDirs()
  const srcRel = String(result.videoUrl || '').replace(/^\/output\//, '')
  const srcPath = path.join(OUTPUT_DIR, path.basename(srcRel))
  const videoPath = path.join(packageDir, 'video.mp4')
  if (!fs.existsSync(srcPath)) throw new Error(`Rendered video missing: ${srcPath}`)
  fs.renameSync(srcPath, videoPath)

  const enSrt = buildListeningSrt(result.timeline, 'en')
  const srtPath = path.join(packageDir, 'subtitles-en.srt')
  fs.writeFileSync(srtPath, enSrt, 'utf8')

  const { title, description } = buildHsk1SetMeta({
    setIndex: set.setIndex,
    firstWord,
    lastWord,
    phrases,
    timeline: result.timeline,
  })
  fs.writeFileSync(path.join(packageDir, 'youtube.txt'), `${title}\n\n${description}\n`, 'utf8')

  onProgress?.({ phase: 'thumbnail', message: `Set ${set.setIndex}: thumbnail…` })
  const thumbPath = path.join(packageDir, 'thumbnail.png')
  await renderHsk1SetThumbnail({ firstWord, lastWord, outPath: thumbPath })

  const meta = {
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
  fs.writeFileSync(path.join(packageDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

  return {
    setIndex: set.setIndex,
    packageDir,
    packageName: `HSK1_Set_${set.setIndex}`,
    videoPath,
    thumbPath,
    srtPath,
    title,
    description,
    meta,
    timeline: result.timeline,
    durationSec: result.durationSec,
  }
}
