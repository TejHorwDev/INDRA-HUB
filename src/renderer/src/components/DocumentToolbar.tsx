import type { DocBlockType } from '@shared/types'
import {
  BoldIcon,
  CodeInlineIcon,
  DividerIcon,
  ItalicIcon,
  LinkIcon,
  ListBulletIcon,
  ListNumberedIcon,
  MediaIcon,
  QuoteIcon,
  RedoIcon,
  StrikeIcon,
  TableIcon,
  UnderlineIcon,
  UndoIcon
} from './DocIcons'

interface InlineState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
}

interface DocumentToolbarProps {
  activeType: DocBlockType | null
  inline: InlineState
  onType: (type: DocBlockType) => void
  onCommand: (command: 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'undo' | 'redo') => void
  onLink: () => void
  onTable: () => void
  onImage: () => void
  onDivider: () => void
}

function ToolButton({
  label,
  active,
  onClick,
  children
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`tool-icon${active ? ' tool-icon--active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** The writing toolbar: structure on the left, inline formatting, inserts, history. */
export default function DocumentToolbar({
  activeType,
  inline,
  onType,
  onCommand,
  onLink,
  onTable,
  onImage,
  onDivider
}: DocumentToolbarProps) {
  return (
    <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
      <div className="doc-toolbar-inner">
        <div className="tool-group" role="group" aria-label="Text style">
          <button
            type="button"
            className={`tool-pill${activeType === 'paragraph' ? ' tool-pill--active' : ''}`}
            title="Body text"
            aria-pressed={activeType === 'paragraph'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onType('paragraph')}
          >
            Body
          </button>
          {(['heading1', 'heading2', 'heading3'] as const).map((type, index) => (
            <button
              key={type}
              type="button"
              className={`tool-pill${activeType === type ? ' tool-pill--active' : ''}`}
              title={`Heading ${index + 1}`}
              aria-pressed={activeType === type}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onType(type)}
            >
              H{index + 1}
            </button>
          ))}
        </div>

        <span className="tool-divider" aria-hidden="true" />

        <div className="tool-group" role="group" aria-label="Inline formatting">
          <ToolButton label="Bold (Ctrl+B)" active={inline.bold} onClick={() => onCommand('bold')}>
            <BoldIcon />
          </ToolButton>
          <ToolButton label="Italic (Ctrl+I)" active={inline.italic} onClick={() => onCommand('italic')}>
            <ItalicIcon />
          </ToolButton>
          <ToolButton
            label="Underline (Ctrl+U)"
            active={inline.underline}
            onClick={() => onCommand('underline')}
          >
            <UnderlineIcon />
          </ToolButton>
          <ToolButton
            label="Strikethrough"
            active={inline.strike}
            onClick={() => onCommand('strikeThrough')}
          >
            <StrikeIcon />
          </ToolButton>
        </div>

        <span className="tool-divider" aria-hidden="true" />

        <div className="tool-group" role="group" aria-label="Lists and blocks">
          <ToolButton label="Bulleted list" active={activeType === 'bulleted'} onClick={() => onType('bulleted')}>
            <ListBulletIcon />
          </ToolButton>
          <ToolButton label="Numbered list" active={activeType === 'numbered'} onClick={() => onType('numbered')}>
            <ListNumberedIcon />
          </ToolButton>
          <ToolButton label="Quote" active={activeType === 'quote'} onClick={() => onType('quote')}>
            <QuoteIcon />
          </ToolButton>
          <ToolButton label="Code block" active={activeType === 'code'} onClick={() => onType('code')}>
            <CodeInlineIcon />
          </ToolButton>
        </div>

        <span className="tool-divider" aria-hidden="true" />

        <div className="tool-group" role="group" aria-label="Insert">
          <ToolButton label="Link" onClick={onLink}>
            <LinkIcon />
          </ToolButton>
          <ToolButton label="Table" onClick={onTable}>
            <TableIcon />
          </ToolButton>
          <ToolButton label="Image from URL" onClick={onImage}>
            <MediaIcon />
          </ToolButton>
          <ToolButton label="Divider" onClick={onDivider}>
            <DividerIcon />
          </ToolButton>
        </div>

        <span className="tool-divider" aria-hidden="true" />

        <div className="tool-group" role="group" aria-label="History">
          <ToolButton label="Undo" onClick={() => onCommand('undo')}>
            <UndoIcon />
          </ToolButton>
          <ToolButton label="Redo" onClick={() => onCommand('redo')}>
            <RedoIcon />
          </ToolButton>
        </div>
      </div>
    </div>
  )
}
