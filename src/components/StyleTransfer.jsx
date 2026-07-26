import PromptEditor from './PromptEditor.jsx'
import { STYLE_IMAGE_PROMPT } from '../prompts/index.js'

export default function StyleTransfer({
  beats,
  prompts,
  onPromptChange,
  onStyleAll,
  onStyleBeat,
  loading,
  loadingBeatIndex,
  aspectId = 'portrait',
}) {
  const styledCount = beats.filter((b) => b.styledImageUrl || b.styledImageBase64).length

  return (
    <div className="style-transfer">
      <PromptEditor
        label="Gemini image style prompt (text only)"
        value={prompts.styleImage}
        defaultValue={STYLE_IMAGE_PROMPT}
        onChange={(v) => onPromptChange('styleImage', v)}
        onRun={onStyleAll}
        runLabel={styledCount ? 'Restyle all beats' : 'Style all beats'}
        running={loading}
        collapsedDefault={false}
      />

      <p className="muted">
        Each selected image is restyled by Gemini from your text prompt only — no style-reference
        image ({styledCount}/{beats.length} styled).
      </p>

      <div className="style-grid">
        {beats.map((beat, index) => (
          <section key={beat.id || index} className="style-card">
            <header>
              <strong>Beat {index + 1}</strong>
              <p className="beat-text">{beat.mandarin}</p>
            </header>
            <div className={`style-compare aspect-${aspectId}`}>
              <div>
                <span className="muted">Source</span>
                {beat.selectedImageUrl ? (
                  <img src={beat.selectedImageThumbnail || beat.selectedImageUrl} alt="" />
                ) : (
                  <p className="muted">No image selected</p>
                )}
              </div>
              <div>
                <span className="muted">Styled</span>
                {beat.styledImageUrl ? (
                  <img src={beat.styledImageUrl} alt="" />
                ) : (
                  <div className="style-placeholder muted">
                    {loadingBeatIndex === index || loading ? 'Styling…' : 'Not styled yet'}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              className="btn ghost"
              disabled={!beat.selectedImageUrl || loading || loadingBeatIndex === index}
              onClick={() => onStyleBeat(index)}
            >
              {loadingBeatIndex === index ? 'Styling…' : beat.styledImageUrl ? 'Restyle' : 'Style this beat'}
            </button>
          </section>
        ))}
      </div>
    </div>
  )
}
