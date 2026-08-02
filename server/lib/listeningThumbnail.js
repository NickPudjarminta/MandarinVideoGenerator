import fs from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import { PUBLIC_DIR } from './paths.js'

const RUBIK_BOLD = path.join(PUBLIC_DIR, 'Rubik-Bold.ttf')

function escapeDrawtext(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
}

function fontfileForFfmpeg(fontPath) {
  // FFmpeg on Windows wants forward slashes; escape drive-letter colon
  return escapeDrawtext(path.resolve(fontPath).replace(/\\/g, '/'))
}

/**
 * Resolve HSK 1–3 thumbnail base + color. Returns null for 4+.
 */
export function resolveThumbnailStyle(hskLevel) {
  const level = Number.parseInt(String(hskLevel || '').trim(), 10)
  switch (level) {
    case 1:
      return {
        level: 1,
        basePath: path.join(PUBLIC_DIR, 'ThumbnailBase_HSK1.png'),
        color: '068791',
      }
    case 2:
      return {
        level: 2,
        basePath: path.join(PUBLIC_DIR, 'ThumbnailBase_HSK2.png'),
        color: 'EE6D08',
      }
    case 3:
      return {
        level: 3,
        basePath: path.join(PUBLIC_DIR, 'ThumbnailBase_HSK3.png'),
        color: 'BD0F19',
      }
    default:
      return null
  }
}

/**
 * Composite Chapter Index onto the HSK base thumbnail with Rubik Bold 85px at (60, 437).
 * @returns {Promise<string|null>} outPath, or null if skipped (HSK 4+)
 */
export async function renderListeningThumbnail({
  hskLevel,
  chapterIndex,
  outPath,
  signal,
}) {
  const style = resolveThumbnailStyle(hskLevel)
  if (!style) return null

  if (!fs.existsSync(style.basePath)) {
    throw new Error(`Thumbnail base missing: ${style.basePath}`)
  }
  if (!fs.existsSync(RUBIK_BOLD)) {
    throw new Error(`Rubik Bold font missing: ${RUBIK_BOLD}`)
  }

  const text = String(chapterIndex || '').trim()
  if (!text) {
    throw new Error('chapterIndex is required for thumbnail')
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })

  const vf =
    `drawtext=fontfile='${fontfileForFfmpeg(RUBIK_BOLD)}'` +
    `:text='${escapeDrawtext(text)}'` +
    `:x=60:y=437:fontsize=85:fontcolor=0x${style.color}`

  try {
    await execa(
      'ffmpeg',
      ['-y', '-i', style.basePath, '-vf', vf, '-frames:v', '1', outPath],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        cancelSignal: signal,
        killSignal: 'SIGKILL',
      },
    )
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

  return outPath
}
