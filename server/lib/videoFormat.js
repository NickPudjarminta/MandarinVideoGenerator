export const ASPECT_PRESETS = {
  portrait: {
    id: 'portrait',
    width: 720,
    height: 1280,
    ratioLabel: '9:16',
    geminiAspect: '9:16',
    orientation: 'portrait',
  },
  landscape: {
    id: 'landscape',
    width: 1280,
    height: 720,
    ratioLabel: '16:9',
    geminiAspect: '16:9',
    orientation: 'landscape',
  },
}

export function resolveVideoFormat(input = {}) {
  if (input.aspectId && ASPECT_PRESETS[input.aspectId]) {
    return { ...ASPECT_PRESETS[input.aspectId] }
  }
  const w = Number(input.width)
  const h = Number(input.height)
  if (w === 1280 && h === 720) return { ...ASPECT_PRESETS.landscape }
  if (w === 720 && h === 1280) return { ...ASPECT_PRESETS.portrait }
  if (input.geminiAspect === '16:9' || input.ratioLabel === '16:9') {
    return { ...ASPECT_PRESETS.landscape }
  }
  return { ...ASPECT_PRESETS.portrait }
}

export function formatContextLine(fmt) {
  return `Video format: ${fmt.width}×${fmt.height} (${fmt.ratioLabel} ${fmt.orientation}). All creative choices must fit this frame.`
}
