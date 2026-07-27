import fs from 'node:fs'
import path from 'node:path'
import { execa } from 'execa'
import { synthesizeAzureMp3 } from './azureTts.js'
import { OUTRO_WORKBOOK_MP3, PUBLIC_DIR, ensureDirs } from './paths.js'

/** Keep in sync with src/constants/bumpers.js */
const OUTRO_ZH = '欢迎点击下方文字栏，免费下载我的电子练习册！'

async function probeDuration(file) {
  try {
    const { stdout } = await execa('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ])
    const n = parseFloat(stdout.trim())
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

async function ensureOne({ outPath, text, force }) {
  const exists = fs.existsSync(outPath)
  if (exists && !force) {
    const durationSec = await probeDuration(outPath)
    return { path: outPath, durationSec, generated: false }
  }

  ensureDirs()
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })
  const buf = await synthesizeAzureMp3({ text, rate: 'default' })
  fs.writeFileSync(outPath, buf)
  const durationSec = await probeDuration(outPath)
  return { path: outPath, durationSec, generated: true }
}

/**
 * Ensure outro bumper MP3 exists under public/.
 * @param {{ force?: boolean }} [opts]
 */
export async function ensureBumperAudio({ force = false } = {}) {
  const outro = await ensureOne({
    outPath: OUTRO_WORKBOOK_MP3,
    text: OUTRO_ZH,
    force,
  })

  return {
    outro: {
      ...outro,
      relativeUrl: '/outro_workbook.mp3',
      fileName: path.basename(OUTRO_WORKBOOK_MP3),
    },
  }
}

export async function ensureBumperAudioHandler(c) {
  const body = await c.req.json().catch(() => ({}))
  const force = Boolean(body?.force)
  const result = await ensureBumperAudio({ force })
  return c.json(result)
}
