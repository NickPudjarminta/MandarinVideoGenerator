import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '../..')
export const CACHE_DIR = path.join(ROOT, 'cache')
export const OUTPUT_DIR = path.join(ROOT, 'output')
export const TMP_DIR = path.join(ROOT, '.tmp')
export const DATA_DIR = path.join(ROOT, 'data')
export const PUBLIC_DIR = path.join(ROOT, 'public')
export const FONTS_DIR = path.join(PUBLIC_DIR, 'fonts')
export const CHIME_SFX_MP3 = path.join(PUBLIC_DIR, 'ChimeSFX.mp3')
export const END_FRAME_PNG = path.join(PUBLIC_DIR, 'EndFrame.png')
export const SESSIONS_DIR = path.join(TMP_DIR, 'sessions')
export const RENDER_CACHE_DIR = path.join(TMP_DIR, 'render')

export function ensureDirs() {
  for (const dir of [
    CACHE_DIR,
    OUTPUT_DIR,
    TMP_DIR,
    SESSIONS_DIR,
    RENDER_CACHE_DIR,
    path.join(CACHE_DIR, 'tts'),
    path.join(CACHE_DIR, 'images'),
  ]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
