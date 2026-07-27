import { useEffect, useMemo, useRef, useState } from 'react'
import ScriptWorkspace from './components/ScriptWorkspace.jsx'
import AssetSelector from './components/AssetSelector.jsx'
import StyleTransfer from './components/StyleTransfer.jsx'
import SubtitleCustomizer from './components/SubtitleCustomizer.jsx'
import ExportPanel from './components/ExportPanel.jsx'
import WorkbookPanel from './components/WorkbookPanel.jsx'
import PromptEditor from './components/PromptEditor.jsx'
import {
  DEFAULT_BRAVE_SEARCH_QUERY,
  DEFAULT_PROMPTS,
  IDEAS_PROMPT,
  loadPromptsFromJson,
} from './prompts/index.js'
import {
  ASPECT_PRESETS,
  DEFAULT_ASPECT_ID,
  getVideoSize,
  remapPromptsAspect,
} from './constants/video.js'
import { abortErrorMessage, apiGet, apiPost } from './utils/api.js'
import { renderSubtitleOverlay } from './utils/canvasOverlayGenerator.js'
import { splitLines, toPinyinLine } from './utils/pinyin.js'
import { OUTRO_BUMPER } from './constants/bumpers.js'
import './App.css'

function newSessionId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `run-${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

async function urlToDataUrl(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}`)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Failed to read image'))
    reader.readAsDataURL(blob)
  })
}

const STEPS = [
  { id: 'ideas', label: 'Ideas' },
  { id: 'script', label: 'Script' },
  { id: 'assets', label: 'Assets' },
  { id: 'style', label: 'Style' },
  { id: 'subtitles', label: 'Subtitles' },
  { id: 'render', label: 'Render' },
  { id: 'workbook', label: 'Workbook' },
  { id: 'export', label: 'Export' },
]

const DEFAULT_STYLE = {
  fontFamily: 'Roboto',
  fontSize: 40,
  charColor: '#141413',
  pinyinColor: '#CD5C5C',
  englishColor: '#67707E',
  bgColor: '#FFFFFF',
  bgOpacity: 100,
  cornerRadius: 16,
}

/** Client-side render timeout (3 speed passes of TTS + FFmpeg). */
const RENDER_TIMEOUT_MS = 30 * 60 * 1000

/** Final video = three full playthroughs at these Azure rates. */
const SPEED_PASSES = [
  { rate: '0.7', badge: '70% Speed (1/3)', statusLabel: '70% speed' },
  { rate: '0.85', badge: '85% Speed (2/3)', statusLabel: '85% speed' },
  { rate: 'default', badge: '100% Speed (3/3)', statusLabel: '100% speed' },
]

