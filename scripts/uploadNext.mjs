import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { google } from 'googleapis'
import { ROOT } from '../server/lib/paths.js'
import {
  loadAutopilotState,
  saveAutopilotState,
  computeNextPublishAt,
  packageDirForSet,
  packageExists,
} from '../server/lib/autopilotState.js'

const CLIENT_SECRET_PATH = path.join(ROOT, 'client_secret.json')
const TOKEN_PATH = path.join(ROOT, 'data', 'youtube-token.json')
const PLAYLIST_ID = 'PLSBjUp0GMW_c'
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
]

function loadClientSecrets() {
  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    throw new Error(
      `Missing ${CLIENT_SECRET_PATH}. Create a Google Cloud Desktop OAuth client and save the JSON here.`,
    )
  }
  const raw = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'))
  const installed = raw.installed || raw.web
  if (!installed?.client_id || !installed?.client_secret) {
    throw new Error('client_secret.json missing client_id/client_secret')
  }
  return installed
}

function createOAuth2Client() {
  const secrets = loadClientSecrets()
  const redirect =
    Array.isArray(secrets.redirect_uris) && secrets.redirect_uris.length
      ? secrets.redirect_uris[0]
      : 'http://localhost:3000/oauth2callback'
  return new google.auth.OAuth2(secrets.client_id, secrets.client_secret, redirect)
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(String(answer || '').trim())
    })
  })
}

async function authorize() {
  const auth = createOAuth2Client()
  if (fs.existsSync(TOKEN_PATH)) {
    auth.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')))
    return auth
  }

  const url = auth.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })
  console.log('\nAuthorize this app by visiting:\n')
  console.log(url)
  console.log('\nAfter approving, paste the full redirect URL (or just the code) here.\n')
  const input = await prompt('Code or redirect URL: ')
  const code = input.includes('code=')
    ? new URL(input).searchParams.get('code')
    : input
  if (!code) throw new Error('No OAuth code provided')

  const { tokens } = await auth.getToken(code)
  auth.setCredentials(tokens)
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true })
  fs.writeFileSync(TOKEN_PATH, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8')
  console.log(`Saved token to ${TOKEN_PATH}`)
  return auth
}

/**
 * Latest upload record for a set, if any.
 */
function findPriorUpload(state, setIndex) {
  const n = Number(setIndex)
  const matches = (state.uploads || []).filter((u) => Number(u.set) === n)
  return matches.length ? matches[matches.length - 1] : null
}

function isFuturePublishAt(publishAt) {
  if (!publishAt) return false
  const t = Date.parse(publishAt)
  return Number.isFinite(t) && t > Date.now()
}

/**
 * Upload one packaged set folder to YouTube (scheduled private → publishAt).
 * Re-uploads reuse the original future publishAt and delete the prior videoId.
 */
export async function uploadSetPackage(setIndex) {
  const state = loadAutopilotState()
  if (!packageExists(setIndex)) {
    throw new Error(`Package missing for set ${setIndex}. Run generate first.`)
  }

  const dir = packageDirForSet(setIndex)
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
  const videoPath = path.join(dir, 'video.mp4')
  const thumbPath = path.join(dir, 'thumbnail.png')
  const srtPath = path.join(dir, 'subtitles-en.srt')

  const prior = findPriorUpload(state, setIndex)
  let publishAt
  let reusedSchedule = false
  if (prior?.publishAt && isFuturePublishAt(prior.publishAt)) {
    publishAt = prior.publishAt
    reusedSchedule = true
    console.log(`Reusing original publishAt for Set ${setIndex}: ${publishAt}`)
  } else {
    if (prior?.publishAt) {
      console.log(
        `Prior publishAt for Set ${setIndex} is in the past (${prior.publishAt}); assigning next M–F noon slot.`,
      )
    }
    publishAt = computeNextPublishAt(state.lastPublishAt)
  }

  console.log(`Uploading Set ${setIndex}…`)
  console.log(`  Title: ${meta.title}`)
  console.log(`  publishAt: ${publishAt}`)

  const auth = await authorize()
  const youtube = google.youtube({ version: 'v3', auth })

  if (prior?.videoId) {
    try {
      await youtube.videos.delete({ id: prior.videoId })
      console.log(`  deleted prior video ${prior.videoId}`)
    } catch (err) {
      console.warn(
        `  could not delete prior video ${prior.videoId}: ${err.message || err}`,
      )
    }
  }

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: meta.title,
        description: meta.description,
        tags: ['HSK', 'LearnChinese', 'ChineseListeningPractice', 'MandarinChinese', 'LearnMandarin'],
        categoryId: '27', // Education
        defaultLanguage: 'en',
        defaultAudioLanguage: 'zh-CN',
      },
      status: {
        privacyStatus: 'private',
        publishAt,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  })

  const videoId = res.data.id
  if (!videoId) throw new Error('YouTube videos.insert returned no video id')
  console.log(`  videoId: ${videoId}`)

  if (fs.existsSync(thumbPath)) {
    await youtube.thumbnails.set({
      videoId,
      media: { body: fs.createReadStream(thumbPath) },
    })
    console.log('  thumbnail set')
  }

  await youtube.playlistItems.insert({
    part: ['snippet'],
    requestBody: {
      snippet: {
        playlistId: PLAYLIST_ID,
        resourceId: {
          kind: 'youtube#video',
          videoId,
        },
      },
    },
  })
  console.log(`  added to playlist ${PLAYLIST_ID}`)

  if (fs.existsSync(srtPath)) {
    await youtube.captions.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          videoId,
          language: 'en',
          name: 'English',
          isDraft: false,
        },
      },
      media: {
        body: fs.createReadStream(srtPath),
      },
    })
    console.log('  English captions uploaded')
  }

  const entry = {
    set: Number(setIndex),
    videoId,
    publishAt,
    uploadedAt: new Date().toISOString(),
  }

  // Replace prior record(s) for this set instead of stacking duplicates
  state.uploads = (state.uploads || []).filter((u) => Number(u.set) !== Number(setIndex))
  state.uploads.push(entry)

  if (!reusedSchedule) {
    state.lastPublishAt = publishAt
    if (Number(state.nextSetIndex) === Number(setIndex)) {
      state.nextSetIndex = Number(setIndex) + 1
    }
  } else if (Number(state.nextSetIndex) <= Number(setIndex)) {
    // Keep progression if somehow nextSetIndex lagged behind an already-scheduled set
    state.nextSetIndex = Math.max(Number(state.nextSetIndex) || 1, Number(setIndex) + 1)
  }

  saveAutopilotState(state)

  return { videoId, publishAt, setIndex: Number(setIndex), reusedSchedule }
}

// CLI
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('uploadNext.mjs')) {
  const arg = process.argv[2]
  const setIndex = arg ? Number(arg) : loadAutopilotState().nextSetIndex
  uploadSetPackage(setIndex)
    .then((r) => {
      console.log('Done:', r)
    })
    .catch((err) => {
      console.error(err.message || err)
      process.exit(1)
    })
}
