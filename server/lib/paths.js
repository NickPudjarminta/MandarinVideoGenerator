import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(__dirname, '../..')
export const CACHE_DIR = path.join(ROOT, 'cache')
export const OUTPUT_DIR = path.join(ROOT, 'output')
export const TMP_DIR = path.join(ROOT, '.tmp')
export const PUBLIC_DIR = path.join(ROOT, 'public')
export const FONTS_DIR = path.join(PUBLIC_DIR, 'fonts')
export const HSK_PATH = path.join(PUBLIC_DIR, 'hsk_wordlist.json')
export const TRANSITION_70_PNG = path.join(PUBLIC_DIR, '70Speed_Transition.png')
export const TRANSITION_85_PNG = path.join(PUBLIC_DIR, '85Speed_Transition.png')
export const TRANSITION_FULL_PNG = path.join(PUBLIC_DIR, 'FullSpeed_Transition.png')

export function ensureDirs() {
  for (const dir of [CACHE_DIR, OUTPUT_DIR, TMP_DIR, path.join(CACHE_DIR, 'tts'), path.join(CACHE_DIR, 'images')]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
