import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import { v4 as uuid } from 'uuid'
import {
  OUTPUT_DIR,
  RENDER_CACHE_DIR,
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
 * Still PNG + optional audio for a fixed duration.
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
 * Render listening practice video from a flat ordered play list.
 *
 * @param {object} opts
 * @param {Array} opts.plays — ordered plays: { overlayBase64, audioBase64, sentenceIndex, rate, reveal, zh, en, chimeAfter? }
 * @param {number} opts.gapSec — silence after plays 1–3
 * @param {number} opts.revealGapSec — silence after chime following the with-text (4th) play
 * @param {string} opts.sessionId
 */
export async function renderListeningVideo({
  plays,
  gapSec = 2,
  revealGapSec = 2,
  sessionId = '',
  onProgress,
  signal,
}) {
  ensureDirs()
  const cacheId = safeCacheId(sessionId)
  const jobId = cacheId ? `lp-${cacheId}` : `lp-${uuid()}`
  const work = path.join(RENDER_CACHE_DIR, jobId)
  fs.mkdirSync(work, { recursive: true })

  const playList = Array.isArray(plays) ? plays : []
  if (!playList.length) {
    throw new Error('Listening render expects a non-empty plays array')
  }

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

  let lastOverlayPath = null

  for (let i = 0; i < playList.length; i++) {
    assertNotAborted(signal)
    const play = playList[i]
    const isChimeAfter = Boolean(play.chimeAfter)
    // Reveal play: no post-speech pad — chime plays immediately, then revealGapSec silence
    const playGap = isChimeAfter ? 0 : gapSec

    onProgress?.({
      phase: 'plays',
      index: i + 1,
      total: playList.length,
      message: `Encoding play ${i + 1}/${playList.length}…`,
    })

    const overlayPath = path.join(work, `ov_${segIndex}.png`)
    const audioPath = path.join(work, `au_${segIndex}.mp3`)
    const outPath = path.join(work, `seg_${String(segIndex).padStart(4, '0')}.mp4`)

    writeBase64(overlayPath, play.overlayBase64)
    writeBase64(audioPath, play.audioBase64)
    lastOverlayPath = overlayPath

    const hash = contentHash(
      'lp-play-v2',
      overlayPath,
      audioPath,
      String(playGap),
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
        gapSec: playGap,
        signal,
      })
      writeSegmentHash(outPath, hash)
    }

    segmentPaths.push(outPath)
    pushTimeline(
      {
        kind: 'play',
        rate: String(play.rate || 'default'),
        reveal: play.reveal !== false && play.slide !== 'A',
        sentenceIndex: Number(play.sentenceIndex) || 0,
        zh: play.zh || '',
        en: play.en || '',
      },
      duration,
    )
    segIndex += 1

    // After With-Text 100%: chime immediately, then reveal-gap silence on last frame
    if (isChimeAfter) {
      if (!fs.existsSync(CHIME_SFX_MP3)) {
        throw new Error(`Chime SFX missing: ${CHIME_SFX_MP3}`)
      }
      const chimeDur = await probeDuration(CHIME_SFX_MP3, signal)
      const chimeOut = path.join(work, `seg_${String(segIndex).padStart(4, '0')}.mp4`)
      const chimeHash = contentHash(
        'lp-chime-v1',
        lastOverlayPath,
        CHIME_SFX_MP3,
        String(chimeDur),
        WIDTH,
        HEIGHT,
      )
      let chimeDuration
      if (isSegmentCacheHit(chimeOut, chimeHash)) {
        chimeDuration = await probeDuration(chimeOut, signal)
      } else {
        chimeDuration = await renderStillSegment({
          pngPath: lastOverlayPath,
          outPath: chimeOut,
          durationSec: chimeDur,
          audioPath: CHIME_SFX_MP3,
          signal,
        })
        writeSegmentHash(chimeOut, chimeHash)
      }
      segmentPaths.push(chimeOut)
      pushTimeline(
        {
          kind: 'chime',
          sentenceIndex: Number(play.sentenceIndex) || 0,
        },
        chimeDuration,
      )
      segIndex += 1

      const afterRevealGap = Math.max(0, Number(revealGapSec) || 0)
      if (afterRevealGap > 0) {
        const gapOut = path.join(work, `seg_${String(segIndex).padStart(4, '0')}.mp4`)
        const gapHash = contentHash(
          'lp-reveal-gap-v1',
          lastOverlayPath,
          String(afterRevealGap),
          WIDTH,
          HEIGHT,
        )
        let gapDuration
        if (isSegmentCacheHit(gapOut, gapHash)) {
          gapDuration = await probeDuration(gapOut, signal)
        } else {
          gapDuration = await renderStillSegment({
            pngPath: lastOverlayPath,
            outPath: gapOut,
            durationSec: afterRevealGap,
            audioPath: null,
            signal,
          })
          writeSegmentHash(gapOut, gapHash)
        }
        segmentPaths.push(gapOut)
        pushTimeline(
          {
            kind: 'revealGap',
            sentenceIndex: Number(play.sentenceIndex) || 0,
          },
          gapDuration,
        )
        segIndex += 1
      }
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
