import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import { v4 as uuid } from 'uuid'
import {
  OUTPUT_DIR,
  TMP_DIR,
  RENDER_CACHE_DIR,
  TRANSITION_AT_85_PNG,
  TRANSITION_AT_100_PNG,
  CHIME_SFX_MP3,
  END_FRAME_PNG,
  ensureDirs,
} from './paths.js'

const WIDTH = 1280
const HEIGHT = 720
const FPS = 30
const END_FRAME_SEC = 5

function writeBase64(dest, b64) {
  const cleaned = String(b64 || '').replace(/^data:[^;]+;base64,/, '')
  fs.writeFileSync(dest, Buffer.from(cleaned, 'base64'))
  return dest
}

function contentHash(...parts) {
  const h = crypto.createHash('sha256')
  for (const p of parts) {
    if (p == null) continue
    if (Buffer.isBuffer(p)) h.update(p)
    else if (typeof p === 'string' && p.length < 4096 && fs.existsSync(p) && fs.statSync(p).isFile()) {
      h.update(fs.readFileSync(p))
    } else {
      h.update(String(p))
    }
  }
  return h.digest('hex').slice(0, 20)
}

function isSegmentCacheHit(outPath, hash) {
  const hp = `${outPath}.hash`
  return (
    fs.existsSync(outPath) &&
    fs.statSync(outPath).size > 0 &&
    fs.existsSync(hp) &&
    fs.readFileSync(hp, 'utf8').trim() === hash
  )
}

function writeSegmentHash(outPath, hash) {
  fs.writeFileSync(`${outPath}.hash`, hash)
}

function safeCacheId(sessionId) {
  const s = String(sessionId || '').trim()
  if (!s) return ''
  const base = path.basename(s)
  return base === s ? s : ''
}

function assertNotAborted(signal) {
  if (signal?.aborted) {
    const err = new Error('Render cancelled')
    err.name = 'AbortError'
    throw err
  }
}

async function runFfmpeg(args, signal) {
  assertNotAborted(signal)
  try {
    await execa('ffmpeg', args, {
      stdout: 'pipe',
      stderr: 'pipe',
      cancelSignal: signal,
      killSignal: 'SIGKILL',
    })
  } catch (err) {
    if (signal?.aborted || err.isCanceled || err.shortMessage?.includes('was killed')) {
      const abortErr = new Error('Render cancelled')
      abortErr.name = 'AbortError'
      throw abortErr
    }
    const stderr = String(err.stderr || '').trim()
    if (stderr) {
      const short = stderr.split(/\r?\n/).filter(Boolean).slice(-8).join('\n')
      err.message = `${err.message}\n${short}`
    }
    throw err
  }
}

async function probeDuration(file, signal) {
  assertNotAborted(signal)
  try {
    const { stdout } = await execa(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        file,
      ],
      { cancelSignal: signal },
    )
    const n = parseFloat(stdout.trim())
    return Number.isFinite(n) ? n : 2
  } catch {
    assertNotAborted(signal)
    return 2
  }
}

/**
 * Full-frame PNG overlay + TTS audio, padded with gapSec silence after speech.
 */
async function renderPlaySegment({
  overlayPath,
  audioPath,
  outPath,
  gapSec,
  signal,
}) {
  const audioDur = await probeDuration(audioPath, signal)
  const gap = Math.max(0, Number(gapSec) || 0)
  const totalDur = Math.max(0.1, audioDur + gap)
  const durStr = totalDur.toFixed(6)

  const scaleCrop = [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${WIDTH}:${HEIGHT}`,
    `fps=${FPS}`,
    `format=yuv420p`,
    `trim=duration=${durStr}`,
    `setpts=PTS-STARTPTS`,
  ].join(',')

  const args = [
    '-y',
    '-framerate',
    String(FPS),
    '-loop',
    '1',
    '-i',
    overlayPath,
    '-i',
    audioPath,
    '-filter_complex',
    `[0:v]${scaleCrop}[outv];` +
      `[1:a]apad=pad_dur=${gap.toFixed(6)},atrim=0:${durStr},asetpts=PTS-STARTPTS,` +
      `aformat=sample_rates=48000:channel_layouts=mono[outa]`,
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-t',
    String(totalDur),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '1',
    '-shortest',
    outPath,
  ]

  await runFfmpeg(args, signal)
  return totalDur
}

/**
 * Still PNG + optional chime SFX for transitionSec.
 */
async function renderStillSegment({
  pngPath,
  outPath,
  durationSec,
  audioPath = null,
  signal,
}) {
  if (!fs.existsSync(pngPath)) {
    throw new Error(`Image missing: ${pngPath}`)
  }
  const dur = Math.max(0.1, Number(durationSec) || 3)
  const durStr = dur.toFixed(6)
  const hasAudio = Boolean(audioPath && fs.existsSync(audioPath))

  const scaleCrop = [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${WIDTH}:${HEIGHT}`,
    `fps=${FPS}`,
    `format=yuv420p`,
    `trim=duration=${durStr}`,
    `setpts=PTS-STARTPTS`,
  ].join(',')

  const args = ['-y', '-framerate', String(FPS), '-loop', '1', '-i', pngPath]
  let filter
  let audioMap

  if (hasAudio) {
    args.push('-i', audioPath)
    filter =
      `[0:v]${scaleCrop}[outv];` +
      `[1:a]apad=whole_dur=${durStr},atrim=0:${durStr},asetpts=PTS-STARTPTS,` +
      `aformat=sample_rates=48000:channel_layouts=mono[outa]`
    audioMap = '[outa]'
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=48000')
    filter = `[0:v]${scaleCrop}[outv]`
    audioMap = '1:a'
  }

  args.push(
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-map',
    audioMap,
    '-t',
    String(dur),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '1',
    '-shortest',
    outPath,
  )

  await runFfmpeg(args, signal)
  return dur
}

