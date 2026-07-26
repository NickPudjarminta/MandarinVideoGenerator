let hskSet = null
/** Every Hanzi character that appears in any HSK≤3 word (not just standalone entries). */
let hskCharSet = null
let loading = null

function buildCharSet(wordSet) {
  const chars = new Set()
  for (const word of wordSet) {
    for (const ch of [...String(word)]) {
      if (/[\u4e00-\u9fff]/.test(ch)) chars.add(ch)
    }
  }
  return chars
}

export async function loadHskSet() {
  if (hskSet) return hskSet
  if (!loading) {
    loading = fetch('/hsk_wordlist.json')
      .then((r) => r.json())
      .then((raw) => {
        const set = new Set()
        if (Array.isArray(raw)) {
          for (const w of raw) set.add(String(w))
        } else if (raw.words) {
          for (const w of raw.words) set.add(String(w))
        } else {
          for (const [word, level] of Object.entries(raw)) {
            if (Number(level) <= 3) set.add(word)
          }
        }
        hskSet = set
        hskCharSet = buildCharSet(set)
        return set
      })
  }
  return loading
}

/** Split into individual characters for per-glyph HSK styling. */
export function tokenizeMandarin(text) {
  return [...String(text || '')]
}

/**
 * Bold when a Hanzi character never appears in the HSK≤3 word bank
 * (including as part of a multi-character word).
 */
export function isAboveHsk3(char, hsk) {
  if (!/[\u4e00-\u9fff]/.test(char)) return false
  const known = hskCharSet || (hsk ? buildCharSet(hsk) : null)
  if (!known) return false
  return !known.has(char)
}
