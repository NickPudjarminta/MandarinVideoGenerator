import { useRef } from 'react'

export default function AssetSelector({
  beats,
  onFetchAll,
  onFetchBeat,
  onSelectImage,
  onUploadImage,
  onKeywordSearch,
  onKeywordChange,
  loading,
  loadingBeatIndex,
  aspectId = 'portrait',
}) {
  const fileRefs = useRef({})

  return (
    <div className={`asset-selector aspect-${aspectId}`}>
      <div className="asset-toolbar">
        <p className="muted" style={{ margin: 0 }}>
          Image search uses each beat&apos;s key noun (English) plus stock exclusions — no Gemini
          query step.
        </p>
        <button type="button" className="btn primary" disabled={loading} onClick={onFetchAll}>
          {loading ? 'Generating assets…' : 'Generate assets for all beats'}
        </button>
      </div>

      <div className="beat-list">
        {beats.map((beat, index) => (
          <section key={beat.id || index} className="beat-card">
            <header>
              <strong>Beat {index + 1}</strong>
              <p className="beat-text">{beat.mandarin}</p>
              {beat.english && <p className="beat-en">{beat.english}</p>}
              {(beat.keyNoun || beat.keyNounEn) && (
                <p className="beat-key-noun">
                  Key noun: <strong>{beat.keyNoun || '—'}</strong>
                  {beat.keyNounEn ? ` · ${beat.keyNounEn}` : ''}
                </p>
              )}
              {beat.query && <p className="beat-query">Query: {beat.query}</p>}
            </header>

            <div className="beat-tools">
              <input
                type="text"
                placeholder="Manual keyword override…"
                value={beat.keyword || beat.keyNounEn || ''}
                onChange={(e) => onKeywordChange(index, e.target.value)}
              />
              <button
                type="button"
                className="btn ghost"
                disabled={loadingBeatIndex === index}
                onClick={() => onKeywordSearch(index)}
              >
                Search
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={loadingBeatIndex === index}
                onClick={() => onFetchBeat(index)}
              >
                {loadingBeatIndex === index ? 'Loading…' : 'Search images'}
              </button>
            </div>

            {beat.audioUrl && (
              <audio controls src={beat.audioUrl} className="beat-audio" />
            )}

            <div className="thumb-grid">
              <button
                type="button"
                className="thumb thumb-upload"
                title="Upload your own photo"
                onClick={() => fileRefs.current[index]?.click()}
              >
                <span>+ Upload</span>
              </button>
              <input
                ref={(el) => {
                  fileRefs.current[index] = el
                }}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) onUploadImage?.(index, file)
                }}
              />
              {(beat.images || []).map((img) => (
                <button
                  key={img.id}
                  type="button"
                  className={`thumb ${beat.selectedImageUrl === img.url ? 'selected' : ''} ${
                    img.source === 'upload' ? 'thumb-own' : ''
                  }`}
                  onClick={() => onSelectImage(index, img.url, img.thumbnail)}
                  title={img.title || (img.source === 'upload' ? 'Your photo' : '')}
                >
                  <img src={img.thumbnail || img.url} alt="" loading="lazy" />
                  {img.source === 'upload' && <span className="thumb-badge">Yours</span>}
                </button>
              ))}
              {!beat.images?.length && (
                <p className="muted thumb-empty-note">No search results yet — upload or run asset generation.</p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
