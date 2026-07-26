import fs from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import { v4 as uuid } from 'uuid'
import { downloadImageTo } from './downloadImage.js'
import {
  OUTPUT_DIR,
  TMP_DIR,
  TRANSITION_70_PNG,
  TRANSITION_85_PNG,
  TRANSITION_FULL_PNG,
  ensureDirs,
} from './paths.js'

const DEFAULT_WIDTH = 720
const DEFAULT_HEIGHT = 1280
const FPS = 30
const TRANSITION_SEC = 3

/** Opening card before 70% pass. */
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
  // z(n) = 1 + zoomDelta * n / denom — scale up, then overlay-center onto work canvas
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

/** 1s still card (PNG) + silent mono AAC — matches beat segment codec layout for concat. */
async function renderTransitionSegment({ pngPath, outPath, width, height, signal }) {
  if (!fs.existsSync(pngPath)) {
    throw new Error(`Transition image missing: ${pngPath}`)
  }
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${width}:${height}`,
    `fps=${FPS}`,
    `format=yuv420p`,
    `trim=duration=${TRANSITION_SEC}`,
    `setpts=PTS-STARTPTS`,
  ].join(',')

  await runFfmpeg(
    [
      '-y',
      '-framerate', String(FPS),
      '-loop', '1',
      '-i', pngPath,
      '-f', 'lavfi',
      '-i', `anullsrc=channel_layout=mono:sample_rate=48000`,
      '-filter_complex', `[0:v]${filter}[outv]`,
      '-map', '[outv]',
      '-map', '1:a',
      '-t', String(TRANSITION_SEC),
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
    ],
    signal,
  )
}

/**
 * Render beats into an MP4 at the chosen aspect (default 720×1280).
 * Pass `signal` (AbortSignal) to cancel mid-FFmpeg.
 * When `beatsPerPass` is set (triple-speed render), inserts transition PNGs
 * before the first pass and between passes (TRANSITION_SEC each).
 */
export async function renderVideo({
  beats,
  style,
  onProgress,
  signal,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  beatsPerPass = 0,
}) {
  const WIDTH = Number(width) || DEFAULT_WIDTH
  const HEIGHT = Number(height) || DEFAULT_HEIGHT
  const perPass = Number(beatsPerPass) > 0 ? Number(beatsPerPass) : 0
  ensureDirs()
  const jobId = uuid()
  const work = path.join(TMP_DIR, jobId)
  fs.mkdirSync(work, { recursive: true })

  try {
    const segmentPaths = []
    let cursor = 0

    if (perPass > 0) {
      assertNotAborted(signal)
      onProgress?.({ stage: 'transition', label: OPENING_TRANSITION.label, passIndex: -1 })
      const openPath = path.join(work, `transition_${OPENING_TRANSITION.label}.mp4`)
      await renderTransitionSegment({
        pngPath: OPENING_TRANSITION.pngPath,
        outPath: openPath,
        width: WIDTH,
        height: HEIGHT,
        signal,
      })
      segmentPaths.push(openPath)
      cursor += TRANSITION_SEC
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

      const dur = Number(duration).toFixed(6)
      // Subtitle overlay stays static; photo Ken Burns is centered via overlay (not crop eval)
      const filter =
        `${buildZoomBgGraph(duration, WIDTH, HEIGHT)};` +
        `[1:v]fps=${FPS},trim=duration=${dur},setpts=PTS-STARTPTS[ov];` +
        `[bg][ov]overlay=0:0:format=auto[outv]`

      await runFfmpeg(
        [
          '-y',
          // -framerate on still input = 30 real frames/sec (required for zoompan)
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

      segmentPaths.push(segPath)
      cursor += duration

      // Between speed passes: transition cards (after 70% → 85 card; after 85% → full card)
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
          await renderTransitionSegment({
            pngPath: transition.pngPath,
            outPath: trPath,
            width: WIDTH,
            height: HEIGHT,
            signal,
          })
          segmentPaths.push(trPath)
          cursor += TRANSITION_SEC
        }
      }
    }

    assertNotAborted(signal)
    onProgress?.({ stage: 'concat', total: beats.length })

    const listFile = path.join(work, 'list.txt')
    fs.writeFileSync(
      listFile,
      segmentPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
    )

    const outName = `video_${jobId}.mp4`
    const outPath = path.join(OUTPUT_DIR, outName)

    await runFfmpeg(
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outPath],
      signal,
    )

    onProgress?.({ stage: 'done', output: outName, durationSec: cursor })
    return {
      outputPath: outPath,
      outputUrl: `/output/${outName}`,
      jobId,
      durationSec: cursor,
      width: WIDTH,
      height: HEIGHT,
    }
  } finally {
    /* keep work dir for debugging */
  }
}
