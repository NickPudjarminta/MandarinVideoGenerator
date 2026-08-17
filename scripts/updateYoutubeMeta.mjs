#!/usr/bin/env node
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { getSet } from '../server/lib/hsk1Sets.js'
import { buildHsk1SetMeta } from '../server/lib/hsk1SetMeta.js'
import { renderHsk1SetThumbnail } from '../server/lib/listeningOverlayNode.js'
import {
  loadAutopilotState,
  packageDirForSet,
} from '../server/lib/autopilotState.js'
import { getYoutubeClient } from './youtubeAuth.mjs'

/**
 * Refresh local thumbnail + meta title for a set, then push title/thumb to YouTube.
 */
async function updateOneSet(youtube, upload) {
  const setIndex = Number(upload.set)
  const videoId = upload.videoId
  if (!videoId) throw new Error(`Set ${setIndex}: missing videoId`)

  const set = await getSet(setIndex)
  const firstWord = set.firstWord
  const lastWord = set.lastWord
  const { title } = buildHsk1SetMeta({
    setIndex,
    firstWord,
    lastWord,
    phrases: set.phrases,
    timeline: [],
  })

  const packageDir = packageDirForSet(setIndex)
  fs.mkdirSync(packageDir, { recursive: true })
  const thumbPath = path.join(packageDir, 'thumbnail.png')
  await renderHsk1SetThumbnail({ setIndex, firstWord, lastWord, outPath: thumbPath })

  const metaPath = path.join(packageDir, 'meta.json')
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    meta.title = title
    meta.firstWord = firstWord
    meta.lastWord = lastWord
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  }

  const youtubeTxt = path.join(packageDir, 'youtube.txt')
  if (fs.existsSync(youtubeTxt)) {
    const body = fs.readFileSync(youtubeTxt, 'utf8')
    const rest = body.includes('\n\n') ? body.slice(body.indexOf('\n\n') + 2) : ''
    fs.writeFileSync(youtubeTxt, `${title}\n\n${rest}`, 'utf8')
  }

  console.log(`Set ${setIndex} (${videoId})`)
  console.log(`  Title: ${title}`)

  const listed = await youtube.videos.list({
    part: ['snippet'],
    id: [videoId],
  })
  const item = listed.data.items?.[0]
  if (!item?.snippet) {
    throw new Error(`Set ${setIndex}: video ${videoId} not found (or no access)`)
  }

  const snippet = { ...item.snippet, title }
  // videos.update requires categoryId when updating snippet
  if (!snippet.categoryId) snippet.categoryId = '27'

  await youtube.videos.update({
    part: ['snippet'],
    requestBody: {
      id: videoId,
      snippet,
    },
  })
  console.log('  title updated')

  await youtube.thumbnails.set({
    videoId,
    media: { body: fs.createReadStream(thumbPath) },
  })
  console.log('  thumbnail updated')

  return { setIndex, videoId, title }
}

async function main() {
  const state = loadAutopilotState()
  const uploads = [...(state.uploads || [])]
    .filter((u) => u?.videoId && Number(u.set) >= 1)
    .sort((a, b) => Number(a.set) - Number(b.set))

  // Deduplicate by set (keep latest)
  const bySet = new Map()
  for (const u of uploads) bySet.set(Number(u.set), u)
  const unique = [...bySet.values()].sort((a, b) => Number(a.set) - Number(b.set))

  if (!unique.length) {
    console.log('No uploads in autopilot state. Nothing to update.')
    return
  }

  console.log(`Updating title + thumbnail for ${unique.length} video(s)…\n`)
  const youtube = await getYoutubeClient()

  const results = []
  for (const upload of unique) {
    try {
      results.push(await updateOneSet(youtube, upload))
    } catch (err) {
      console.error(`Set ${upload.set} FAILED: ${err.message || err}`)
      throw err
    }
    console.log()
  }

  console.log(`Done. Updated ${results.length} video(s).`)
}

main().catch((err) => {
  console.error(err.stack || err.message || err)
  process.exit(1)
})
