import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import { v4 as uuid } from 'uuid'
import { downloadImageTo } from './downloadImage.js'
import { ensureBumperAudio } from './ensureBumperAudio.js'
import {
  OUTPUT_DIR,
  TMP_DIR,
  RENDER_CACHE_DIR,
  TRANSITION_70_PNG,
  TRANSITION_85_PNG,
  TRANSITION_FULL_PNG,
  DOWNLOAD_WORKBOOK_PNG,
  OUTRO_WORKBOOK_MP3,
  BACKGROUND_MUSIC_MP3,
  ensureDirs,
} from './paths.js'

const DEFAULT_WIDTH = 720
const DEFAULT_HEIGHT = 1280
const FPS = 30
const TRANSITION_SEC = 3
const OUTRO_MIN_SEC = 5
/** Bed under narration — keep low so speech stays clear. */
const BACKGROUND_MUSIC_VOLUME = 0.22

/** Opening card before 70% pass (silent still). */
const OPENING_TRANSITION = {
  pngPath: TRANSITION_70_PNG,
  label: '70Speed',
}

/** After pass index 0 (70%) → 85 card; after pass 1 (85%) → full-speed card. */
const PASS_TRANSITIONS = [
  { afterPassIndex: 0, pngPath: TRANSITION_85_PNG, label: '85Speed' },
  { afterPassIndex: 1, pngPath: TRANSITION_FULL_PNG, label: 'FullSpeed' },
]

