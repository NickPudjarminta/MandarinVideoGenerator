import path from 'node:path'
import { scanOutputPackages } from '../../packages/shared/packageContract.js'
import { loadCatalog, saveCatalog, upsertVideo } from './catalog.js'
import { OUTPUT_DIR } from './paths.js'

/**
 * Scan output/** for complete packages not yet in catalog and add as `ready`.
 * Does not assign publishAt — scheduler queue-uploads owns that.
 */
export function importPackages() {
  const catalog = loadCatalog()
  const existing = new Set(catalog.videos.map((v) => v.id))
  const byPackage = new Map(
    catalog.videos
      .filter((v) => v.packageDir)
      .map((v) => [String(v.packageDir).replace(/\\/g, '/'), v]),
  )

  const scanned = scanOutputPackages(OUTPUT_DIR)
  const imported = []
  const skipped = []

  for (const pkg of scanned) {
    const rel = pkg.packageRel.replace(/\\/g, '/')
    if (existing.has(pkg.id) || byPackage.has(rel)) {
      skipped.push({ id: pkg.id, packageDir: rel, reason: 'already in catalog' })
      continue
    }

    const meta = pkg.meta || {}
    if (pkg.kind === 'grammar') {
      const phrases = Array.isArray(meta.phrases) ? meta.phrases : []
      upsertVideo(catalog, {
        id: pkg.id,
        templateId: 'grammar',
        setIndex: 0,
        firstWord: phrases[0]?.zh || '',
        lastWord: phrases[phrases.length - 1]?.zh || '',
        title: meta.title || '',
        description: meta.description || '',
        status: 'ready',
        packageDir: rel,
        publishAt: null,
        videoId: null,
        uploadedAt: null,
        error: null,
        hskLevel: String(meta.hskLevel || '1'),
        thumbnailText: meta.thumbnailText || '',
        phrases,
      })
    } else {
      upsertVideo(catalog, {
        id: pkg.id,
        templateId: pkg.templateId,
        setIndex: pkg.setIndex,
        firstWord: meta.firstWord || '',
        lastWord: meta.lastWord || '',
        title: meta.title || '',
        description: meta.description || '',
        status: 'ready',
        packageDir: rel,
        publishAt: null,
        videoId: null,
        uploadedAt: null,
        error: null,
      })
    }
    existing.add(pkg.id)
    imported.push({ id: pkg.id, packageDir: rel, kind: pkg.kind })
  }

  if (imported.length) saveCatalog(catalog)
  return {
    imported,
    skippedCount: skipped.length,
    scannedCount: scanned.length,
    count: imported.length,
  }
}

export function resolvePackageAbs(video) {
  if (!video?.packageDir) return null
  return path.isAbsolute(video.packageDir)
    ? video.packageDir
    : path.join(OUTPUT_DIR, video.packageDir)
}
