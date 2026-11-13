import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiAnswer, AiDepth, AiMode, CreditsState } from '@shared/types'
import { useToast } from './ToastProvider'
import { Link } from 'react-router-dom'
import { InfoIcon, SparkIcon } from './icons'
import { api, errorCode, errorMessage } from '../lib/api'
import { formatRelative } from '../lib/format'

/*
 * The research panel inside a document.
 *
 * Two things it deliberately does not do: it never invents a quote or a source
 * (the brief comes back with the URLs the model was actually given, and they
 * are shown before anything is inserted), and it never claims a cost it did not
 * see — the tokens and the credits under the answer are the numbers the Edge
 * Function charged.
 *
 * Inserting is an ordinary edit of the open document: the same blocks, the same
 * dirty flag, the same save. Nothing is written behind the editor's back.
 */

interface AiAssistantProps {
  projectId: string
  documentId: string
  documentTitle: string
  /** The person's selected text, when there is a selection inside the page. */
  selection: string
  /** Appends the brief to the document as real blocks. */
  onInsert: (answer: AiAnswer) => void
}

const QUICK: Array<{ label: string; prompt: string; mode: AiMode }> = [
  {
    label: 'What am I missing?',
    prompt:
      'Read this document and name the three things a careful reader would say are missing or unsupported. Be specific about where.',
    mode: 'chat'
  },
  {
    label: 'Tighten this',
    prompt: 'Rewrite the current text more tightly without losing any claim. Return only the rewrite.',
    mode: 'chat'
  },
  {
    label: 'Find the counter-argument',
    prompt: 'What is the strongest counter-argument to the position in this document, and who makes it?',
    mode: 'research'
  }
]

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * A deliberately small Markdown renderer: headings, lists, quotes, emphasis,
 * links, and [n] citations as superscripts. Everything is escaped first, so a
 * model cannot inject markup into the workspace.
 */
