import { renderVideo } from '../lib/ffmpegPipeline.js'
import { resolveVideoFormat } from '../lib/videoFormat.js'

export async function renderHandler(c) {
  const body = await c.req.json()
  const { beats, style, beatsPerPass, outroOverlayBase64, sessionId } = body
  if (!Array.isArray(beats) || beats.length === 0) {
    return c.json({ error: 'beats array is required' }, 400)
  }

  const videoFormat = resolveVideoFormat(body)
  const signal = c.req.raw?.signal

  try {
    const result = await renderVideo({
      beats,
      style: style || {},
      signal,
      width: videoFormat.width,
      height: videoFormat.height,
      beatsPerPass: Number(beatsPerPass) || 0,
      outroOverlayBase64: outroOverlayBase64 || '',
      sessionId: sessionId || '',
    })
    return c.json({ ...result, aspectId: videoFormat.id, ratioLabel: videoFormat.ratioLabel })
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      return c.json({ error: 'Render cancelled' }, 499)
    }
    throw err
  }
}