/**
 * Render listening practice video.
 *
 * @param {object} opts
 * @param {Array<{rate:string, plays:Array}>} opts.passes — 3 speed passes; each play has overlayBase64, audioBase64, sentenceIndex, slide, zh, en
 * @param {number} opts.gapSec
 * @param {number} opts.transitionSec
 * @param {string} opts.sessionId
 */
export async function renderListeningVideo({
  passes,
  gapSec = 1,
  transitionSec = 3,
  sessionId = '',
  onProgress,
  signal,
}) {
  ensureDirs()
  const cacheId = safeCacheId(sessionId)
  const jobId = cacheId ? `lp-${cacheId}` : `lp-${uuid()}`
  const work = path.join(RENDER_CACHE_DIR, jobId)
  fs.mkdirSync(work, { recursive: true })

  const segmentPaths = []
  const timeline = []
  let cursor = 0
  let segIndex = 0

  const pushTimeline = (entry, duration) => {
    const startSec = cursor
    const endSec = cursor + duration
    timeline.push({ ...entry, startSec, endSec })
    cursor = endSec
  }

  const passList = Array.isArray(passes) ? passes : []
  if (passList.length !== 3) {
    throw new Error('Listening render expects exactly 3 speed passes')
  }

  for (let p = 0; p < passList.length; p++) {
    const pass = passList[p]
    const rate = String(pass.rate || 'default')
    const plays = Array.isArray(pass.plays) ? pass.plays : []
    onProgress?.({
      phase: 'plays',
      pass: p + 1,
      message: `Encoding pass ${p + 1}/3…`,
    })

    for (let i = 0; i < plays.length; i++) {
      assertNotAborted(signal)
      const play = plays[i]
      const overlayPath = path.join(work, `ov_${segIndex}.png`)
      const audioPath = path.join(work, `au_${segIndex}.mp3`)
      const outPath = path.join(work, `seg_${String(segIndex).padStart(4, '0')}.mp4`)

      writeBase64(overlayPath, play.overlayBase64)
      writeBase64(audioPath, play.audioBase64)

      const hash = contentHash(
        'lp-play-v1',
        overlayPath,
        audioPath,
        String(gapSec),
        WIDTH,
        HEIGHT,
      )
      let duration
      if (isSegmentCacheHit(outPath, hash)) {
        duration = await probeDuration(outPath, signal)
      } else {
        duration = await renderPlaySegment({
          overlayPath,
          audioPath,
          outPath,
          gapSec,
          signal,
        })
        writeSegmentHash(outPath, hash)
      }

      segmentPaths.push(outPath)
      pushTimeline(
        {
          kind: 'play',
          pass: p,
          rate,
          slide: play.slide || (i % 2 === 0 ? 'A' : 'B'),
          sentenceIndex: Number(play.sentenceIndex) || 0,
          zh: play.zh || '',
          en: play.en || '',
        },
        duration,
      )
      segIndex += 1
    }

    // Transitions after pass 0 (→85) and pass 1 (→100) only
    if (p === 0 || p === 1) {
      const pngPath = p === 0 ? TRANSITION_AT_85_PNG : TRANSITION_AT_100_PNG
      const label = p === 0 ? '85' : '100'
      const outPath = path.join(work, `seg_${String(segIndex).padStart(4, '0')}.mp4`)
      const hash = contentHash(
        'lp-trans-v1',
        pngPath,
        CHIME_SFX_MP3,
        String(transitionSec),
        WIDTH,
        HEIGHT,
      )
      let duration
      if (isSegmentCacheHit(outPath, hash)) {
        duration = await probeDuration(outPath, signal)
      } else {
        duration = await renderStillSegment({
          pngPath,
          outPath,
          durationSec: transitionSec,
          audioPath: CHIME_SFX_MP3,
          signal,
        })
        writeSegmentHash(outPath, hash)
      }
      segmentPaths.push(outPath)
      pushTimeline(
        {
          kind: 'transition',
          which: label,
          zh: label === '85' ? '现在用中速 85%' : '现在用原速 100%',
          en: label === '85' ? 'Now at 85% speed' : 'Now at full speed',
        },
        duration,
      )
      segIndex += 1
    }
  }

  // End frame 5s silent
  {
    onProgress?.({ phase: 'end', message: 'Encoding end frame…' })
    const outPath = path.join(work, `seg_${String(segIndex).padStart(4, '0')}.mp4`)
    const hash = contentHash('lp-end-v1', END_FRAME_PNG, String(END_FRAME_SEC), WIDTH, HEIGHT)
    let duration
    if (isSegmentCacheHit(outPath, hash)) {
      duration = await probeDuration(outPath, signal)
    } else {
      duration = await renderStillSegment({
        pngPath: END_FRAME_PNG,
        outPath,
        durationSec: END_FRAME_SEC,
        audioPath: null,
        signal,
      })
      writeSegmentHash(outPath, hash)
    }
    segmentPaths.push(outPath)
    pushTimeline({ kind: 'end' }, duration)
  }

  onProgress?.({ phase: 'concat', message: 'Concatenating…' })
  const listPath = path.join(work, 'list.txt')
  fs.writeFileSync(
    listPath,
    segmentPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
  )

  const outName = `listening-${uuid()}.mp4`
  const outFile = path.join(OUTPUT_DIR, outName)
  await runFfmpeg(
    ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outFile],
    signal,
  )

  return {
    videoUrl: `/output/${outName}`,
    timeline,
    durationSec: cursor,
    workDir: work,
  }
}
