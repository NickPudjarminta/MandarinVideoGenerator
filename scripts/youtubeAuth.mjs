import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { google } from 'googleapis'
import { ROOT } from '../server/lib/paths.js'

const CLIENT_SECRET_PATH = path.join(ROOT, 'client_secret.json')
const TOKEN_PATH = path.join(ROOT, 'data', 'youtube-token.json')

export const YOUTUBE_SCOPES = [
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

/**
 * OAuth2 client with stored (or freshly authorized) YouTube credentials.
 */
export async function authorizeYoutube() {
  const auth = createOAuth2Client()
  if (fs.existsSync(TOKEN_PATH)) {
    auth.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')))
    return auth
  }

  const url = auth.generateAuthUrl({
    access_type: 'offline',
    scope: YOUTUBE_SCOPES,
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

export async function getYoutubeClient() {
  const auth = await authorizeYoutube()
  return google.youtube({ version: 'v3', auth })
}
