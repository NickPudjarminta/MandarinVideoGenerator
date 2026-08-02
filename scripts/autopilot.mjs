#!/usr/bin/env node
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { getSet, setCount, loadHsk1Rows } from '../server/lib/hsk1Sets.js'
import { generateListeningSet } from '../server/lib/generateListeningSet.js'
import {
  loadAutopilotState,
  packageExists,
  packageDirForSet,
} from '../server/lib/autopilotState.js'
import { RENDER_CACHE_DIR } from '../server/lib/paths.js'
import { uploadSetPackage } from './uploadNext.mjs'

function usage() {
  console.log(`HSK 1 Autopilot (manual)

  npm run autopilot:generate 2       Generate set 2 (omit number → nextSetIndex)
  npm run autopilot:regenerate 2     Wipe package + render cache, then regenerate
  npm run autopilot:upload 2         Upload set 2 to YouTube
  npm run autopilot 2                Generate (if needed) then upload set 2

No Task Scheduler — run these yourself when ready.
`)
}

/** Parse set arg. Strips optional [] from docs-style typing. */
function resolveSetIndex(setIndex, { required = false } = {}) {
  const state = loadAutopilotState()
  if (setIndex == null || String(setIndex).trim() === '') {
    if (required) {
      throw new Error('Set number required. Example: npm run autopilot:regenerate 2')
    }
    return state.nextSetIndex
  }
  const raw = String(setIndex).trim().replace(/^\[(.+)\]$/, '$1')
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid set number: ${JSON.stringify(setIndex)}. Example: npm run autopilot:regenerate 2`)
  }
  return n
}

function wipeSetArtifacts(n) {
  const packageDir = packageDirForSet(n)
  if (fs.existsSync(packageDir)) {
    fs.rmSync(packageDir, { recursive: true, force: true })
    console.log(`Deleted package: ${packageDir}`)
  }
  // sessionId in generateListeningSet is `hsk1-set-${n}` → work dir lp-hsk1-set-N
  const renderDir = path.join(RENDER_CACHE_DIR, `lp-hsk1-set-${n}`)
  if (fs.existsSync(renderDir)) {
    fs.rmSync(renderDir, { recursive: true, force: true })
    console.log(`Deleted render cache: ${renderDir}`)
  }
}

async function cmdGenerate(setIndex, { force = false } = {}) {
  const rows = await loadHsk1Rows()
  const total = setCount(rows.length)
  const n = resolveSetIndex(setIndex, { required: force })
  if (n > total) {
    if (force) {
      throw new Error(`Set ${n} is out of range (1–${total}).`)
    }
    console.log(`All ${total} sets are done. Nothing to generate.`)
    return null
  }

  if (!force && packageExists(n)) {
    console.log(`Package already exists: ${packageDirForSet(n)}`)
    const set = await getSet(n)
    console.log(`Set ${n}: ${set.firstWord} → ${set.lastWord} (${set.phrases.length} phrases)`)
    console.log(`To rebuild: npm run autopilot:regenerate ${n}`)
    return { setIndex: n, skipped: true, packageDir: packageDirForSet(n) }
  }

  if (force) wipeSetArtifacts(n)

  console.log(`Generating Set ${n} of ${total}…`)
  const result = await generateListeningSet({
    setIndex: n,
    onProgress: (p) => {
      if (p?.message) console.log(`  ${p.message}`)
    },
  })
  console.log(`\nPackage ready: ${result.packageDir}`)
  console.log(`  video.mp4`)
  console.log(`  thumbnail.png`)
  console.log(`  subtitles-en.srt`)
  console.log(`  youtube.txt`)
  console.log(`  meta.json`)
  console.log(`\nTitle: ${result.title}`)
  return result
}

async function cmdRegenerate(setIndex) {
  return cmdGenerate(setIndex, { force: true })
}

async function cmdUpload(setIndex) {
  const n = resolveSetIndex(setIndex)
  const rows = await loadHsk1Rows()
  const total = setCount(rows.length)
  if (n > total) {
    console.log(`All ${total} sets uploaded. Done.`)
    return null
  }
  if (!packageExists(n)) {
    throw new Error(`Set ${n} not generated yet. Run: npm run autopilot:generate ${n}`)
  }
  return uploadSetPackage(n)
}

async function cmdAutopilot(setIndex) {
  const n = resolveSetIndex(setIndex)
  await cmdGenerate(n)
  return cmdUpload(n)
}

async function main() {
  const mode = process.argv[2] || 'help'
  const setArg = process.argv[3]

  if (mode === 'help' || mode === '--help' || mode === '-h') {
    usage()
    return
  }
  if (mode === 'generate') {
    await cmdGenerate(setArg)
    return
  }
  if (mode === 'regenerate') {
    await cmdRegenerate(setArg)
    return
  }
  if (mode === 'upload') {
    await cmdUpload(setArg)
    return
  }
  if (mode === 'run' || mode === 'autopilot') {
    await cmdAutopilot(setArg)
    return
  }
  usage()
  process.exit(1)
}

main().catch((err) => {
  console.error(err.stack || err.message || err)
  process.exit(1)
})
