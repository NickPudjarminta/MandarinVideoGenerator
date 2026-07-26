import { useEffect, useRef } from 'react'
import { getVideoSize } from '../constants/video.js'
import { drawSubtitleBlock } from '../utils/canvasOverlayGenerator.js'

const FONTS = ['Roboto', 'Noto Sans SC', 'System Default Sans']

const SAMPLE_BEAT = {
  mandarin: '你听过人工智能在安全测试中失控的故事吗？',
  pinyin: 'nǐ tīng guò rén gōng zhì néng zài ān quán cè shì zhōng shī kòng de gù shì ma ？',
  english: 'Have you ever heard of artificial intelligence going rogue during a safety test?',
  keyNoun: '人工智能',
  keyNounEn: 'artificial intelligence',
  keyNounPinyin: 'rén gōng zhì néng',
}

export default function SubtitleCustomizer({ style, onChange, aspectId = 'portrait' }) {
  const canvasRef = useRef(null)
  const set = (key, value) => onChange({ ...style, [key]: value })
  const { width, height, ratioLabel, orientation } = getVideoSize(aspectId)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, width, height)
    g.addColorStop(0, '#1a2433')
    g.addColorStop(1, '#0d1218')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    const insetX = orientation === 'landscape' ? 80 : 40
    const insetY = orientation === 'landscape' ? 40 : 80
    ctx.fillRect(insetX, insetY, width - insetX * 2, height - insetY * 2 - 120)
    ctx.textBaseline = 'alphabetic'
    drawSubtitleBlock(ctx, SAMPLE_BEAT, style, width, height)
  }, [style, width, height, orientation])

  return (
    <div className="subtitle-customizer">
      <div className="controls">
        <label>
          Font
          <select value={style.fontFamily} onChange={(e) => set('fontFamily', e.target.value)}>
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label>
          Base font size ({style.fontSize}px @ {width}×{height})
          <input
            type="range"
            min={22}
            max={56}
            value={style.fontSize}
            onChange={(e) => set('fontSize', Number(e.target.value))}
          />
        </label>

        <label>
          Characters
          <input type="color" value={style.charColor} onChange={(e) => set('charColor', e.target.value)} />
        </label>
        <label>
          Pinyin
          <input type="color" value={style.pinyinColor} onChange={(e) => set('pinyinColor', e.target.value)} />
        </label>
        <label>
          English
          <input type="color" value={style.englishColor} onChange={(e) => set('englishColor', e.target.value)} />
        </label>
        <label>
          Background plate
          <input type="color" value={style.bgColor} onChange={(e) => set('bgColor', e.target.value)} />
        </label>

        <label>
          Background opacity ({style.bgOpacity}%)
          <input
            type="range"
            min={0}
            max={100}
            value={style.bgOpacity}
            onChange={(e) => set('bgOpacity', Number(e.target.value))}
          />
        </label>

        <label>
          Corner radius ({style.cornerRadius}px)
          <input
            type="range"
            min={0}
            max={30}
            value={style.cornerRadius}
            onChange={(e) => set('cornerRadius', Number(e.target.value))}
          />
        </label>
      </div>

      <div className="preview-stage">
        <div className={`preview-frame ${orientation}`}>
          <canvas ref={canvasRef} className="preview-canvas" />
        </div>
        <p className="muted">
          Exact render path preview · {width}×{height} ({ratioLabel}). Key noun + matching
          pinyin/English (must appear in each line) are bolded.
        </p>
      </div>
    </div>
  )
}
