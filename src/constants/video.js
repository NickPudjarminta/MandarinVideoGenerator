/** Export / preview aspect presets */
export const ASPECT_PRESETS = {
  portrait: {
    id: 'portrait',
    width: 720,
    height: 1280,
    ratioLabel: '9:16',
    geminiAspect: '9:16',
    orientation: 'portrait',
    label: 'Portrait 720×1280',
    shortLabel: '9:16 portrait',
  },
  landscape: {
    id: 'landscape',
    width: 1280,
    height: 720,
    ratioLabel: '16:9',
    geminiAspect: '16:9',
    orientation: 'landscape',
    label: 'Landscape 1280×720',
    shortLabel: '16:9 landscape',
  },
}

export const DEFAULT_ASPECT_ID = 'portrait'

/** @deprecated prefer getVideoSize(aspectId) — kept for imports that expect constants */
export const VIDEO_WIDTH = ASPECT_PRESETS.portrait.width
export const VIDEO_HEIGHT = ASPECT_PRESETS.portrait.height
export const VIDEO_FPS = 30
export const VIDEO_BOTTOM_MARGIN = 56

export function getVideoSize(aspectId = DEFAULT_ASPECT_ID) {
  return ASPECT_PRESETS[aspectId] || ASPECT_PRESETS.portrait
}

/** Rewrite aspect-specific wording when the user toggles format on Step 1. */
export function remapPromptAspect(text, fromId, toId) {
  if (!text || fromId === toId) return text
  let out = String(text)

  if (toId === 'landscape') {
    out = out
      .replace(/TikTok \/ short-form vertical videos \(9:16/gi, 'YouTube landscape videos (16:9')
      .replace(/TikTok-style vertical/gi, 'YouTube-style landscape')
      .replace(/vertical \(portrait\) B-roll/gi, 'landscape B-roll')
      .replace(/vertical \(portrait\)/gi, 'landscape')
      .replace(/portrait photo or illustration \(9:16 friendly\)/gi, 'landscape photo or illustration (16:9 friendly)')
      .replace(/high-resolution portrait photo/gi, 'high-resolution landscape photo')
      .replace(/Vertical aspect ratio 9:16/gi, 'Landscape aspect ratio 16:9')
      .replace(/vertical \(9:16\)/gi, 'landscape (16:9)')
      .replace(/9:16/g, '16:9')
      .replace(/720\s*[×x]\s*1280/gi, '1280×720')
  } else {
    out = out
      .replace(/YouTube landscape videos \(16:9/gi, 'TikTok / short-form vertical videos (9:16')
      .replace(/YouTube-style landscape/gi, 'TikTok-style vertical')
      .replace(/landscape B-roll/gi, 'vertical (portrait) B-roll')
      .replace(/landscape photo or illustration \(16:9 friendly\)/gi, 'portrait photo or illustration (9:16 friendly)')
      .replace(/high-resolution landscape photo/gi, 'high-resolution portrait photo')
      .replace(/Landscape aspect ratio 16:9/gi, 'Vertical aspect ratio 9:16')
      .replace(/landscape \(16:9\)/gi, 'vertical (9:16)')
      .replace(/16:9/g, '9:16')
      .replace(/1280\s*[×x]\s*720/gi, '720×1280')
  }

  return out
}

export function remapPromptsAspect(prompts, fromId, toId) {
  if (fromId === toId) return prompts
  const keys = ['ideas', 'scriptEn', 'scriptZh', 'keyNouns', 'imageQuery', 'styleImage', 'youtubeMeta']
  const next = { ...prompts }
  for (const key of keys) {
    if (next[key]) next[key] = remapPromptAspect(next[key], fromId, toId)
  }
  return next
}
