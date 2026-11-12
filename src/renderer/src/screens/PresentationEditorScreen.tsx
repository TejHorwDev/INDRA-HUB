import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type {
  PresentationDetail,
  PresentationTheme,
  Slide,
  SlideLayout
} from '@shared/types'
import { PRESENTATION_THEMES } from '@shared/types'
import EmptyState from '../components/EmptyState'
import SlideCanvas from '../components/SlideCanvas'
import { useToast } from '../components/ToastProvider'
import { AlertCircleIcon, ChevronLeftIcon, PlusIcon } from '../components/icons'
import { api, errorMessage } from '../lib/api'
import { formatClock } from '../lib/format'

const LAYOUT_OPTIONS: Array<{ value: SlideLayout; label: string }> = [
  { value: 'title', label: 'Title' },
  { value: 'section', label: 'Section' },
  { value: 'text', label: 'Text' },
  { value: 'bullets', label: 'Bullets' },
  { value: 'process', label: 'Numbered process' },
  { value: 'quote', label: 'Quote' },
  { value: 'table', label: 'Table' },
  { value: 'image', label: 'Text + image' },
  { value: 'closing', label: 'Closing' }
]

const THEME_LABELS: Record<PresentationTheme, string> = {
  minimal: 'Minimal professional',
  academic: 'Academic',
  corporate: 'Modern corporate',
  editorial: 'Editorial',
  research: 'Research',
  dark: 'Dark professional'
}

function emptySlide(layout: SlideLayout = 'text'): Slide {
  return {
    id: crypto.randomUUID(),
    layout,
    title: layout === 'closing' ? 'Thank you' : 'New slide',
    body: layout === 'text' ? '' : undefined,
    bullets: layout === 'bullets' || layout === 'process' ? [''] : undefined,
    notes: ''
  }
}

