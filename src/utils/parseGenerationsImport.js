function countKeyNouns(beats) {
  const seen = new Set()
  for (const b of beats || []) {
    const kn = String(b.keyNoun || '').trim()
    if (kn && /[\u4e00-\u9fff]/.test(kn)) seen.add(kn)
  }
  return seen.size
}

/**
 * Normalize run-generations.json (or a bare selected payload) for workbook / YouTube meta.
 * @param {object} raw
 * @param {{ requireKeyNouns?: boolean, purpose?: string }} [opts]
 */
export function parseGenerationsImport(raw, opts = {}) {
  const requireKeyNouns = opts.requireKeyNouns !== false
  const purpose = opts.purpose || 'this step'

  if (!raw || typeof raw !== 'object') throw new Error('Invalid JSON: expected an object.')
  const selected =
    raw.selected && typeof raw.selected === 'object'
      ? raw.selected
      : Array.isArray(raw.beats) || raw.englishScript || raw.mandarinScript
        ? raw
        : null
  if (!selected) {
    throw new Error(
      'Could not find selected content. Use a run-generations.json export (with a "selected" object).',
    )
  }
  const beats = Array.isArray(selected.beats) ? selected.beats : []
  const keyNounCount = countKeyNouns(beats)
  if (requireKeyNouns && !keyNounCount) {
    throw new Error(`Import has no Mandarin key nouns on beats. Cannot use for ${purpose}.`)
  }
  if (!selected.mandarinScript && !selected.englishScript && !keyNounCount) {
    throw new Error('Import has no scripts or key nouns.')
  }
  return {
    concept: selected.concept || null,
    englishScript: selected.englishScript || '',
    mandarinScript: selected.mandarinScript || '',
    beats,
    keyNounCount,
    title: selected.concept?.title || 'Imported run',
  }
}
