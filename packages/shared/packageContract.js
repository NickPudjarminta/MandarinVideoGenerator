import fs from 'node:fs'
import path from 'node:path'

/**
 * Package contract: each finished video folder contains at least:
 * - video.mp4
 * - meta.json (title, description, gen metadata)
 * Optional: thumbnail.png, subtitles-en.srt, youtube.txt
 *
 * Layout:
 * - HSK: output/{templateId}/Set_N/
 * - Grammar: output/grammar/{slug}/
 */

export function isCompletePackage(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false
  return (
    fs.existsSync(path.join(dir, 'video.mp4')) &&
    fs.existsSync(path.join(dir, 'meta.json'))
  )
}

export function readMeta(dir) {
  const metaPath = path.join(dir, 'meta.json')
  if (!fs.existsSync(metaPath)) return null
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * @param {string} outputDir absolute path to output/
 * @returns {{ packageRel: string, absDir: string, kind: 'hsk'|'grammar', meta: object, id: string }[]}
 */
export function scanOutputPackages(outputDir) {
  const found = []
  if (!fs.existsSync(outputDir)) return found

  const grammarRoot = path.join(outputDir, 'grammar')
  if (fs.existsSync(grammarRoot) && fs.statSync(grammarRoot).isDirectory()) {
    for (const slug of fs.readdirSync(grammarRoot)) {
      const absDir = path.join(grammarRoot, slug)
      if (!isCompletePackage(absDir)) continue
      const meta = readMeta(absDir) || {}
      const packageRel = `grammar/${slug}`.replace(/\\/g, '/')
      const id = `grammar:${meta.slug || slug}`
      found.push({ packageRel, absDir, kind: 'grammar', meta, id, slug: meta.slug || slug })
    }
  }

  for (const name of fs.readdirSync(outputDir)) {
    if (name === 'grammar') continue
    const templateDir = path.join(outputDir, name)
    if (!fs.statSync(templateDir).isDirectory()) continue
    for (const entry of fs.readdirSync(templateDir)) {
      const m = entry.match(/^Set_(\d+)$/i)
      if (!m) continue
      const setIndex = Number(m[1])
      const absDir = path.join(templateDir, entry)
      if (!isCompletePackage(absDir)) continue
      const meta = readMeta(absDir) || {}
      const templateId = String(meta.templateId || name)
      const packageRel = `${name}/${entry}`.replace(/\\/g, '/')
      const id = `${templateId}:${setIndex}`
      found.push({
        packageRel,
        absDir,
        kind: 'hsk',
        meta,
        id,
        templateId,
        setIndex,
      })
    }
  }

  return found
}