export default function App() {
  const [step, setStep] = useState(0)
  const [prompts, setPrompts] = useState({ ...DEFAULT_PROMPTS })
  const [aspectId, setAspectId] = useState(DEFAULT_ASPECT_ID)
  const [refine, setRefine] = useState('')
  const [braveQuery, setBraveQuery] = useState(DEFAULT_BRAVE_SEARCH_QUERY)
  const [freshness, setFreshness] = useState('pw')
  const [articles, setArticles] = useState([])
  const [ideas, setIdeas] = useState([])
  const [concept, setConcept] = useState(null)
  const [englishScript, setEnglishScript] = useState('')
  const [mandarinScript, setMandarinScript] = useState('')
  const [keyNounRows, setKeyNounRows] = useState([])
  const [beats, setBeats] = useState([])
  const [style, setStyle] = useState(DEFAULT_STYLE)
  const [videoUrl, setVideoUrl] = useState('')
  const [youtubeMeta, setYoutubeMeta] = useState(null)
  const [workbookPdfUrl, setWorkbookPdfUrl] = useState('')
  const [workbookData, setWorkbookData] = useState(null)
  const [workbookImport, setWorkbookImport] = useState(null)
  const [metaImport, setMetaImport] = useState(null)
  const [sessionId, setSessionId] = useState(() => newSessionId())
  const [sessionsList, setSessionsList] = useState([])
  const [loadingSession, setLoadingSession] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState('')
  const [loadingBeatIndex, setLoadingBeatIndex] = useState(null)
  const [renderStatus, setRenderStatus] = useState('')
  const [renderElapsedSec, setRenderElapsedSec] = useState(0)
  const [renderProgress, setRenderProgress] = useState(null)
  const [runLog, setRunLog] = useState({ promptEvents: [], generationEvents: [] })
  const [promptsReady, setPromptsReady] = useState(false)
  const renderAbortRef = useRef(null)

  const stepId = STEPS[step].id
  const isRendering = loading === 'render'
  const videoSize = getVideoSize(aspectId)
  const renderProgressPct =
    renderProgress && renderProgress.total > 0 && renderProgress.phase !== 'ffmpeg'
      ? Math.min(100, Math.round((100 * renderProgress.current) / renderProgress.total))
      : null

  function changeAspect(nextId) {
    if (!ASPECT_PRESETS[nextId] || nextId === aspectId) return
    setPrompts((prev) => remapPromptsAspect(prev, aspectId, nextId))
    setAspectId(nextId)
    setVideoUrl('')
    setBeats((prev) =>
      prev.map((b) => ({
        ...b,
        styledImageBase64: '',
        styledImageUrl: '',
      })),
    )
  }

  useEffect(() => {
    loadPromptsFromJson()
      .then(({ prompts: loaded, braveSearchQuery }) => {
        setPrompts(loaded)
        setBraveQuery(braveSearchQuery)
      })
      .catch((err) => {
        console.warn('Using fallback prompts:', err.message)
      })
      .finally(() => setPromptsReady(true))
  }, [])

  useEffect(() => {
    if (!isRendering) return undefined
    setRenderElapsedSec(0)
    const id = setInterval(() => setRenderElapsedSec((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [isRendering])

  function updatePrompt(key, value) {
    setPrompts((p) => ({ ...p, [key]: value }))
  }

  function syncKeyNounRowsToMandarin(script, prevRows = keyNounRows) {
    const zhLines = splitLines(script)
    return zhLines.map((mandarin, i) => {
      const prev = prevRows[i] || {}
      const keyNoun = String(prev.keyNoun || '').trim()
      const keyNounEn = String(prev.keyNounEn || '').trim()
      const keyNounPinyin = String(prev.keyNounPinyin || prev.pinyin || '').trim()
      return {
        mandarin,
        keyNoun,
        keyNounEn,
        keyNounPinyin,
        valid: Boolean(keyNoun && mandarin.includes(keyNoun)),
      }
    })
  }

  function handleMandarinChange(value) {
    setMandarinScript(value)
    setKeyNounRows((prev) => syncKeyNounRowsToMandarin(value, prev))
  }

  async function extractKeyNouns() {
    const zhLines = splitLines(mandarinScript)
    if (!zhLines.length) {
      setError('Add Mandarin lines before extracting key nouns.')
      return
    }
    setLoading('keyNouns')
    setError('')
    try {
      logPrompt({
        step: 'script',
        kind: 'gemini_key_nouns',
        prompt: prompts.keyNouns,
        mandarinScript,
        englishScript,
      })
      const data = await apiPost('/api/key-nouns', {
        prompt: prompts.keyNouns,
        mandarinScript,
        englishScript,
      })
      const rows = (data.beats || []).map((b) => ({
        mandarin: b.mandarin,
        keyNoun: b.keyNoun || '',
        keyNounEn: b.keyNounEn || '',
        keyNounPinyin: b.pinyin || '',
        valid: Boolean(b.valid),
      }))
      setKeyNounRows(rows)
      logGeneration({
        step: 'script',
        kind: 'key_nouns',
        beats: rows,
        missingLineNumbers: data.missingLineNumbers || [],
        complete: Boolean(data.complete),
      })
      if (!data.complete) {
        setError(
          `Missing key noun on beat(s) ${(data.missingLineNumbers || []).join(', ')}. Regenerate or enter nouns manually.`,
        )
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading('')
    }
  }

  function logPrompt(event) {
    setRunLog((prev) => ({
      ...prev,
      promptEvents: [...prev.promptEvents, { at: new Date().toISOString(), ...event }],
    }))
  }

  function logGeneration(event) {
    setRunLog((prev) => ({
      ...prev,
      generationEvents: [...prev.generationEvents, { at: new Date().toISOString(), ...event }],
    }))
  }

  async function refreshSessionsList() {
    try {
      const data = await apiGet('/api/sessions')
      setSessionsList(data.sessions || [])
    } catch {
      /* ignore list errors */
    }
  }

  async function persistSession(extra = {}) {
    try {
      const id = sessionId || newSessionId()
      if (!sessionId) setSessionId(id)
      await apiPost('/api/sessions', {
        sessionId: id,
        concept,
        englishScript,
        mandarinScript,
        keyNounRows,
        prompts,
        aspectId,
        style,
        videoUrl: extra.videoUrl ?? videoUrl,
        beats: (extra.beats || beats).map((b) => ({
          mandarin: b.mandarin,
          english: b.english,
          pinyin: b.pinyin,
          keyNoun: b.keyNoun,
          keyNounEn: b.keyNounEn,
          keyNounPinyin: b.keyNounPinyin,
          keyword: b.keyword,
          query: b.query,
          selectedImageUrl: b.selectedImageUrl,
          selectedImageThumbnail: b.selectedImageThumbnail,
          durationSec: b.durationSec,
          styledImageBase64: b.styledImageBase64 || null,
        })),
      })
      refreshSessionsList()
    } catch (err) {
      console.warn('Session save failed:', err.message)
    }
  }

  function startNewRun() {
    setSessionId(newSessionId())
    setConcept(null)
    setIdeas([])
    setArticles([])
    setEnglishScript('')
    setMandarinScript('')
    setKeyNounRows([])
    setBeats([])
    setVideoUrl('')
    setYoutubeMeta(null)
    setWorkbookPdfUrl('')
    setWorkbookData(null)
    setWorkbookImport(null)
    setMetaImport(null)
    setRunLog({ promptEvents: [], generationEvents: [] })
    setStep(0)
    setError('')
  }

  async function restoreSession(id) {
    setError('')
    setLoadingSession(true)
    try {
      const data = await apiGet(`/api/sessions/${id}`)
      const m = data.manifest || {}
      setSessionId(id)
      if (m.aspectId) setAspectId(m.aspectId)
      if (m.prompts) setPrompts((prev) => ({ ...prev, ...m.prompts }))
      if (m.style) setStyle(m.style)
      setConcept(m.concept || null)
      setEnglishScript(m.englishScript || '')
      setMandarinScript(m.mandarinScript || '')
      setKeyNounRows(Array.isArray(m.keyNounRows) ? m.keyNounRows : [])

      const styledByIndex = Object.fromEntries(
        (data.styledFiles || []).map((f) => [f.index, f.url]),
      )
      const restoredBeats = []
      for (const b of m.beats || []) {
        let styledImageBase64 = ''
        if (styledByIndex[b.index]) {
          try {
            styledImageBase64 = await urlToDataUrl(styledByIndex[b.index])
          } catch {
            /* skip */
          }
        }
        restoredBeats.push({
          mandarin: b.mandarin || '',
          english: b.english || '',
          pinyin: b.pinyin || '',
          keyNoun: b.keyNoun || '',
          keyNounEn: b.keyNounEn || '',
          keyNounPinyin: b.keyNounPinyin || '',
          keyword: b.keyword || '',
          query: b.query || '',
          selectedImageUrl: b.selectedImageUrl || '',
          selectedImageThumbnail: b.selectedImageThumbnail || '',
          images: [],
          audioBase64: '',
          durationSec: b.audioDurationSec || undefined,
          styledImageBase64,
        })
      }
      setBeats(restoredBeats)
      setVideoUrl(data.videoUrl || '')

      const hasStyled = restoredBeats.some((b) => b.styledImageBase64)
      const hasImages = restoredBeats.some((b) => b.selectedImageUrl)
      const hasScript = Boolean(m.mandarinScript?.trim())
      if (data.videoUrl) setStep(STEPS.findIndex((s) => s.id === 'workbook'))
      else if (hasStyled) setStep(STEPS.findIndex((s) => s.id === 'subtitles'))
      else if (hasImages) setStep(STEPS.findIndex((s) => s.id === 'assets'))
      else if (hasScript) setStep(STEPS.findIndex((s) => s.id === 'script'))
      else setStep(0)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoadingSession(false)
    }
  }

  useEffect(() => {
    refreshSessionsList()
  }, [])

  async function loadIdeas() {
    setError('')
    setLoading('ideas')
    try {
      setSessionId(newSessionId())
      const searchQuery = braveQuery.trim() || DEFAULT_BRAVE_SEARCH_QUERY
      logPrompt({
        step: 'ideas',
        kind: 'gemini_ideas',
        prompt: prompts.ideas,
        braveSearchQuery: searchQuery,
        refine: refine.trim() || null,
        freshness,
        aspectId,
      })
      const data = await apiPost('/api/ideas', {
        prompt: prompts.ideas,
        refine: refine.trim() || undefined,
        searchQuery,
        freshness,
        aspectId,
      })
      setIdeas(data.ideas || [])
      setArticles(data.articles || [])
      logGeneration({
        step: 'ideas',
        kind: 'brave_articles',
        braveQuery: data.braveQuery || searchQuery,
        articles: (data.articles || []).map((a) => ({
          title: a.title,
          url: a.url,
          description: a.description,
          age: a.age,
        })),
      })
      logGeneration({
        step: 'ideas',
        kind: 'idea_options',
        ideas: data.ideas || [],
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading('')
    }
  }

  async function generateScript() {
    if (!concept) {
      setError('Select a concept first.')
      return
    }
    setError('')
    setLoading('draft')
    try {
      logPrompt({
        step: 'script',
        kind: 'gemini_script_draft',
        prompt: prompts.scriptEn,
        concept,
      })
      const data = await apiPost('/api/generate-script', {
        prompt: prompts.scriptEn,
        mode: 'draft',
        concept,
        aspectId,
      })
      setEnglishScript(data.englishScript || '')
      setMandarinScript(data.mandarinScript || '')
      setKeyNounRows([])
      logGeneration({
        step: 'script',
        kind: 'script_draft',
        englishScript: data.englishScript || '',
        mandarinScript: data.mandarinScript || '',
      })
      if (data.mandarinScript?.trim()) {
        setLoading('')
        // Extract nouns right after draft
        const zh = data.mandarinScript
        const en = data.englishScript || ''
        setLoading('keyNouns')
        try {
          const kn = await apiPost('/api/key-nouns', {
            prompt: prompts.keyNouns,
            mandarinScript: zh,
            englishScript: en,
          })
          const rows = (kn.beats || []).map((b) => ({
            mandarin: b.mandarin,
            keyNoun: b.keyNoun || '',
            keyNounEn: b.keyNounEn || '',
            keyNounPinyin: b.pinyin || '',
            valid: Boolean(b.valid),
          }))
          setKeyNounRows(rows)
          logGeneration({
            step: 'script',
            kind: 'key_nouns',
            beats: rows,
            missingLineNumbers: kn.missingLineNumbers || [],
            complete: Boolean(kn.complete),
          })
          if (!kn.complete) {
            setError(
              `Missing key noun on beat(s) ${(kn.missingLineNumbers || []).join(', ')}. Regenerate or enter nouns manually.`,
            )
          }
        } catch (knErr) {
          setKeyNounRows(syncKeyNounRowsToMandarin(zh, []))
          setError(knErr.message)
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading('')
    }
  }

  async function refreshTranslation() {
    setError('')
    setLoading('translate')
    try {
      logPrompt({
        step: 'script',
        kind: 'gemini_script_translate',
        prompt: prompts.scriptZh,
        englishScript,
        concept,
      })
      const data = await apiPost('/api/generate-script', {
        prompt: prompts.scriptZh,
        mode: 'translate',
        concept,
        englishScript,
        aspectId,
      })
      setEnglishScript(data.englishScript || englishScript)
      setMandarinScript(data.mandarinScript || '')
      setKeyNounRows([])
      logGeneration({
        step: 'script',
        kind: 'script_translation',
        englishScript: data.englishScript || englishScript,
        mandarinScript: data.mandarinScript || '',
      })
      if (data.mandarinScript?.trim()) {
        setLoading('')
        setLoading('keyNouns')
        try {
          const kn = await apiPost('/api/key-nouns', {
            prompt: prompts.keyNouns,
            mandarinScript: data.mandarinScript,
            englishScript: data.englishScript || englishScript,
          })
          const rows = (kn.beats || []).map((b) => ({
            mandarin: b.mandarin,
            keyNoun: b.keyNoun || '',
            keyNounEn: b.keyNounEn || '',
            keyNounPinyin: b.pinyin || '',
            valid: Boolean(b.valid),
          }))
          setKeyNounRows(rows)
          logGeneration({
            step: 'script',
            kind: 'key_nouns',
            beats: rows,
            missingLineNumbers: kn.missingLineNumbers || [],
            complete: Boolean(kn.complete),
          })
          if (!kn.complete) {
            setError(
              `Missing key noun on beat(s) ${(kn.missingLineNumbers || []).join(', ')}. Regenerate or enter nouns manually.`,
            )
          }
        } catch (knErr) {
          setKeyNounRows(syncKeyNounRowsToMandarin(data.mandarinScript, []))
          setError(knErr.message)
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading('')
    }
  }

  /** Push Script-step Mandarin/English/key-nouns into beats (keeps assets when ZH line unchanged). */
  function buildBeatsFromScripts() {
    const zhLines = splitLines(mandarinScript)
    const enLines = splitLines(englishScript)
    const rows = syncKeyNounRowsToMandarin(mandarinScript, keyNounRows)
    const next = zhLines.map((mandarin, i) => {
      const kn = rows[i] || {}
      const prev = beats[i]
      const sameLine = prev?.mandarin === mandarin
      const english = enLines[i] || ''
      return {
        id: `beat-${i}`,
        mandarin,
        english,
        pinyin: toPinyinLine(mandarin),
        keyNoun: kn.keyNoun || '',
        keyNounEn: kn.keyNounEn || '',
        keyNounPinyin: kn.keyNounPinyin || '',
        images: sameLine ? prev.images || [] : [],
        selectedImageUrl: sameLine ? prev.selectedImageUrl || '' : '',
        selectedImageThumbnail: sameLine ? prev.selectedImageThumbnail || '' : '',
        styledImageBase64: sameLine ? prev.styledImageBase64 || '' : '',
        styledImageUrl: sameLine ? prev.styledImageUrl || '' : '',
        audioBase64: sameLine ? prev.audioBase64 || '' : '',
        audioUrl: sameLine ? prev.audioUrl || '' : '',
        query: sameLine ? prev.query || '' : '',
        keyword: kn.keyNounEn || (sameLine ? prev.keyword || '' : ''),
      }
    })
    setKeyNounRows(rows)
    setBeats(next)
    return next
  }

  /** True if navigation away from Script is allowed (rebuilds beats when moving forward). */
  function ensureBeatsSyncedFromScript(nextStepIndex) {
    if (STEPS[step]?.id !== 'script') return true
    if (nextStepIndex <= step) return true
    if (missingKeyNounLines.length) {
      setError(
        `Missing key noun on beat(s) ${missingKeyNounLines.join(', ')}. Regenerate or enter nouns before continuing.`,
      )
      return false
    }
    buildBeatsFromScripts()
    return true
  }

  async function fetchBeatAssets(index, beatList, { useKeyword = false } = {}) {
    const list = beatList || beats
    const beat = list[index]
    if (!beat) return

    setLoadingBeatIndex(index)
    setError('')
    try {
      logGeneration({
        step: 'assets',
        kind: 'tts_input',
        beatIndex: index,
        text: beat.mandarin,
      })
      const tts = await apiPost('/api/tts', { text: beat.mandarin })
      const audioUrl = `data:audio/mpeg;base64,${tts.audioBase64}`

      const STOCK_EXCLUSIONS = ' -stock -shutterstock -getty'
      const nounQuery = String(
        (useKeyword && beat.keyword?.trim()) ||
          beat.keyNounEn ||
          beat.keyNoun ||
          beat.keyword ||
          '',
      ).trim()
      if (!nounQuery) {
        throw new Error(`Beat ${index + 1} needs a key noun (or keyword) for image search.`)
      }
      const searchQuery = nounQuery.includes('-stock')
        ? nounQuery
        : `${nounQuery}${STOCK_EXCLUSIONS}`
      logPrompt({
        step: 'assets',
        kind: useKeyword ? 'manual_image_keyword' : 'key_noun_image_query',
        beatIndex: index,
        keyword: searchQuery,
        sentence: beat.mandarin,
        keyNoun: beat.keyNoun,
        keyNounEn: beat.keyNounEn,
        aspectId,
      })
      const search = await apiPost('/api/search', {
        query: searchQuery,
        aspectId,
        keyNoun: beat.keyNoun,
        keyNounEn: beat.keyNounEn,
      })

      logGeneration({
        step: 'assets',
        kind: 'image_search',
        beatIndex: index,
        mandarin: beat.mandarin,
        english: beat.english,
        query: search.query,
        imageOptions: (search.images || []).map((img) => ({
          title: img.title,
          url: img.url,
          thumbnail: img.thumbnail,
          width: img.width,
          height: img.height,
        })),
      })

      setBeats((prev) => {
        const copy = [...prev]
        const uploads = (copy[index].images || []).filter((img) => img.source === 'upload')
        const nextImages = [...uploads, ...(search.images || [])]
        const keepSelection =
          copy[index].selectedImageUrl &&
          (copy[index].selectedImageUrl.startsWith('data:') ||
            nextImages.some((img) => img.url === copy[index].selectedImageUrl))
        copy[index] = {
          ...copy[index],
          audioBase64: tts.audioBase64,
          audioUrl,
          query: search.query,
          images: nextImages,
          selectedImageUrl: keepSelection
            ? copy[index].selectedImageUrl
            : search.images?.[0]?.url || copy[index].selectedImageUrl || '',
          selectedImageThumbnail: keepSelection
            ? copy[index].selectedImageThumbnail
            : search.images?.[0]?.thumbnail || copy[index].selectedImageThumbnail || '',
        }
        return copy
      })
    } catch (e) {
      setError(`Beat ${index + 1}: ${e.message}`)
    } finally {
      setLoadingBeatIndex(null)
    }
  }

  async function fetchAllAssets() {
    setLoading('assets')
    setError('')
    try {
      const working = beats.length ? beats : buildBeatsFromScripts()
      if (!working.length) {
        throw new Error('Add Mandarin script lines before generating assets.')
      }
      for (let i = 0; i < working.length; i++) {
        await fetchBeatAssets(i, working)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading('')
    }
  }

  function cancelRender() {
    if (renderAbortRef.current) {
      renderAbortRef.current.abort(new Error('Render cancelled by user'))
    }
  }

  async function styleBeat(index, beatList, { force = false } = {}) {
    const list = beatList || beats
    const beat = list[index]
    if (!beat?.selectedImageUrl) {
      setError(`Beat ${index + 1} has no selected image.`)
      return
    }

    // Restyle / restyle-all should call Gemini again, not reuse disk cache
    const bypassCache = force || Boolean(beat.styledImageBase64 || beat.styledImageUrl)

    setLoadingBeatIndex(index)
    setError('')
    try {
      logPrompt({
        step: 'style',
        kind: 'gemini_style_image',
        beatIndex: index,
        prompt: prompts.styleImage,
        sourceUrl: beat.selectedImageUrl,
        force: bypassCache,
      })

      let data
      const isDataUrl = String(beat.selectedImageUrl).startsWith('data:')
      const payloadBase = {
        prompt: prompts.styleImage,
        force: bypassCache,
        aspectId,
      }
      try {
        data = await apiPost(
          '/api/style-image',
          isDataUrl
            ? {
                ...payloadBase,
                imageBase64: beat.selectedImageUrl,
              }
            : {
                ...payloadBase,
                imageUrl: beat.selectedImageUrl,
                fallbackUrl: beat.selectedImageThumbnail || undefined,
              },
        )
      } catch (err) {
        // Some full-size CDN images are rejected even after re-encode — retry thumbnail
        const retryable =
          !isDataUrl &&
          beat.selectedImageThumbnail &&
          beat.selectedImageThumbnail !== beat.selectedImageUrl &&
          /Unable to process input image|INVALID_ARGUMENT|400/.test(err.message || '')
        if (!retryable) throw err
        data = await apiPost('/api/style-image', {
          ...payloadBase,
          imageUrl: beat.selectedImageThumbnail,
        })
      }

      const stamp = Date.now()
      const styledImageUrl = `data:${data.mimeType || 'image/png'};base64,${data.imageBase64}#${stamp}`
      setBeats((prev) => {
        const copy = [...prev]
        copy[index] = {
          ...copy[index],
          styledImageBase64: data.imageBase64,
          styledImageUrl,
        }
        return copy
      })
      logGeneration({
        step: 'style',
        kind: 'styled_image',
        beatIndex: index,
        mandarin: beat.mandarin,
        cached: Boolean(data.cached),
        forced: bypassCache,
      })
    } catch (e) {
      setError(`Beat ${index + 1} style: ${e.message}`)
      throw e
    } finally {
      setLoadingBeatIndex(null)
    }
  }

  async function styleAllBeats() {
    setLoading('style')
    setError('')
    try {
      const working = beats
      if (!working.length) throw new Error('No beats to style.')
      const anyStyled = working.some((b) => b.styledImageBase64 || b.styledImageUrl)
      for (let i = 0; i < working.length; i++) {
        if (!working[i].selectedImageUrl) {
          throw new Error(`Beat ${i + 1} needs a selected image first.`)
        }
        await styleBeat(i, working, { force: anyStyled })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading('')
    }
  }

  async function runRender() {
    if (isRendering) return

    // Always re-sync Script editors → beats so EN/ZH subtitle edits apply even if the user
    // jumped steps via the step pills (which skip Continue / goNext).
    const workingBeats = splitLines(mandarinScript).length
      ? buildBeatsFromScripts()
      : beats

    // TTS is regenerated during render — do not require audioBase64 (loaded sessions omit it).
    const unstyled = workingBeats.filter((b) => !b.styledImageBase64)
    if (unstyled.length) {
      setError(
        'Every beat needs a styled image before rendering. Load a session that saved styled frames, or finish the Style step.',
      )
      return
    }
    if (!workingBeats.length) {
      setError('No beats to render.')
      return
    }

    // Cancel any prior attempt, then start fresh
    renderAbortRef.current?.abort()
    const controller = new AbortController()
    renderAbortRef.current = controller
    const timeoutMins = Math.floor(RENDER_TIMEOUT_MS / 60000)
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Render timed out after ${timeoutMins} minutes`))
    }, RENDER_TIMEOUT_MS)

    const ttsTotal = SPEED_PASSES.length * workingBeats.length
    setError('')
    setVideoUrl('')
    setRenderStatus('Preparing audio & overlays…')
    setRenderProgress({
      phase: 'tts',
      current: 0,
      total: ttsTotal,
      label: 'Audio & overlays',
    })
    setLoading('render')

    const { signal } = controller
    try {
      const payloadBeats = []
      let done = 0
      for (let p = 0; p < SPEED_PASSES.length; p++) {
        const pass = SPEED_PASSES[p]
        for (let i = 0; i < workingBeats.length; i++) {
          if (signal.aborted) throw new Error('Render cancelled by user')
          const b = workingBeats[i]
          if (!b.mandarin?.trim()) {
            throw new Error(`Beat ${i + 1} is missing Mandarin text for TTS.`)
          }
          const status = `Pass ${p + 1}/${SPEED_PASSES.length} (${pass.statusLabel}) — beat ${i + 1}/${workingBeats.length}`
          setRenderStatus(`${status}…`)
          setRenderProgress({
            phase: 'tts',
            current: done,
            total: ttsTotal,
            label: status,
          })
          logGeneration({
            step: 'render',
            kind: 'tts_pass',
            pass: p + 1,
            beatIndex: i,
            text: b.mandarin,
            rate: pass.rate,
          })
          const ttsBody =
            pass.rate === 'default'
              ? { text: b.mandarin }
              : { text: b.mandarin, rate: pass.rate }
          const tts = await apiPost('/api/tts', ttsBody, { signal })
          const subtitleOverlayBase64 = await renderSubtitleOverlay(
            b,
            style,
            aspectId,
            pass.badge,
          )
          payloadBeats.push({
            mandarin: b.mandarin,
            pinyin: b.pinyin,
            english: b.english,
            imageBase64: b.styledImageBase64,
            audioBase64: tts.audioBase64,
            subtitleOverlayBase64,
          })
          done += 1
          setRenderProgress({
            phase: 'tts',
            current: done,
            total: ttsTotal,
            label: status,
          })
        }
      }

      if (signal.aborted) throw new Error('Render cancelled by user')

      setRenderStatus('Ensuring outro bumper audio…')
      await apiPost('/api/ensure-bumper-audio', {}, { signal })

      const outroBeat = {
        mandarin: OUTRO_BUMPER.mandarin,
        english: OUTRO_BUMPER.english,
        pinyin: toPinyinLine(OUTRO_BUMPER.mandarin),
      }
      const outroOverlayBase64 = await renderSubtitleOverlay(outroBeat, style, aspectId, '')

      const ffmpegLabel = `Encoding ${payloadBeats.length} segments (3× ${workingBeats.length} beats) + transitions + BGM with FFmpeg — this can take a while`
      setRenderStatus(`${ffmpegLabel}…`)
      setRenderProgress({
        phase: 'ffmpeg',
        current: 0,
        total: payloadBeats.length,
        label: ffmpegLabel,
      })
      const result = await apiPost(
        '/api/render',
        {
          beats: payloadBeats,
          style,
          aspectId,
          beatsPerPass: workingBeats.length,
          outroOverlayBase64,
          sessionId,
        },
        { signal },
      )
      setVideoUrl(result.outputUrl)
      const skipped = Number(result.segmentsSkipped) || 0
      const encoded = Number(result.segmentsEncoded) || 0
      setRenderStatus(
        skipped
          ? `Done. Reused ${skipped} cached FFmpeg clip${skipped === 1 ? '' : 's'}; encoded ${encoded} new.`
          : 'Done.',
      )
      setRenderProgress({ phase: 'done', current: 1, total: 1, label: 'Done' })
      await persistSession({ videoUrl: result.outputUrl, beats: workingBeats })
      setStep(STEPS.findIndex((s) => s.id === 'workbook'))
    } catch (e) {
      const msg = abortErrorMessage(e)
      setError(msg)
      setRenderStatus(msg.includes('cancelled') ? 'Cancelled.' : msg.includes('timed out') ? 'Timed out.' : '')
      setRenderProgress(null)
    } finally {
      clearTimeout(timeoutId)
      if (renderAbortRef.current === controller) renderAbortRef.current = null
      setLoading('')
    }
  }

  function buildWorkbookEntries(sourceBeats) {
    const seen = new Set()
    const entries = []
    for (const b of sourceBeats || []) {
      const keyNoun = String(b.keyNoun || '').trim()
      if (!keyNoun || seen.has(keyNoun) || !/[\u4e00-\u9fff]/.test(keyNoun)) continue
      seen.add(keyNoun)
      entries.push({
        keyNoun,
        keyNounEn: String(b.keyNounEn || '').trim(),
        pinyin: String(b.keyNounPinyin || '').trim() || toPinyinLine(keyNoun),
        mandarin: String(b.mandarin || '').trim(),
        english: String(b.english || '').trim(),
      })
    }
    return entries
  }

  async function generateWorkbook() {
    setError('')
    setLoading('workbook')
    try {
      const sourceBeats = workbookImport?.beats || beats
      const sourceConcept = workbookImport?.concept || concept
      const entries = buildWorkbookEntries(sourceBeats)
      if (!entries.length) {
        throw new Error('No Mandarin key nouns available for the workbook.')
      }
      logPrompt({
        step: 'workbook',
        kind: 'gemini_workbook',
        prompt: prompts.workbook,
        conceptTitle: sourceConcept?.title || '',
        entryCount: entries.length,
        fromImport: Boolean(workbookImport),
      })
      const data = await apiPost('/api/workbook', {
        prompt: prompts.workbook,
        concept: sourceConcept,
        entries,
      })
      setWorkbookPdfUrl(data.pdfUrl || '')
      setWorkbookData(data.workbook || null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading('')
    }
  }

  async function generateYoutubeMeta() {
    setError('')
    setLoading('youtube')
    try {
      const sourceConcept = metaImport?.concept || concept
      const sourceEn = metaImport?.englishScript || englishScript
      const sourceZh = metaImport?.mandarinScript || mandarinScript
      const sourceBeats = metaImport?.beats || beats
      if (!sourceZh?.trim() && !sourceEn?.trim() && !sourceBeats.some((b) => b.keyNoun)) {
        throw new Error(
          'No scripts or key nouns available. Import a run-generations.json from a past video.',
        )
      }
      logPrompt({
        step: 'export',
        kind: 'gemini_youtube_meta',
        prompt: prompts.youtubeMeta,
        concept: sourceConcept,
        englishScript: sourceEn,
        mandarinScript: sourceZh,
        fromImport: Boolean(metaImport),
      })
      const data = await apiPost('/api/youtube-meta', {
        prompt: prompts.youtubeMeta,
        concept: sourceConcept,
        englishScript: sourceEn,
        mandarinScript: sourceZh,
        keyNouns: sourceBeats.map((b) => ({
          keyNoun: b.keyNoun,
          keyNounEn: b.keyNounEn,
          pinyin: b.keyNounPinyin || b.pinyin,
        })),
      })
      setYoutubeMeta(data)
      logGeneration({
        step: 'export',
        kind: 'youtube_meta',
        title: data.title || '',
        description: data.description || '',
        boldedVocabulary: data.boldedVocabulary || [],
        fromImport: Boolean(metaImport),
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading('')
    }
  }

  const promptsExport = useMemo(
    () => ({
      exportedAt: new Date().toISOString(),
      finalPromptState: {
        ideas: prompts.ideas,
        scriptEn: prompts.scriptEn,
        scriptZh: prompts.scriptZh,
        keyNouns: prompts.keyNouns,
        imageQuery: prompts.imageQuery,
        styleImage: prompts.styleImage,
        youtubeMeta: prompts.youtubeMeta,
        workbook: prompts.workbook,
        braveSearchQuery: braveQuery,
        refine,
        freshness,
        aspectId,
        videoSize: {
          width: videoSize.width,
          height: videoSize.height,
          ratioLabel: videoSize.ratioLabel,
        },
      },
      promptEvents: runLog.promptEvents,
    }),
    [prompts, braveQuery, refine, freshness, aspectId, videoSize, runLog.promptEvents],
  )

  const generationsExport = useMemo(
    () => ({
      exportedAt: new Date().toISOString(),
      selected: {
        concept,
        englishScript,
        mandarinScript,
        youtubeMeta: youtubeMeta
          ? { title: youtubeMeta.title, description: youtubeMeta.description }
          : null,
        subtitleStyle: style,
        beats: beats.map((b, i) => ({
          index: i,
          mandarin: b.mandarin,
          english: b.english,
          pinyin: b.pinyin,
          imageQuery: b.query,
          keyword: b.keyword || '',
          keyNoun: b.keyNoun || '',
          keyNounEn: b.keyNounEn || '',
          selectedImageUrl: b.selectedImageUrl,
          selectedImageThumbnail: b.selectedImageThumbnail,
          imageOptionCount: b.images?.length || 0,
        })),
      },
      generationEvents: runLog.generationEvents,
    }),
    [
      concept,
      englishScript,
      mandarinScript,
      youtubeMeta,
      style,
      beats,
      runLog.generationEvents,
    ],
  )

  const missingKeyNounLines = useMemo(() => {
    const zh = splitLines(mandarinScript)
    const missing = []
    zh.forEach((line, i) => {
      const kn = String(keyNounRows[i]?.keyNoun || '').trim()
      if (!kn || !line.includes(kn)) missing.push(i + 1)
    })
    return missing
  }, [mandarinScript, keyNounRows])

  const canNext = useMemo(() => {
    if (stepId === 'ideas') return Boolean(concept)
    if (stepId === 'script') {
      const zh = splitLines(mandarinScript)
      return zh.length > 0 && missingKeyNounLines.length === 0
    }
    if (stepId === 'assets') {
      // audioBase64 is optional here — render regenerates TTS; restored sessions often lack it
      return (
        beats.length > 0 &&
        beats.every((b) => b.selectedImageUrl || b.styledImageBase64)
      )
    }
    if (stepId === 'style') {
      return beats.length > 0 && beats.every((b) => b.styledImageBase64)
    }
    if (stepId === 'subtitles') return true
    if (stepId === 'render') return Boolean(videoUrl)
    if (stepId === 'workbook') return true
    return true
  }, [stepId, concept, mandarinScript, missingKeyNounLines, beats, videoUrl])

  function goNext() {
    const next = step + 1
    if (!ensureBeatsSyncedFromScript(next)) return
    // Auto-save snapshot when leaving script / assets / style / subtitles / render
    if (['script', 'assets', 'style', 'subtitles', 'render'].includes(stepId)) {
      persistSession()
    }
    if (step < STEPS.length - 1) setStep(next)
  }

  function goToStep(i) {
    if (!ensureBeatsSyncedFromScript(i)) return
    setStep(i)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Local studio</p>
          <h1>Mandarin Tech News Video</h1>
          <p className="tagline">
            HSK 3 tech explainers ({videoSize.ratioLabel} · {videoSize.width}×{videoSize.height} · ~60s) —
            human-in-the-loop, rendered on your machine.
            {promptsReady ? '' : ' Loading prompts…'}
          </p>
        </div>
      </header>

      <nav className="steps" aria-label="Wizard steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`step-pill ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
            onClick={() => goToStep(i)}
          >
            <span>{i + 1}</span>
            {s.label}
          </button>
        ))}
      </nav>

      {error && <div className="banner error">{error}</div>}

      <main className="panel">
        {stepId === 'ideas' && (
          <section>
            <div className="tts-regen-panel" style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>Previous work</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Active session: <code>{sessionId}</code> (auto-saved under <code>.tmp/sessions</code>)
              </p>
              <div className="export-actions">
                <label className="refine compact" style={{ minWidth: 280 }}>
                  Load previous work
                  <select
                    defaultValue=""
                    disabled={loadingSession}
                    onChange={(e) => {
                      const id = e.target.value
                      e.target.value = ''
                      if (id) restoreSession(id)
                    }}
                  >
                    <option value="">
                      {sessionsList.length ? 'Select a saved run…' : 'No saved runs yet'}
                    </option>
                    {sessionsList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {(s.title || s.id).slice(0, 60)}
                        {s.hasVideo ? ' · video' : ''}
                        {s.updatedAt ? ` · ${String(s.updatedAt).slice(0, 16).replace('T', ' ')}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn ghost" onClick={startNewRun}>
                  New run
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={refreshSessionsList}
                  disabled={loadingSession}
                >
                  Refresh list
                </button>
              </div>
              {loadingSession && <p className="status">Loading session…</p>}
            </div>

            <div className="aspect-toggle">
              <span>Video aspect ratio</span>
              <div className="aspect-toggle-options">
                {Object.values(ASPECT_PRESETS).map((preset) => (
                  <label key={preset.id}>
                    <input
                      type="radio"
                      name="aspect"
                      checked={aspectId === preset.id}
                      onChange={() => changeAspect(preset.id)}
                    />
                    {preset.label}
                  </label>
                ))}
              </div>
              <p className="muted" style={{ margin: 0 }}>
                Applies to ideas/script prompts, image search (Assets), Gemini style output, subtitle
                preview, and final render.
              </p>
            </div>
            <PromptEditor
              label="Ideas prompt"
              value={prompts.ideas}
              defaultValue={IDEAS_PROMPT}
              onChange={(v) => updatePrompt('ideas', v)}
              onRun={loadIdeas}
              runLabel={ideas.length ? 'Re-roll / generate more' : 'Generate ideas'}
              running={loading === 'ideas'}
              collapsedDefault={false}
            />
            <label className="refine">
              Brave Search query (recent articles)
              <input
                value={braveQuery}
                onChange={(e) => setBraveQuery(e.target.value)}
                placeholder="AI tech news query…"
              />
            </label>
            <div className="ideas-toolbar">
              <label className="refine compact">
                Freshness
                <select value={freshness} onChange={(e) => setFreshness(e.target.value)}>
                  <option value="pd">Past day</option>
                  <option value="pw">Past week</option>
                  <option value="pm">Past month</option>
                </select>
              </label>
              <label className="refine">
                Optional focus / refine instruction
                <input
                  value={refine}
                  onChange={(e) => setRefine(e.target.value)}
                  placeholder="e.g. focus on chip wars and consumer AI tools"
                />
              </label>
            </div>

            {articles.length > 0 && (
              <details className="articles-panel" open>
                <summary>Recent articles from Brave ({articles.length})</summary>
                <ul className="article-list">
                  {articles.map((a) => (
                    <li key={a.id || a.url}>
                      <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a>
                      {a.description && <p>{a.description}</p>}
                      {a.age && <small>{a.age}</small>}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="idea-grid">
              {ideas.map((idea) => (
                <button
                  key={idea.id}
                  type="button"
                  className={`idea-card ${concept?.id === idea.id ? 'selected' : ''}`}
                  onClick={() => {
                    const urls = idea.sourceUrls || []
                    const primaryArticle =
                      articles.find((a) => urls.includes(a.url)) || articles[0] || null
                    const next = { ...idea, primaryArticle }
                    setConcept(next)
                    logGeneration({
                      step: 'ideas',
                      kind: 'idea_selected',
                      idea: next,
                    })
                  }}
                >
                  <h3>{idea.title}</h3>
                  {idea.sourceUrls?.length > 0 && (
                    <div className="idea-sources">
                      {idea.sourceUrls.slice(0, 2).map((url) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          source
                        </a>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {stepId === 'script' && (
          <ScriptWorkspace
            englishScript={englishScript}
            mandarinScript={mandarinScript}
            onEnglishChange={setEnglishScript}
            onMandarinChange={handleMandarinChange}
            prompts={prompts}
            onPromptChange={updatePrompt}
            onGenerateScript={generateScript}
            onRefreshTranslation={refreshTranslation}
            onRefreshKeyNouns={extractKeyNouns}
            keyNounRows={keyNounRows}
            missingKeyNounLines={missingKeyNounLines}
            onKeyNounChange={(i, patch) => {
              setKeyNounRows((prev) => {
                const zh = splitLines(mandarinScript)
                const copy = syncKeyNounRowsToMandarin(mandarinScript, prev)
                const row = { ...copy[i], ...patch }
                const keyNoun = String(row.keyNoun || '').trim()
                const keyNounEn = String(row.keyNounEn || '').trim()
                copy[i] = {
                  ...row,
                  mandarin: zh[i] || row.mandarin,
                  keyNoun,
                  keyNounEn,
                  keyNounPinyin: keyNoun ? toPinyinLine(keyNoun) : '',
                  valid: Boolean(keyNoun && (zh[i] || '').includes(keyNoun)),
                }
                return copy
              })
              setError('')
            }}
            loadingDraft={loading === 'draft'}
            loadingTranslate={loading === 'translate'}
            loadingKeyNouns={loading === 'keyNouns'}
          />
        )}

        {stepId === 'assets' && (
          <AssetSelector
            beats={beats}
            onFetchAll={fetchAllAssets}
            onFetchBeat={(i) => fetchBeatAssets(i)}
            onSelectImage={(i, url, thumbnail) =>
              setBeats((prev) => {
                const beat = prev[i]
                logGeneration({
                  step: 'assets',
                  kind: 'image_selected',
                  beatIndex: i,
                  mandarin: beat?.mandarin,
                  url: String(url).startsWith('data:') ? '[data-url]' : url,
                  thumbnail: thumbnail?.startsWith?.('data:') ? '[data-url]' : thumbnail || '',
                })
                const copy = [...prev]
                copy[i] = {
                  ...copy[i],
                  selectedImageUrl: url,
                  selectedImageThumbnail: thumbnail || '',
                  // Changing source invalidates previous Gemini style output
                  styledImageBase64: '',
                  styledImageUrl: '',
                }
                return copy
              })
            }
            onUploadImage={(i, file) => {
              if (!file?.type?.startsWith('image/')) {
                setError('Please choose an image file (JPEG, PNG, WebP…).')
                return
              }
              if (file.size > 20 * 1024 * 1024) {
                setError('Image is too large (max 20 MB).')
                return
              }
              const reader = new FileReader()
              reader.onerror = () => setError('Failed to read the image file.')
              reader.onload = () => {
                const dataUrl = String(reader.result || '')
                if (!dataUrl.startsWith('data:')) {
                  setError('Failed to read the image file.')
                  return
                }
                const entry = {
                  id: `upload-${Date.now()}-${file.name}`,
                  url: dataUrl,
                  thumbnail: dataUrl,
                  title: file.name,
                  source: 'upload',
                }
                logGeneration({
                  step: 'assets',
                  kind: 'image_uploaded',
                  beatIndex: i,
                  mandarin: beats[i]?.mandarin,
                  filename: file.name,
                  bytes: file.size,
                })
                setBeats((prev) => {
                  const copy = [...prev]
                  const existing = copy[i]?.images || []
                  copy[i] = {
                    ...copy[i],
                    images: [entry, ...existing.filter((img) => img.id !== entry.id)],
                    selectedImageUrl: dataUrl,
                    selectedImageThumbnail: dataUrl,
                    styledImageBase64: '',
                    styledImageUrl: '',
                  }
                  return copy
                })
                setError('')
              }
              reader.readAsDataURL(file)
            }}
            onKeywordChange={(i, value) =>
              setBeats((prev) => {
                const copy = [...prev]
                copy[i] = { ...copy[i], keyword: value }
                return copy
              })
            }
            onKeywordSearch={(i) => fetchBeatAssets(i, beats, { useKeyword: true })}
            loading={loading === 'assets'}
            loadingBeatIndex={loadingBeatIndex}
            aspectId={aspectId}
          />
        )}

        {stepId === 'style' && (
          <StyleTransfer
            beats={beats}
            prompts={prompts}
            onPromptChange={updatePrompt}
            onStyleAll={styleAllBeats}
            onStyleBeat={(i) => styleBeat(i)}
            loading={loading === 'style'}
            loadingBeatIndex={loadingBeatIndex}
            aspectId={aspectId}
          />
        )}

        {stepId === 'subtitles' && (
          <SubtitleCustomizer style={style} onChange={setStyle} aspectId={aspectId} />
        )}

        {stepId === 'render' && (
          <section className="render-panel">
            <p>Composites zoomed images + canvas subtitle overlays (same as preview) with native FFmpeg.</p>
            <p className="muted">
              {beats.length} beats ready · {videoSize.width}×{videoSize.height} ({videoSize.ratioLabel}) ·
              timeout {Math.floor(RENDER_TIMEOUT_MS / 60000)} min
            </p>

            <div className="tts-regen-panel">
              <p className="tts-regen-hint" style={{ marginTop: 0 }}>
                Opens with a 3s <code>70Speed_Transition.png</code> card (no speech), then the full
                video <strong>three times</strong> at <strong>70%</strong> / <strong>85%</strong> /{' '}
                <strong>100%</strong>, with 3s mid-cards, workbook outro (≥5s), and{' '}
                <code>BackgroundMusic.mp3</code> mixed under the whole timeline. Restart reuses
                cached FFmpeg segments for this session under <code>.tmp/render/</code> when inputs
                are unchanged.
              </p>
            </div>

            <div className="render-actions">
              {!isRendering ? (
                <button type="button" className="btn primary" onClick={runRender}>
                  {videoUrl || renderStatus === 'Cancelled.' || renderStatus === 'Timed out.'
                    ? 'Restart render'
                    : 'Start render'}
                </button>
              ) : (
                <button type="button" className="btn danger" onClick={cancelRender}>
                  Cancel render
                </button>
              )}
              {videoUrl && !isRendering && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setStep(STEPS.findIndex((s) => s.id === 'workbook'))}
                >
                  Go to workbook
                </button>
              )}
            </div>

            {(isRendering || renderProgress) && (
              <div className="render-progress" aria-live="polite">
                <div className="render-progress-meta">
                  <span>
                    {renderProgress?.phase === 'ffmpeg'
                      ? 'Phase 2/2 — Video encode'
                      : renderProgress?.phase === 'done'
                        ? 'Complete'
                        : 'Phase 1/2 — Audio & overlays'}
                  </span>
                  <span>
                    Elapsed {Math.floor(renderElapsedSec / 60)}:
                    {String(renderElapsedSec % 60).padStart(2, '0')}
                    {' / '}
                    {Math.floor(RENDER_TIMEOUT_MS / 60000)}:00
                  </span>
                </div>
                <div
                  className={`render-progress-track ${
                    renderProgress?.phase === 'ffmpeg' ? 'indeterminate' : ''
                  }`}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    renderProgress?.phase === 'ffmpeg' ? undefined : renderProgressPct ?? 0
                  }
                  aria-label={renderProgress?.label || renderStatus || 'Render progress'}
                >
                  <div
                    className="render-progress-fill"
                    style={
                      renderProgress?.phase === 'ffmpeg'
                        ? undefined
                        : { width: `${renderProgressPct ?? 0}%` }
                    }
                  />
                </div>
                <p className="render-progress-detail">
                  {renderProgress?.phase === 'tts' && (
                    <>
                      {renderProgress.current}/{renderProgress.total} clips ready
                      {renderProgressPct != null ? ` · ${renderProgressPct}%` : ''}
                    </>
                  )}
                  {renderProgress?.phase === 'ffmpeg' && (
                    <>
                      Encoding {renderProgress.total} segments on your machine — the bar pulses while
                      FFmpeg works (no per-segment updates until it finishes). Elapsed time keeps
                      ticking so you can tell it is still running.
                    </>
                  )}
                  {renderProgress?.phase === 'done' && <>Finished.</>}
                </p>
              </div>
            )}
            {renderStatus && <p className="status">{renderStatus}</p>}
          </section>
        )}

        {stepId === 'workbook' && (
          <WorkbookPanel
            prompts={prompts}
            onPromptChange={updatePrompt}
            liveConcept={concept}
            liveBeats={beats}
            workbookImport={workbookImport}
            onImport={(parsed, importError) => {
              if (importError) {
                setError(importError)
                setWorkbookImport(null)
                return
              }
              setError('')
              setWorkbookImport(parsed)
              setWorkbookPdfUrl('')
              setWorkbookData(null)
            }}
            onClearImport={() => {
              setWorkbookImport(null)
              setWorkbookPdfUrl('')
              setWorkbookData(null)
            }}
            onGenerate={generateWorkbook}
            loading={loading === 'workbook'}
            pdfUrl={workbookPdfUrl}
            workbookData={workbookData}
            error={null}
          />
        )}

        {stepId === 'export' && (
          <ExportPanel
            videoUrl={videoUrl}
            youtubeMeta={youtubeMeta}
            prompts={prompts}
            onPromptChange={updatePrompt}
            onGenerateMeta={generateYoutubeMeta}
            loadingMeta={loading === 'youtube'}
            promptsExport={promptsExport}
            generationsExport={generationsExport}
            metaImport={metaImport}
            onMetaImport={(parsed, importError) => {
              if (importError) {
                setError(importError)
                setMetaImport(null)
                return
              }
              setError('')
              setMetaImport(parsed)
              setYoutubeMeta(null)
            }}
            onClearMetaImport={() => {
              setMetaImport(null)
            }}
            liveHasContent={Boolean(
              (englishScript || mandarinScript || beats.some((b) => b.keyNoun)),
            )}
          />
        )}
      </main>

      <footer className="wizard-nav">
        <button type="button" className="btn ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Back
        </button>
        {step < STEPS.length - 1 && (
          <button type="button" className="btn primary" disabled={!canNext} onClick={goNext}>
            Continue
          </button>
        )}
      </footer>
    </div>
  )
}