export function markdownToHtml(source: string): string {
  const lines = escapeHtml(source).split(/\r?\n/)
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null

  const closeList = (): void => {
    if (list) {
      out.push(`</${list}>`)
      list = null
    }
  }

  const inline = (text: string): string =>
    text
      .replace(/\[(\d{1,2})\]/g, '<sup>[$1]</sup>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      closeList()
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line)
    if (bullet) {
      if (list !== 'ul') {
        closeList()
        out.push('<ul>')
        list = 'ul'
      }
      out.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }
    const ordered = /^\d{1,2}[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      if (list !== 'ol') {
        closeList()
        out.push('<ol>')
        list = 'ol'
      }
      out.push(`<li>${inline(ordered[1])}</li>`)
      continue
    }
    if (line.startsWith('>')) {
      closeList()
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`)
      continue
    }
    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}

function stageLabel(mode: AiMode, depth: AiDepth): string {
  if (mode === 'chat') return 'Writing with the document in view'
  return depth === 'deep'
    ? 'Planning, reading sources, then writing the brief — deep runs can take a minute'
    : 'Planning, reading sources, then writing the brief'
}

export default function AiPanel({
  projectId,
  documentId,
  documentTitle,
  selection,
  onInsert
}: AiAssistantProps) {
  const toast = useToast()
  const [mode, setMode] = useState<AiMode>('chat')
  const [depth, setDepth] = useState<AiDepth>('standard')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [answer, setAnswer] = useState<AiAnswer | null>(null)
  const [failure, setFailure] = useState<{ message: string; credits: boolean } | null>(null)
  const [state, setState] = useState<CreditsState | null>(null)
  const [history, setHistory] = useState<{ role: 'user' | 'model'; text: string }[]>([])
  const bottom = useRef<HTMLDivElement | null>(null)

  const refreshState = useCallback(async () => {
    const next = await api.credits.state(true).catch(() => null)
    if (next) setState(next)
  }, [])

  useEffect(() => {
    void refreshState()
  }, [refreshState])

  /* The clock is real: it counts how long the run has been going, nothing else. */
  useEffect(() => {
    if (startedAt === null) return
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 500)
    return () => window.clearInterval(timer)
  }, [startedAt])

  const rich = useMemo(() => (answer ? markdownToHtml(answer.answer) : ''), [answer])

  const ahead = state ? state.total : null
  const usable = state?.connected === true && (ahead ?? 0) >= 1
  const blockedReason = !state
    ? 'Reading the balance…'
    : !state.connected
      ? 'AI needs the cloud. Sign in to an account to use it — the offline workspace writes on its own.'
      : (ahead ?? 0) < 1
        ? 'No credits left today. The allowance resets at midnight UTC.'
        : null

  async function run() {
    const question = prompt.trim()
    if (!question || busy) return
    setFailure(null)
    setBusy(true)
    setStartedAt(Date.now())
    setElapsed(0)
    try {
      const call = mode === 'research' ? api.ai.research : api.ai.ask
      const result = await call({
        projectId,
        documentId,
        prompt: question,
        selection: selection.slice(0, 6000) || undefined,
        depth: mode === 'research' ? depth : undefined,
        history
      })
      setAnswer(result)
      setHistory((current) =>
        [...current, { role: 'user' as const, text: question }, { role: 'model' as const, text: result.answer }].slice(-8)
      )
      if (result.balance) setState(result.balance)
      setPrompt('')
      if (result.exhausted) {
        toast.error('The run stopped when the credits ran out. What was written before that is below.')
      }
      window.setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 60)
    } catch (error) {
      setFailure({
        message: errorMessage(error),
        credits: errorCode(error) === 'INSUFFICIENT_CREDITS'
      })
      await refreshState()
    } finally {
      setBusy(false)
      setStartedAt(null)
    }
  }

  function insert() {
    if (!answer) return
    onInsert(answer)
    toast.success(
      answer.mode === 'research'
        ? 'The brief and its sources were added to the document.'
        : 'The draft was added to the document.'
    )
  }

  async function copy() {
    if (!answer) return
    try {
      await navigator.clipboard.writeText(answer.answer)
      toast.success('Copied.')
    } catch {
      toast.error('Could not reach the clipboard — select the text and copy it.')
    }
  }

  return (
    <aside className="ai-panel" aria-label="Research assistant">
      <div className="ai-head">
        <span className="ai-head-title">
          <SparkIcon size={15} />
          Research
        </span>
        <span
          className={`ai-credit-chip${(ahead ?? 0) < 5 ? ' ai-credit-chip--low' : ''}`}
          title="Credits left on this account, as last confirmed by the server"
        >
          {state?.connected ? `${(ahead ?? 0).toLocaleString('en-IN')} credits` : 'no cloud'}
        </span>
        {selection.trim() && (
          <span className="ai-credit-chip" title="The selected passage is sent with the question">
            selection
          </span>
        )}
      </div>

      <div className="ai-modes" role="group" aria-label="Mode">
        <button
          type="button"
          className="ai-mode"
          aria-pressed={mode === 'chat'}
          onClick={() => setMode('chat')}
        >
          Write
        </button>
        <button
          type="button"
          className="ai-mode"
          aria-pressed={mode === 'research'}
          onClick={() => setMode('research')}
        >
          Research
        </button>
      </div>

      {mode === 'research' && (
        <div className="ai-depth">
          <span>Depth</span>
          <button
            type="button"
            className="ai-depth-link"
            aria-pressed={depth === 'standard'}
            onClick={() => setDepth('standard')}
          >
            Standard
          </button>
          <button
            type="button"
            className="ai-depth-link"
            aria-pressed={depth === 'deep'}
            onClick={() => setDepth('deep')}
          >
            Deep
          </button>
          <span className="ml-auto">{depth === 'deep' ? 'up to 6 searches' : '3 searches'}</span>
        </div>
      )}

      <div className="ai-scroll">
        {!answer && !busy && (
          <div className="ai-empty">
            <strong>{mode === 'research' ? 'Research a topic into this page' : 'Work on this page'}</strong>
            {mode === 'research'
              ? 'The model plans the questions that matter, searches for each one, reads the results, and writes a brief with the sources it used. You see the sources before anything is inserted.'
              : `It reads “${documentTitle || 'this document'}” and writes in its voice. ${selection.trim() ? 'The selected passage is included.' : 'Select a passage to work on just that.'}`}
            <div className="ai-quick">
              {QUICK.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setMode(item.mode)
                    setPrompt(item.prompt)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {busy && (
          <div className="ai-stage">
            <span className="ai-pulse" aria-hidden="true" />
            <span>
              {stageLabel(mode, depth)} · {elapsed}s
            </span>
          </div>
        )}

        {failure && (
          <div className="notice items-start">
            <InfoIcon />
            <span>
              {failure.message}
              {failure.credits && (
                <>
                  {' '}
                  <Link to="/credits" className="link-quiet">
                    Open Credits
                  </Link>
                </>
              )}
            </span>
          </div>
        )}

        {answer && (
          <>
            {answer.outline.length > 0 && (
              <div className="ai-outline">
                <p>Questions it worked through</p>
                <ol>
                  {answer.outline.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ol>
              </div>
            )}

            <div className="ai-answer" dangerouslySetInnerHTML={{ __html: rich }} />

            {answer.citations.length > 0 && (
              <div className="ai-sources">
                <h4>Sources</h4>
                <ol>
                  {answer.citations.map((source, index) => (
                    <li key={source.url}>
                      <span className="num">{index + 1}</span>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="ai-cost">
              <span>{answer.usage.total.toLocaleString('en-IN')} tokens</span>
              <span aria-hidden="true">·</span>
              <span>{answer.usage.cost.toLocaleString('en-IN')} credits charged</span>
              {answer.balance && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{answer.balance.total.toLocaleString('en-IN')} left</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{Math.round(answer.ms / 1000)}s</span>
            </div>

            <div className="ai-actions">
              <button type="button" className="btn btn-primary btn-sm w-auto" onClick={insert}>
                Add to document
              </button>
              <button type="button" className="btn btn-ghost btn-sm w-auto" onClick={() => void copy()}>
                Copy
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm w-auto"
                onClick={() => setAnswer(null)}
              >
                Clear
              </button>
            </div>
          </>
        )}

        <div ref={bottom} />
      </div>

      <div className="ai-compose">
        <textarea
          className="ai-textarea"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void run()
            }
          }}
          placeholder={
            mode === 'research'
              ? 'What should this piece be about? e.g. the economics of grid-scale storage in India'
              : 'Ask for a paragraph, a rewrite, or a sharper argument…'
          }
          aria-label="Ask the assistant"
          disabled={busy}
        />
        <div className="ai-compose-foot">
          <span className="ai-hint">
            {blockedReason ?? (state?.cached ? 'Balance last synced from the cloud.' : 'Ctrl+Enter to run')}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm w-auto"
            onClick={() => void run()}
            disabled={busy || !prompt.trim() || !usable}
          >
            {busy ? 'Working…' : mode === 'research' ? 'Research' : 'Write'}
          </button>
        </div>
        {state?.syncedAt && !state.cached && (
          <p className="ai-hint mt-2">Balance read {formatRelative(state.syncedAt)}</p>
        )}
      </div>
    </aside>
  )
}
