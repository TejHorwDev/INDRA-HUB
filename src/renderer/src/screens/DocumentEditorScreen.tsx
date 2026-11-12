import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type {
  DocBlock,
  DocBlockType,
  DocumentDetail,
  DocumentVersionSummary
} from '@shared/types'
import ConfirmDialog from '../components/ConfirmDialog'
import DocumentToolbar from '../components/DocumentToolbar'
import EmptyState from '../components/EmptyState'
import { useToast } from '../components/ToastProvider'
import { AlertCircleIcon, ChevronLeftIcon, PlusIcon } from '../components/icons'
import { HistoryIcon, PresentationIcon } from '../components/DocIcons'
import { api, errorCode, errorMessage } from '../lib/api'
import { formatClock, formatRelative } from '../lib/format'

function blockText(html: string | undefined): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function makeBlock(type: DocBlockType = 'paragraph', html = ''): DocBlock {
  return { id: crypto.randomUUID(), type, html }
}

export default function DocumentEditorScreen() {
  const { projectId = '', documentId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()

  const [doc, setDoc] = useState<DocumentDetail | null>(null)
  const [blocks, setBlocks] = useState<DocBlock[]>([])
  const [title, setTitle] = useState('')
  const [version, setVersion] = useState(1)
  const [epoch, setEpoch] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error' | 'conflict'>(
    'saved'
  )
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<DocumentVersionSummary[] | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<DocumentVersionSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [converting, setConverting] = useState(false)

  const refs = useRef(new Map<string, HTMLElement>())
  const activeBlockRef = useRef<string | null>(null)
  const [activeType, setActiveType] = useState<DocBlockType | null>(null)
  const [inlineState, setInlineState] = useState({
    bold: false,
    italic: false,
    underline: false,
    strike: false
  })
  const focusedBlock = (): string | null =>
    (window.document.activeElement as HTMLElement | null)?.dataset?.blockId ??
    activeBlockRef.current
  const focusAfterRender = useRef<string | null>(null)
  const savingRef = useRef(false)
  const latest = useRef({ blocks, title, version, saveState })

  useEffect(() => {
    latest.current = { blocks, title, version, saveState }
  })

  /** Reads what the caret is inside so the toolbar reflects the real format. */
  const syncFormat = useCallback(() => {
    const id =
      (window.document.activeElement as HTMLElement | null)?.dataset?.blockId ??
      activeBlockRef.current
    if (!id) return
    setActiveType(latest.current.blocks.find((block) => block.id === id)?.type ?? null)
    try {
      setInlineState({
        bold: window.document.queryCommandState('bold'),
        italic: window.document.queryCommandState('italic'),
        underline: window.document.queryCommandState('underline'),
        strike: window.document.queryCommandState('strikeThrough')
      })
    } catch {
      setInlineState({ bold: false, italic: false, underline: false, strike: false })
    }
  }, [])

  useEffect(() => {
    const handler = (): void => syncFormat()
    window.document.addEventListener('selectionchange', handler)
    return () => window.document.removeEventListener('selectionchange', handler)
  }, [syncFormat])

  /* ---------------- load ---------------- */

  useEffect(() => {
    let active = true
    api.documents
      .get(projectId, documentId)
      .then((loaded) => {
        if (!active) return
        setDoc(loaded)
        setBlocks(loaded.blocks.length > 0 ? loaded.blocks : [makeBlock()])
        setTitle(loaded.title)
        setVersion(loaded.version)
        setSavedAt(loaded.updatedAt)
        setSaveState('saved')
      })
      .catch((failure) => {
        if (active) setLoadError(errorMessage(failure))
      })
    return () => {
      active = false
    }
  }, [documentId, projectId])

  /* ---------------- saving ---------------- */

  const save = useCallback(async () => {
    if (savingRef.current) return
    const snapshot = latest.current
    if (snapshot.saveState === 'saving') return
    savingRef.current = true
    setSaveState('saving')
    setSaveMessage(null)
    try {
      const saved = await api.documents.save(projectId, documentId, {
        blocks: snapshot.blocks,
        title: snapshot.title,
        baseVersion: snapshot.version
      })
      setVersion(saved.version)
      latest.current.version = saved.version
      setSavedAt(new Date().toISOString())
      // Edits made while the request was in flight still need a save.
      const after = latest.current
      setSaveState(after.blocks !== snapshot.blocks || after.title !== snapshot.title ? 'dirty' : 'saved')
    } catch (failure) {
      const code = errorCode(failure)
      setSaveState(code === 'CONFLICT' ? 'conflict' : 'error')
      setSaveMessage(errorMessage(failure))
    } finally {
      savingRef.current = false
    }
  }, [documentId, projectId])

  // Debounced autosave: edits mark the document dirty, not the keystrokes.
  useEffect(() => {
    if (saveState !== 'dirty') return
    const timer = window.setTimeout(() => void save(), 1200)
    return () => window.clearTimeout(timer)
  }, [blocks, save, saveState, title])

  // Best-effort flush if the screen unmounts with unsaved changes. Wait for any
  // in-flight save first, otherwise two writes could land out of order.
  useEffect(
    () => () => {
      void (async () => {
        for (let attempt = 0; attempt < 30 && savingRef.current; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        const snapshot = latest.current
        if (snapshot.saveState !== 'dirty') return
        try {
          await api.documents.save(projectId, documentId, {
            blocks: snapshot.blocks,
            title: snapshot.title,
            baseVersion: snapshot.version
          })
        } catch {
          // Navigation cannot surface an error here; the next open will show the saved version.
        }
      })()
    },
    [documentId, projectId]
  )

  const markDirty = useCallback(() => {
    setSaveState((current) => (current === 'conflict' ? current : 'dirty'))
  }, [])

  /* ---------------- editing ---------------- */

  const updateBlock = useCallback(
    (id: string, html: string) => {
      setBlocks((current) => current.map((block) => (block.id === id ? { ...block, html } : block)))
      markDirty()
    },
    [markDirty]
  )

  function convertType(id: string, type: DocBlockType) {
    setBlocks((current) =>
      current.map((block) => {
        if (block.id !== id) return block
        const text = (block.html ?? '').trim()
        if (type === 'bulleted') {
          return {
            ...block,
            type,
            rows: undefined,
            html: text && !text.startsWith('<ul') ? `<ul><li>${text}</li></ul>` : text || '<ul><li></li></ul>'
          }
        }
        if (type === 'numbered') {
          return {
            ...block,
            type,
            rows: undefined,
            html: text && !text.startsWith('<ol') ? `<ol><li>${text}</li></ol>` : text || '<ol><li></li></ol>'
          }
        }
        if (type === 'table') {
          return { ...block, type, html: undefined, rows: [['', ''], ['', '']] }
        }
        if (type === 'divider') return { ...block, type, html: undefined }
        if (type === 'image') return { ...block, type, html: undefined, src: block.src ?? '' }
        // Unwrapping a list keeps every item, one per line, instead of leaving orphan <li> tags.
        if (/<li[\s>]/i.test(text)) {
          const items = [...text.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(
            (match) => `<div>${match[1]}</div>`
          )
          return { ...block, type, html: items.join('') }
        }
        return { ...block, type, html: text.replace(/<\/?(ul|ol)>/gi, '') }
      })
    )
    // Remounting the block drops the caret: put it back and keep the toolbar honest.
    setActiveType(type)
    focusAfterRender.current = id
    markDirty()
  }

  function insertTable() {
    const block: DocBlock = {
      id: crypto.randomUUID(),
      type: 'table',
      rows: [
        ['', ''],
        ['', '']
      ]
    }
    const current = focusedBlock()
    setBlocks((list) => {
      const index = current ? list.findIndex((entry) => entry.id === current) : -1
      if (index === -1) return [...list, block]
      const next = [...list]
      next.splice(index + 1, 0, block)
      return next
    })
    markDirty()
  }

  function insertLink() {
    const url = window.prompt('Link URL')
    if (url) exec('createLink', url)
  }

  function insertImage() {
    const src = window.prompt('Image URL')
    if (!src) return
    setBlocks((current) => [
      ...current,
      { id: crypto.randomUUID(), type: 'image', src, alt: '' }
    ])
    markDirty()
  }

  function insertDivider() {
    setBlocks((current) => [...current, { id: crypto.randomUUID(), type: 'divider' }])
    markDirty()
  }

  function insertAfter(id: string) {
    const block = makeBlock()
    setBlocks((current) => {
      const index = current.findIndex((entry) => entry.id === id)
      if (index === -1) return [...current, block]
      const next = [...current]
      next.splice(index + 1, 0, block)
      return next
    })
    focusAfterRender.current = block.id
    markDirty()
  }

  function removeBlock(id: string) {
    setBlocks((current) => {
      if (current.length === 1) return [makeBlock()]
      return current.filter((block) => block.id !== id)
    })
    markDirty()
  }

  useEffect(() => {
    const id = focusAfterRender.current
    if (!id) return
    focusAfterRender.current = null
    const element = refs.current.get(id)
    if (!element) return
    element.focus()
    // Land the caret at the end of the block (or its first item, for lists).
    const host = (element.querySelector('li') as HTMLElement | null) ?? element
    const range = window.document.createRange()
    range.selectNodeContents(host)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    syncFormat()
  }, [blocks, syncFormat])

  function exec(command: string, value?: string) {
    document.execCommand(command, false, value)
    syncFormat()
    const target = focusedBlock()
    if (target) {
      const element = refs.current.get(target)
      if (element) updateBlock(target, element.innerHTML)
    }
  }

  const stats = useMemo(() => {
    const text = blocks
      .map((block) =>
        block.type === 'table'
          ? (block.rows ?? []).flat().join(' ')
          : blockText(block.html)
      )
      .join(' ')
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    return { words, characters: text.replace(/\s/g, '').length }
  }, [blocks])

  /* ---------------- versions ---------------- */

  async function openVersions() {
    setVersionsOpen(true)
    setVersions(null)
    try {
      setVersions(await api.documents.versions(projectId, documentId))
    } catch (failure) {
      toast.error(errorMessage(failure))
      setVersions([])
    }
  }

  async function restoreVersion(target: DocumentVersionSummary) {
    setBusy(true)
    try {
      const restored = await api.documents.restore(projectId, documentId, target.version)
      setBlocks(restored.blocks)
      setTitle(restored.title)
      setVersion(restored.version)
      setEpoch((value) => value + 1)
      setSavedAt(new Date().toISOString())
      setSaveState('saved')
      setRestoreTarget(null)
      setVersionsOpen(false)
      toast.success(`Restored version ${target.version}.`)
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  async function convertToPresentation() {
    setConverting(true)
    try {
      if (saveState !== 'saved') await save()
      const presentation = await api.presentations.convert(projectId, documentId)
      toast.success(`${presentation.slides.length} slides generated (no AI used).`)
      navigate(`/project/${projectId}/presentations/${presentation.id}`)
    } catch (failure) {
      toast.error(errorMessage(failure))
    } finally {
      setConverting(false)
    }
  }

  if (loadError) {
    return (
      <div className="doc-editor">
        <EmptyState
          icon={<AlertCircleIcon size={18} />}
          title="Couldn’t open this document"
          description={loadError}
          action={
            <Link to={`/project/${projectId}/documents`} className="btn btn-ghost w-auto">
              Back to documents
            </Link>
          }
        />
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="doc-editor" aria-busy="true">
        <div className="doc-scroll">
          <div className="doc-page">
            <span className="skeleton" style={{ display: 'block', height: 18, width: '45%' }} />
            <span
              className="skeleton"
              style={{ display: 'block', height: 12, marginTop: 18, width: '92%' }}
            />
            <span
              className="skeleton"
              style={{ display: 'block', height: 12, marginTop: 10, width: '88%' }}
            />
          </div>
        </div>
      </div>
    )
  }

  const statusText =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'dirty'
        ? 'Unsaved changes'
        : saveState === 'error'
          ? 'Save failed'
          : saveState === 'conflict'
            ? 'Out of date'
            : savedAt
              ? `Saved ${formatClock(savedAt)}`
              : 'Saved'

  return (
    <div className="doc-editor">
      <header className="doc-bar">
        <Link to={`/project/${projectId}/documents`} className="workspace-back">
          <ChevronLeftIcon size={14} />
          Documents
        </Link>

        <span className="doc-crumb">{title.trim() || 'Untitled document'}</span>

        <span className={`doc-status doc-status--${saveState}`}>
          <span className="doc-status-dot" aria-hidden="true" />
          {statusText}
        </span>

        <div className="doc-bar-actions">
          <button
            type="button"
            className="tool-icon"
            onClick={openVersions}
            title="Version history"
            aria-label="Version history"
          >
            <HistoryIcon size={15} />
          </button>
          <span className="tool-divider" aria-hidden="true" />
          <button
            type="button"
            className="btn btn-ghost btn-sm w-auto"
            onClick={() => void convertToPresentation()}
            disabled={converting}
            title="Convert to presentation — rule-based, works offline"
          >
            <PresentationIcon size={14} />
            {converting ? 'Converting…' : 'Convert'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm w-auto"
            onClick={() => void save()}
            disabled={saveState === 'saving' || saveState === 'saved'}
          >
            Save
          </button>
        </div>
      </header>

      <DocumentToolbar
        activeType={activeType}
        inline={inlineState}
        onType={(type) => {
          const id = focusedBlock()
          if (id) convertType(id, type)
        }}
        onCommand={(command) => exec(command)}
        onLink={insertLink}
        onTable={insertTable}
        onImage={insertImage}
        onDivider={insertDivider}
      />

      {saveMessage && (
        <div className="doc-alert" role="alert">
          {saveMessage}
          {saveState === 'conflict' && (
            <button
              type="button"
              className="link-quiet text-sm"
              onClick={() => window.location.reload()}
            >
              Reload document
            </button>
          )}
        </div>
      )}

      <div className="doc-scroll">
        <div className="doc-page">
          <input
            className="doc-title-input"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              markDirty()
            }}
            aria-label="Document title"
            placeholder="Untitled document"
            maxLength={120}
          />
          <div className="doc-meta">
            <span>{formatRelative(savedAt ?? doc.updatedAt)}</span>
            <span aria-hidden="true">·</span>
            <span>Version {version}</span>
            <span aria-hidden="true">·</span>
            <span>{doc.createdBy.displayName}</span>
          </div>
          <div className="doc-title-rule" />

          {blocks.map((block, index) => (
            <div className="doc-block" key={`${block.id}:${block.type}:${epoch}`}>
              {block.type === 'divider' ? (
                <hr className="doc-divider" />
              ) : block.type === 'table' ? (
                <div className="doc-table-wrap">
                  <table className="doc-table-editor">
                    <tbody>
                      {(block.rows ?? []).map((row, rowIndex) => (
                        <tr key={rowIndex} className={rowIndex === 0 ? 'doc-table-head' : undefined}>
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex}>
                              <input
                                value={cell}
                                onChange={(event) => {
                                  const value = event.target.value
                                  setBlocks((current) =>
                                    current.map((entry) => {
                                      if (entry.id !== block.id) return entry
                                      const rows = (entry.rows ?? []).map((line, index2) =>
                                        index2 === rowIndex
                                          ? line.map((value2, index3) =>
                                              index3 === cellIndex ? value : value2
                                            )
                                          : line
                                      )
                                      return { ...entry, rows }
                                    })
                                  )
                                  markDirty()
                                }}
                                aria-label={`Row ${rowIndex + 1} column ${cellIndex + 1}`}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="doc-table-tools">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm w-auto"
                      onClick={() => {
                        setBlocks((current) =>
                          current.map((entry) =>
                            entry.id === block.id
                              ? { ...entry, rows: [...(entry.rows ?? []), ['', '']] }
                              : entry
                          )
                        )
                        markDirty()
                      }}
                    >
                      Add row
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm w-auto"
                      onClick={() => {
                        setBlocks((current) =>
                          current.map((entry) =>
                            entry.id === block.id
                              ? { ...entry, rows: (entry.rows ?? []).map((row) => [...row, '']) }
                              : entry
                          )
                        )
                        markDirty()
                      }}
                    >
                      Add column
                    </button>
                  </div>
                </div>
              ) : block.type === 'image' ? (
                <div className="doc-image-block">
                  {block.src ? (
                    <img src={block.src} alt={block.alt ?? ''} />
                  ) : (
                    <p className="field-hint">No image URL set.</p>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm w-auto"
                    onClick={() => {
                      const src = window.prompt('Image URL', block.src ?? '')
                      if (src === null) return
                      setBlocks((current) =>
                        current.map((entry) => (entry.id === block.id ? { ...entry, src } : entry))
                      )
                      markDirty()
                    }}
                  >
                    Set image URL
                  </button>
                </div>
              ) : (
                <div
                  ref={(element) => {
                    if (!element) {
                      refs.current.delete(block.id)
                      return
                    }
                    refs.current.set(block.id, element)
                    // Seed the HTML once and then let the browser own the DOM.
                    // Re-writing innerHTML on every keystroke is what made text
                    // land at the start of the line (the caret reset each time).
                    if (element.dataset.seeded !== '1') {
                      element.innerHTML = block.html ?? ''
                      element.dataset.seeded = '1'
                    }
                  }}
                  className={`doc-content doc-content--${block.type}`}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck
                  role="textbox"
                  aria-multiline="true"
                  aria-label={`Block ${index + 1}`}
                  data-block-id={block.id}
                  data-placeholder={
                    block.type === 'heading1'
                      ? 'Heading'
                      : block.type === 'code'
                        ? 'Code'
                        : 'Start writing…'
                  }
                  onFocus={() => {
                    activeBlockRef.current = block.id
                    syncFormat()
                  }}
                  onInput={(event) => updateBlock(block.id, event.currentTarget.innerHTML)}
                  onPaste={(event) => {
                    event.preventDefault()
                    const text = event.clipboardData.getData('text/plain')
                    document.execCommand('insertText', false, text)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && block.type !== 'code') {
                      if (block.type === 'bulleted' || block.type === 'numbered') return
                      event.preventDefault()
                      insertAfter(block.id)
                    }
                    if (
                      event.key === 'Backspace' &&
                      (event.currentTarget.textContent ?? '').trim() === '' &&
                      block.type !== 'bulleted' &&
                      block.type !== 'numbered'
                    ) {
                      event.preventDefault()
                      removeBlock(block.id)
                    }
                  }}
                />
              )}

              {block.type !== 'divider' && (
                <button
                  type="button"
                  className="doc-block-remove"
                  onClick={() => removeBlock(block.id)}
                  aria-label="Remove block"
                  title="Remove block"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            className="doc-add-block"
            onClick={() => {
              const block = makeBlock()
              setBlocks((current) => [...current, block])
              focusAfterRender.current = block.id
              markDirty()
            }}
          >
            <PlusIcon size={14} /> Add block
          </button>

        </div>
      </div>

      <div className="doc-statusbar">
        <span>
          {stats.words} {stats.words === 1 ? 'word' : 'words'} · {stats.characters}{' '}
          {stats.characters === 1 ? 'character' : 'characters'}
        </span>
        <span className="doc-statusbar-right">
          <span>{formatRelative(doc.updatedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>Version {version}</span>
        </span>
      </div>

      <dialog
        className="modal"
        aria-label="Version history"
        ref={(element) => {
          const dialog = element
          if (!dialog) return
          if (versionsOpen && !dialog.open) dialog.showModal()
          if (!versionsOpen && dialog.open) dialog.close()
        }}
        onCancel={(event) => {
          event.preventDefault()
          setVersionsOpen(false)
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setVersionsOpen(false)
        }}
      >
        <div className="modal-panel">
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div>
              <h2 className="text-[17px] font-semibold text-[var(--ink)]">Version history</h2>
              <p className="mt-1 text-sm text-[var(--ink-tertiary)]">
                Each save keeps a snapshot. Restoring adds a new version.
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setVersionsOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="px-3 pb-4">
            {versions === null ? (
              <p className="member-hint">Loading versions…</p>
            ) : versions.length === 0 ? (
              <p className="member-hint">No versions yet.</p>
            ) : (
              <ul className="member-results">
                {versions.map((entry) => (
                  <li key={entry.version} className="member-result">
                    <span className="badge">v{entry.version}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--ink)]">
                        {entry.title}
                      </span>
                      <span className="block truncate text-xs text-[var(--ink-tertiary)]">
                        {entry.editor?.displayName ?? 'Unknown'} · {formatRelative(entry.createdAt)}
                      </span>
                    </span>
                    {entry.version === version ? (
                      <span className="badge badge--accent">Current</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm w-auto"
                        onClick={() => setRestoreTarget(entry)}
                      >
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </dialog>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        title="Restore version"
        confirmLabel="Restore"
        pending={busy}
        onCancel={() => {
          if (!busy) setRestoreTarget(null)
        }}
        onConfirm={() => {
          if (restoreTarget) void restoreVersion(restoreTarget)
        }}
      >
        Restore version {restoreTarget?.version}? Your current content stays in history, so this is
        not destructive.
      </ConfirmDialog>
    </div>
  )
}
