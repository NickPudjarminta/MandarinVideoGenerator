import { requireEnv } from './env.js'
import { normalizeToJpeg } from './normalizeImage.js'

const IMAGE_MODEL = 'gemini-3.1-flash-image'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`

async function callGeminiEdit({ prompt, sourceJpegB64, aspectRatio = '9:16' }) {
  const apiKey = requireEnv('GEMINI_API_KEY')
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt.trim() },
          {
            text: `The attached image is the source photo to restyle. Preserve its main subject and composition. Apply only the style described in the prompt — do not invent a second reference scene. Output aspect ratio ${aspectRatio}.`,
          },
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: sourceJpegB64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio,
      },
    },
  }

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const errText = !res.ok ? await res.text() : ''
  if (!res.ok) {
    const err = new Error(`Gemini image edit error ${res.status}: ${errText}`)
    err.status = res.status
    err.body = errText
    throw err
  }

  const data = await res.json()
  const parts = data?.candidates?.[0]?.content?.parts || []
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data
    if (inline?.data) {
      return {
        imageBase64: inline.data,
        mimeType: inline.mimeType || inline.mime_type || 'image/png',
      }
    }
  }

  const blockReason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason
  const text = parts.map((p) => p.text).filter(Boolean).join(' ')
  throw new Error(
    text
      ? `Gemini returned no image. Model said: ${text.slice(0, 280)}`
      : `Gemini returned no image data${blockReason ? ` (${blockReason})` : ''}`,
  )
}

/**
 * Restyle a source image with Gemini image edit using a text style prompt only.
 * Normalizes input to JPEG first (fixes many 400 INVALID_ARGUMENT failures).
 */
export async function stylizeImage({
  imageBase64,
  mimeType = 'image/jpeg',
  prompt,
  imageBuffer,
  aspectRatio = '9:16',
}) {
  const cleaned = String(imageBase64 || '').replace(/^data:[^;]+;base64,/, '')
  const sourceBuf = imageBuffer || Buffer.from(cleaned, 'base64')
  if (!sourceBuf?.length) throw new Error('imageBase64 is required')

  // Primary attempt: source long-edge 1280
  let source = await normalizeToJpeg(sourceBuf, { maxEdge: 1280, quality: 85 })

  try {
    return await callGeminiEdit({
      prompt,
      sourceJpegB64: source.base64,
      aspectRatio,
    })
  } catch (err) {
    const msg = String(err.message || '')
    const retriable =
      err.status === 400 ||
      msg.includes('Unable to process input image') ||
      msg.includes('INVALID_ARGUMENT')

    if (!retriable) throw err

    // Retry smaller — some hosts serve exotic encodings Gemini rejects until resized hard
    source = await normalizeToJpeg(sourceBuf, { maxEdge: 768, quality: 80 })
    try {
      return await callGeminiEdit({
        prompt,
        sourceJpegB64: source.base64,
        aspectRatio,
      })
    } catch (err2) {
      throw new Error(
        `${err2.message}\n(Also failed after re-encoding source to JPEG @768px. Try a different photo — Gemini may be blocking this image.)`,
      )
    }
  }
}
