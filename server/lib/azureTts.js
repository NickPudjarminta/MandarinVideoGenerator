import { requireEnv } from './env.js'

/** High-quality Azure output — avoid 16kHz which sounds muffled. */
export const AZURE_OUTPUT_FORMAT = 'audio-48khz-192kbitrate-mono-mp3'
export const DEFAULT_VOICE = 'zh-CN-XiaochenNeural'

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Normalize rate for SSML. Accepts "-10%", "0.9", "slow", etc. */
export function normalizeRate(raw) {
  if (raw == null || raw === '') return 'default'
  const s = String(raw).trim()
  if (!s || s === '1' || s === '1.0' || s === '+0%' || s === '0%' || s === 'default' || s === 'medium') {
    return 'default'
  }
  return s
}

/**
 * Call Azure Speech TTS. Returns a Buffer of MP3 audio.
 */
export async function synthesizeAzureMp3({
  text,
  voice = DEFAULT_VOICE,
  rate = 'default',
}) {
  const spokenText = String(text || '').trim()
  if (!spokenText) throw new Error('TTS text is required')

  const key = requireEnv('AZURE_SPEECH_KEY')
  const region = requireEnv('AZURE_SPEECH_REGION')
  const safeText = escapeXml(spokenText)
  const normRate = normalizeRate(rate)

  const spoken =
    normRate === 'default'
      ? safeText
      : `<prosody rate='${escapeXml(normRate)}'>${safeText}</prosody>`

  const ssml =
    `<speak version='1.0' xml:lang='zh-CN'>` +
    `<voice xml:lang='zh-CN' name='${escapeXml(voice)}'>${spoken}</voice>` +
    `</speak>`

  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': AZURE_OUTPUT_FORMAT,
        'User-Agent': 'MandarinVideoGenerator',
      },
      body: ssml,
    },
  )

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Azure TTS error ${res.status}: ${errText}`)
  }

  return Buffer.from(await res.arrayBuffer())
}
