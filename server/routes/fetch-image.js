import { downloadImageBuffer } from '../lib/downloadImage.js'

export async function fetchImageHandler(c) {
  const body = await c.req.json()
  const { url, fallbackUrl } = body
  if (!url?.trim()) return c.json({ error: 'url is required' }, 400)

  const buf = await downloadImageBuffer(url.trim(), {
    fallbackUrls: fallbackUrl ? [fallbackUrl] : [],
  })

  const mime = sniffMime(buf)
  return c.json({
    imageBase64: buf.toString('base64'),
    mimeType: mime,
  })
}

function sniffMime(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}