function writeBase64(dest, b64) {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '')
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
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
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
 * Ken Burns without zoompan (zoompan still shivers from integer crop/#4298).
 * Cover-fill → animate scale up → center onto fixed canvas via overlay (crop's eval=
 * frame is missing on some Windows FFmpeg builds) → downscale to export size.
 * WORK_SCALE 10 — prior smooth (slower) quality; overlay keeps zoom centered.
 */
const ZOOM_WORK_SCALE = 10
const ZOOM_STEP = 0.001
const ZOOM_MAX = 1.5

function evenDim(n) {
  const v = Math.max(2, Math.round(n))
  return v % 2 === 0 ? v : v + 1
}

/** Build [0:v]…[bg] filter graph fragment (centered Ken Burns at export size). */
function buildZoomBgGraph(durationSec, width, height) {
  const frames = Math.max(1, Math.round(durationSec * FPS))
  const workW = evenDim(width * ZOOM_WORK_SCALE)
  const workH = evenDim(height * ZOOM_WORK_SCALE)
  const denom = Math.max(1, frames - 1)
  const zoomEnd = Math.min(ZOOM_MAX, 1 + ZOOM_STEP * denom)
  const zoomDelta = Number((zoomEnd - 1).toFixed(6))
  const dur = Number(durationSec).toFixed(6)
  const prepZoom = [
    `scale=${workW}:${workH}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${workW}:${workH}`,
    `format=gbrp`,
    `scale=w='${workW}*(1+${zoomDelta}*n/${denom})':h='${workH}*(1+${zoomDelta}*n/${denom})':eval=frame:flags=bicubic`,
  ].join(',')
  return (
    `color=c=black:s=${workW}x${workH}:d=${dur}:r=${FPS}[canvas];` +
    `[0:v]${prepZoom}[zoomed];` +
    `[canvas][zoomed]overlay=x='(main_w-overlay_w)/2':y='(main_h-overlay_h)/2':shortest=1[bgfull];` +
    `[bgfull]scale=${width}:${height}:flags=lanczos,format=yuv420p,trim=duration=${dur},setpts=PTS-STARTPTS[bg]`
  )
}

/**
 * Still card (PNG) + optional overlay + audio (or silence).
 * Matches beat segment codec layout for concat.
 */
async function renderTransitionSegment({
  pngPath,
  outPath,
  width,
  height,
  signal,
  durationSec = TRANSITION_SEC,
  audioPath = null,
  overlayPath = null,
}) {
  if (!fs.existsSync(pngPath)) {
    throw new Error(`Transition image missing: ${pngPath}`)
  }
  const dur = Math.max(0.1, Number(durationSec) || TRANSITION_SEC)
  const durStr = dur.toFixed(6)
  const hasOverlay = Boolean(overlayPath && fs.existsSync(overlayPath))
  const hasAudio = Boolean(audioPath && fs.existsSync(audioPath))

  const scaleCrop = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${width}:${height}`,
    `fps=${FPS}`,
    `format=yuv420p`,
    `trim=duration=${durStr}`,
    `setpts=PTS-STARTPTS`,
  ].join(',')

  const args = ['-y', '-framerate', String(FPS), '-loop', '1', '-i', pngPath]
  let filter
  let audioMap

  if (hasOverlay) {
    args.push('-framerate', String(FPS), '-loop', '1', '-i', overlayPath)
    filter =
      `[0:v]${scaleCrop}[bg];` +
      `[1:v]fps=${FPS},trim=duration=${durStr},setpts=PTS-STARTPTS[ov];` +
      `[bg][ov]overlay=0:0:format=auto[outv]`
    if (hasAudio) {
      args.push('-i', audioPath)
      audioMap = '2:a'
    } else {
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=48000')
      audioMap = '2:a'
    }
  } else {
    filter = `[0:v]${scaleCrop}[outv]`
    if (hasAudio) {
      args.push('-i', audioPath)
      audioMap = '1:a'
    } else {
      args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=48000')
      audioMap = '1:a'
    }
  }

  args.push(
    '-filter_complex', filter,
    '-map', '[outv]',
    '-map', audioMap,
    '-t', String(dur),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '1',
    '-shortest',
    outPath,
  )

  await runFfmpeg(args, signal)
}

/**
 * Render beats into an MP4 at the chosen aspect (default 720×1280).
 * When `beatsPerPass` is set: 3s silent 70% card → passes + mid transitions → outro,
 * then mix BackgroundMusic.mp3 under the full timeline.
 *
 * Pass `sessionId` to reuse `.tmp/render/{sessionId}/` segment files across restarts
 * (skip FFmpeg when input hashes match).
 */
export async function renderVideo({
  beats,
  style,
  onProgress,
  signal,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  beatsPerPass = 0,
  outroOverlayBase64 = '',
  sessionId = '',
}) {
  const WIDTH = Number(width) || DEFAULT_WIDTH
  const HEIGHT = Number(height) || DEFAULT_HEIGHT
  const perPass = Number(beatsPerPass) > 0 ? Number(beatsPerPass) : 0
  ensureDirs()
  const cacheId = safeCacheId(sessionId)
  const jobId = cacheId || uuid()
  const work = cacheId
    ? path.join(RENDER_CACHE_DIR, cacheId)
    : path.join(TMP_DIR, jobId)
  fs.mkdirSync(work, { recursive: true })

  let segmentsEncoded = 0
  let segmentsSkipped = 0

  async function encodeTransitionCached({
    label,
    pngPath,
    outPath,
    durationSec,
    audioPath = null,
    overlayPath = null,
  }) {
    const hash = contentHash(
      'tr-v1',
      pngPath,
      WIDTH,
      HEIGHT,
      durationSec,
      audioPath || '',
      overlayPath && fs.existsSync(overlayPath) ? overlayPath : '',
      BACKGROUND_MUSIC_VOLUME,
    )
    if (isSegmentCacheHit(outPath, hash)) {
      segmentsSkipped += 1
      onProgress?.({ stage: 'transition', label, cached: true })
      return durationSec
    }
    await renderTransitionSegment({
      pngPath,
      outPath,
      width: WIDTH,
      height: HEIGHT,
      signal,
      durationSec,
      audioPath,
      overlayPath,
    })
    writeSegmentHash(outPath, hash)
    segmentsEncoded += 1
    return durationSec
  }

  try {
    const segmentPaths = []
    let cursor = 0

    if (perPass > 0) {
      assertNotAborted(signal)
      onProgress?.({ stage: 'transition', label: OPENING_TRANSITION.label, passIndex: -1 })
      const openPath = path.join(work, `transition_${OPENING_TRANSITION.label}.mp4`)
      const d = await encodeTransitionCached({
        label: OPENING_TRANSITION.label,
        pngPath: OPENING_TRANSITION.pngPath,
        outPath: openPath,
        durationSec: TRANSITION_SEC,
      })
      segmentPaths.push(openPath)
      cursor += d
    }

    for (let i = 0; i < beats.length; i++) {
      assertNotAborted(signal)
      const beat = beats[i]
      onProgress?.({ stage: 'segment', index: i, total: beats.length })

      const imgPath = path.join(work, `img_${i}.jpg`)
      const audioPath = path.join(work, `audio_${i}.mp3`)
      const overlayPath = path.join(work, `sub_${i}.png`)
      const segPath = path.join(work, `seg_${i}.mp4`)

      if (beat.imageBase64) writeBase64(imgPath, beat.imageBase64)
      else if (beat.imageUrl) {
        await downloadImageTo(beat.imageUrl, imgPath, {
          fallbackUrls: [beat.imageThumbnail, beat.thumbnail].filter(Boolean),
        })
      } else throw new Error(`Beat ${i} missing image`)

      assertNotAborted(signal)

      if (beat.audioBase64) writeBase64(audioPath, beat.audioBase64)
      else if (beat.audioPath && fs.existsSync(beat.audioPath)) {
        fs.copyFileSync(beat.audioPath, audioPath)
      } else throw new Error(`Beat ${i} missing audio`)

      const overlayB64 = beat.subtitleOverlayBase64 || beat.plateBase64
      if (!overlayB64) throw new Error(`Beat ${i} missing subtitle overlay`)
      writeBase64(overlayPath, overlayB64)

      const duration = beat.durationSec || (await probeDuration(audioPath, signal))
      beats[i] = { ...beat, durationSec: duration }

      const segHash = contentHash(
        'seg-v1',
        WIDTH,
        HEIGHT,
        duration,
        imgPath,
        audioPath,
        overlayPath,
      )

      if (isSegmentCacheHit(segPath, segHash)) {
        segmentsSkipped += 1
        onProgress?.({
          stage: 'segment',
          index: i,
          total: beats.length,
          cached: true,
        })
      } else {
        const dur = Number(duration).toFixed(6)
        const filter =
          `${buildZoomBgGraph(duration, WIDTH, HEIGHT)};` +
          `[1:v]fps=${FPS},trim=duration=${dur},setpts=PTS-STARTPTS[ov];` +
          `[bg][ov]overlay=0:0:format=auto[outv]`

        await runFfmpeg(
          [
            '-y',
            '-framerate', String(FPS),
            '-loop', '1',
            '-i', imgPath,
            '-framerate', String(FPS),
            '-loop', '1',
            '-i', overlayPath,
            '-i', audioPath,
            '-filter_complex', filter,
            '-map', '[outv]',
            '-map', '2:a',
            '-t', String(duration),
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '20',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-ar', '48000',
            '-ac', '1',
            segPath,
          ],
          signal,
        )
        writeSegmentHash(segPath, segHash)
        segmentsEncoded += 1
      }

      segmentPaths.push(segPath)
      cursor += duration

      if (perPass > 0 && (i + 1) % perPass === 0) {
        const passIndex = (i + 1) / perPass - 1
        const transition = PASS_TRANSITIONS.find((t) => t.afterPassIndex === passIndex)
        if (transition) {
          assertNotAborted(signal)
          onProgress?.({
            stage: 'transition',
            label: transition.label,
            passIndex,
          })
          const trPath = path.join(work, `transition_${transition.label}.mp4`)
          const d = await encodeTransitionCached({
            label: transition.label,
            pngPath: transition.pngPath,
            outPath: trPath,
            durationSec: TRANSITION_SEC,
          })
          segmentPaths.push(trPath)
          cursor += d
        }
      }
    }

    if (perPass > 0) {
      assertNotAborted(signal)
      onProgress?.({ stage: 'transition', label: 'OutroWorkbook', passIndex: 99 })
      if (!fs.existsSync(DOWNLOAD_WORKBOOK_PNG)) {
        throw new Error(`Outro image missing: ${DOWNLOAD_WORKBOOK_PNG}`)
      }
      const bumpers = await ensureBumperAudio()
      const outroOverlayPath = path.join(work, 'overlay_outro.png')
      if (outroOverlayBase64) writeBase64(outroOverlayPath, outroOverlayBase64)
      const audioDur =
        bumpers.outro.durationSec || (await probeDuration(OUTRO_WORKBOOK_MP3, signal))
      const outroDur = Math.max(OUTRO_MIN_SEC, audioDur || OUTRO_MIN_SEC)
      const outroPath = path.join(work, 'transition_outro.mp4')
      const d = await encodeTransitionCached({
        label: 'OutroWorkbook',
        pngPath: DOWNLOAD_WORKBOOK_PNG,
        outPath: outroPath,
        durationSec: outroDur,
        audioPath: OUTRO_WORKBOOK_MP3,
        overlayPath: outroOverlayBase64 ? outroOverlayPath : null,
      })
      segmentPaths.push(outroPath)
      cursor += d
    }

    assertNotAborted(signal)
    onProgress?.({
      stage: 'concat',
      total: beats.length,
      segmentsEncoded,
      segmentsSkipped,
    })

    const listFile = path.join(work, 'list.txt')
    fs.writeFileSync(
      listFile,
      segmentPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
    )

    const outName = `video_${jobId}.mp4`
    const outPath = path.join(OUTPUT_DIR, outName)
    const concatPath = path.join(work, 'concat_raw.mp4')

    // Always re-stitch + mix BGM (cheap vs Ken Burns) so the output file is fresh
    await runFfmpeg(
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', concatPath],
      signal,
    )

    if (fs.existsSync(BACKGROUND_MUSIC_MP3)) {
      onProgress?.({ stage: 'bgm', output: outName })
      assertNotAborted(signal)
      await runFfmpeg(
        [
          '-y',
          '-i', concatPath,
          '-stream_loop', '-1',
          '-i', BACKGROUND_MUSIC_MP3,
          '-filter_complex',
          `[1:a]volume=${BACKGROUND_MUSIC_VOLUME}[bg];` +
            `[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`,
          '-map', '0:v',
          '-map', '[aout]',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ar', '48000',
          '-ac', '1',
          '-shortest',
          outPath,
        ],
        signal,
      )
    } else {
      fs.copyFileSync(concatPath, outPath)
    }

    onProgress?.({
      stage: 'done',
      output: outName,
      durationSec: cursor,
      segmentsEncoded,
      segmentsSkipped,
    })
    return {
      outputPath: outPath,
      outputUrl: `/output/${outName}`,
      jobId,
      sessionId: cacheId || null,
      durationSec: cursor,
      width: WIDTH,
      height: HEIGHT,
      segmentsEncoded,
      segmentsSkipped,
    }
  } finally {
    /* keep work dir for segment cache / debugging */
  }
}