export default function PresentationEditorScreen() {
  const { projectId = '', presentationId = '' } = useParams()
  const toast = useToast()

  const [presentation, setPresentation] = useState<PresentationDetail | null>(null)
  const [slides, setSlides] = useState<Slide[]>([])
  const [title, setTitle] = useState('')
  const [theme, setTheme] = useState<PresentationTheme>('minimal')
  const [selected, setSelected] = useState(0)
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const latest = useRef({ slides, title, theme, saveState })
  useEffect(() => {
    latest.current = { slides, title, theme, saveState }
  })

  useEffect(() => {
    let active = true
    api.presentations
      .get(projectId, presentationId)
      .then((loaded) => {
        if (!active) return
        setPresentation(loaded)
        setSlides(loaded.slides)
        setTitle(loaded.title)
        setTheme(loaded.theme)
        setSavedAt(loaded.updatedAt)
        setSaveState('saved')
      })
      .catch((failure) => {
        if (active) setLoadError(errorMessage(failure))
      })
    return () => {
      active = false
    }
  }, [presentationId, projectId])

  const save = useCallback(async () => {
    const snapshot = latest.current
    if (snapshot.saveState === 'saving') return
    setSaveState('saving')
    try {
      const saved = await api.presentations.save(projectId, presentationId, {
        title: snapshot.title,
        theme: snapshot.theme,
        slides: snapshot.slides
      })
      setSavedAt(new Date().toISOString())
      setSaveState('saved')
      setPresentation((current) => (current ? { ...current, ...saved, slides: current.slides } : saved))
    } catch (failure) {
      setSaveState('error')
      toast.error(errorMessage(failure))
    }
  }, [presentationId, projectId, toast])

  useEffect(() => {
    if (saveState !== 'dirty') return
    const timer = window.setTimeout(() => void save(), 1400)
    return () => window.clearTimeout(timer)
  }, [save, saveState, slides, theme, title])

  // Don't lose slide edits when the screen unmounts before the debounce fires.
  useEffect(
    () => () => {
      const snapshot = latest.current
      if (snapshot.saveState === 'dirty') {
        void api.presentations.save(projectId, presentationId, {
          title: snapshot.title,
          theme: snapshot.theme,
          slides: snapshot.slides
        })
      }
    },
    [presentationId, projectId]
  )

  const markDirty = () => setSaveState('dirty')

  const current = slides[selected]

  function updateSlide(patch: Partial<Slide>) {
    setSlides((list) => list.map((slide, index) => (index === selected ? { ...slide, ...patch } : slide)))
    markDirty()
  }

  function addSlide() {
    const slide = emptySlide()
    setSlides((list) => [...list, slide])
    setSelected(slides.length)
    markDirty()
  }

  function duplicateSlide() {
    if (!current) return
    const copy = { ...current, id: crypto.randomUUID() }
    setSlides((list) => {
      const next = [...list]
      next.splice(selected + 1, 0, copy)
      return next
    })
    setSelected(selected + 1)
    markDirty()
  }

  function deleteSlide() {
    if (slides.length <= 1) return
    setSlides((list) => list.filter((_, index) => index !== selected))
    setSelected(Math.max(0, selected - 1))
    markDirty()
  }

  function move(offset: number) {
    const target = selected + offset
    if (target < 0 || target >= slides.length) return
    setSlides((list) => {
      const next = [...list]
      const [moved] = next.splice(selected, 1)
      next.splice(target, 0, moved)
      return next
    })
    setSelected(target)
    markDirty()
  }

  if (loadError) {
    return (
      <div className="deck-editor">
        <EmptyState
          icon={<AlertCircleIcon size={18} />}
          title="Couldn’t open this presentation"
          description={loadError}
          action={
            <Link to={`/project/${projectId}/presentations`} className="btn btn-ghost w-auto">
              Back to presentations
            </Link>
          }
        />
      </div>
    )
  }

  if (!presentation) {
    return (
      <div className="deck-editor" aria-busy="true">
        <div className="deck-stage">
          <span className="skeleton" style={{ display: 'block', width: '70%', height: 200 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="deck-editor">
      <header className="doc-bar">
        <Link to={`/project/${projectId}/presentations`} className="workspace-back">
          <ChevronLeftIcon size={14} />
          Presentations
        </Link>

        <input
          className="doc-title-input"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            markDirty()
          }}
          aria-label="Presentation title"
          maxLength={120}
        />

        <span className={`doc-status doc-status--${saveState}`}>
          <span className="doc-status-dot" aria-hidden="true" />
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'dirty'
              ? 'Unsaved changes'
              : saveState === 'error'
                ? 'Save failed'
                : savedAt
                  ? `Saved ${formatClock(savedAt)}`
                  : 'Saved'}
        </span>

        <div className="doc-bar-actions">
          <label className="toolbar-field">
            <span>Theme</span>
            <select
              className="select-input"
              value={theme}
              onChange={(event) => {
                setTheme(event.target.value as PresentationTheme)
                markDirty()
              }}
            >
              {PRESENTATION_THEMES.map((value) => (
                <option key={value} value={value}>
                  {THEME_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary w-auto"
            onClick={() => void save()}
            disabled={saveState === 'saving' || saveState === 'saved'}
          >
            Save
          </button>
        </div>
      </header>

      {presentation.sourceDocumentId && (
        <div className={`deck-source${presentation.stale ? ' deck-source--stale' : ''}`}>
          <span>
            Generated from{' '}
            <Link
              to={`/project/${projectId}/documents/${presentation.sourceDocumentId}`}
              className="link-quiet"
            >
              {presentation.sourceDocumentTitle}
            </Link>{' '}
            · version {presentation.sourceDocumentVersion} ·{' '}
            {presentation.conversionMode === 'rule' ? 'rule-based (offline)' : 'AI-enhanced'}
          </span>
          {presentation.stale && (
            <span className="deck-source-note">
              The source document changed since this deck was generated. Your slide edits are kept —
              convert again from the document if you want a fresh deck.
            </span>
          )}
        </div>
      )}

      <div className="deck-body">
        <aside className="deck-rail" aria-label="Slides">
          <div className="deck-rail-head">
            <span>{slides.length} slides</span>
            <button type="button" className="icon-button" onClick={addSlide} aria-label="Add slide">
              <PlusIcon size={14} />
            </button>
          </div>

          <ol className="deck-thumbs">
            {slides.map((slide, index) => (
              <li key={slide.id}>
                <button
                  type="button"
                  className={`deck-thumb${index === selected ? ' deck-thumb--active' : ''}`}
                  onClick={() => setSelected(index)}
                  title={slide.title}
                >
                  <span className="deck-thumb-index">{index + 1}</span>
                  <div className="slide-viewport slide-viewport--thumb">
                    <SlideCanvas slide={slide} theme={theme} index={index} total={slides.length} compact />
                  </div>
                </button>
              </li>
            ))}
          </ol>

          <div className="deck-rail-actions">
            <button type="button" className="btn btn-ghost btn-sm w-full" onClick={duplicateSlide}>
              Duplicate
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm w-full"
              onClick={deleteSlide}
              disabled={slides.length <= 1}
            >
              Delete
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm w-full"
                onClick={() => move(-1)}
                disabled={selected === 0}
              >
                Up
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm w-full"
                onClick={() => move(1)}
                disabled={selected === slides.length - 1}
              >
                Down
              </button>
            </div>
          </div>
        </aside>

        <div className="deck-stage">
          <div className="slide-viewport slide-viewport--stage">
            {current && (
              <SlideCanvas slide={current} theme={theme} index={selected} total={slides.length} />
            )}
          </div>
          <p className="deck-stage-note">
            Slide {selected + 1} of {slides.length} · edits are saved to this project
          </p>
        </div>

        <aside className="deck-props" aria-label="Slide properties">
          {current && (
            <>
              <label className="field">
                <span className="field-label">Layout</span>
                <select
                  className="select-input"
                  value={current.layout}
                  onChange={(event) => updateSlide({ layout: event.target.value as SlideLayout })}
                >
                  {LAYOUT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">
                  {current.layout === 'quote' ? 'Attribution' : 'Title'}
                </span>
                <input
                  className="text-input"
                  value={current.title}
                  onChange={(event) => updateSlide({ title: event.target.value })}
                  maxLength={200}
                />
              </label>

              {(current.layout === 'title' ||
                current.layout === 'section' ||
                current.layout === 'closing' ||
                current.layout === 'text' ||
                current.layout === 'bullets' ||
                current.layout === 'process' ||
                current.layout === 'image') && (
                <label className="field">
                  <span className="field-label">
                    {current.layout === 'image' ? 'Caption' : 'Body text'}
                  </span>
                  <textarea
                    className="field-textarea"
                    rows={3}
                    value={current.body ?? ''}
                    onChange={(event) => updateSlide({ body: event.target.value })}
                  />
                </label>
              )}

              {current.layout === 'quote' && (
                <label className="field">
                  <span className="field-label">Quote</span>
                  <textarea
                    className="field-textarea"
                    rows={4}
                    value={current.quote ?? ''}
                    onChange={(event) => updateSlide({ quote: event.target.value })}
                  />
                </label>
              )}

              {(current.layout === 'bullets' || current.layout === 'process') && (
                <label className="field">
                  <span className="field-label">Lines (one per line)</span>
                  <textarea
                    className="field-textarea"
                    rows={6}
                    value={(current.bullets ?? []).join('\n')}
                    onChange={(event) =>
                      updateSlide({ bullets: event.target.value.split('\n') })
                    }
                  />
                </label>
              )}

              {current.layout === 'table' && (
                <>
                  <label className="field">
                    <span className="field-label">Headers (one per column)</span>
                    <input
                      className="text-input"
                      value={(current.table?.headers ?? []).join(' | ')}
                      onChange={(event) =>
                        updateSlide({
                          table: {
                            headers: event.target.value.split('|').map((cell) => cell.trim()),
                            rows: current.table?.rows ?? []
                          }
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Rows (one per line, columns with |)</span>
                    <textarea
                      className="field-textarea"
                      rows={6}
                      value={(current.table?.rows ?? []).map((row) => row.join(' | ')).join('\n')}
                      onChange={(event) =>
                        updateSlide({
                          table: {
                            headers: current.table?.headers ?? [],
                            rows: event.target.value
                              .split('\n')
                              .map((line) => line.split('|').map((cell) => cell.trim()))
                          }
                        })
                      }
                    />
                  </label>
                </>
              )}

              {current.layout === 'image' && (
                <label className="field">
                  <span className="field-label">Image URL</span>
                  <input
                    className="text-input"
                    value={current.image?.src ?? ''}
                    onChange={(event) =>
                      updateSlide({ image: { src: event.target.value, alt: current.title } })
                    }
                    placeholder="https://…"
                  />
                </label>
              )}

              <label className="field">
                <span className="field-label">Speaker notes</span>
                <textarea
                  className="field-textarea"
                  rows={5}
                  value={current.notes}
                  onChange={(event) => updateSlide({ notes: event.target.value })}
                  placeholder="Only you see these."
                />
              </label>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
