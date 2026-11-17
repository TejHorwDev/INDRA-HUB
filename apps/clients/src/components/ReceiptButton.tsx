'use client'

/*
 * A receipt, drawn rather than screenshotted.
 *
 * The PNG is composed on a canvas at 2× so it survives being forwarded, re-compressed by
 * WhatsApp and read on a phone. No library, no server, no font download: the browser already
 * has everything the drawing needs, and the file leaves the page as a Blob.
 *
 * Everything it prints is passed in — the component never fetches. That keeps a receipt for
 * one client from being one URL edit away from another client's data.
 */

export interface ReceiptData {
  no: string
  date: string
  amount: number
  currency: string
  method: string | null
  reference: string | null
  note: string | null
  item: string
  clientName: string
  clientCompany: string | null
  clientNo: string
  businessName: string
  businessContact: string
}

const W = 760
const H = 1180
const PAD = 64
const SANS = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'
const MONO = '"Cascadia Mono", "SF Mono", Menlo, Consolas, monospace'

function money(amount: number, currency: string): string {
  const code = currency === 'USD' ? 'USD' : 'NPR'
  return new Intl.NumberFormat(code === 'USD' ? 'en-US' : 'en-IN', {
    style: 'currency',
    currency: code,
    maximumFractionDigits: code === 'USD' ? 2 : 0
  }).format(amount)
}

function day(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export default function ReceiptButton({ data, label = 'Receipt' }: { data: ReceiptData; label?: string }) {
  function draw(): HTMLCanvasElement {
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = W * scale
    canvas.height = H * scale

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.scale(scale, scale)

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    // A thin band of ink at the top: the one deliberate mark on an otherwise blank page.
    ctx.fillStyle = '#0b0b0d'
    ctx.fillRect(0, 0, W, 10)

    ctx.textBaseline = 'alphabetic'

    // ---------------------------------------------------------------- header --
    ctx.fillStyle = '#0b0b0d'
    ctx.font = `600 30px ${SANS}`
    const name = data.businessName || 'Receipt'
    ctx.fillText(name, PAD, 96)

    if (data.businessContact) {
      ctx.fillStyle = '#6b6b74'
      ctx.font = `400 13px ${SANS}`
      ctx.fillText(data.businessContact, PAD, 120)
    }

    ctx.textAlign = 'right'
    ctx.fillStyle = '#6b6b74'
    ctx.font = `600 11px ${SANS}`
    ctx.fillText('R E C E I P T', W - PAD, 78)
    ctx.fillStyle = '#0b0b0d'
    ctx.font = `400 15px ${MONO}`
    ctx.fillText(data.no, W - PAD, 100)
    ctx.textAlign = 'left'

    // ------------------------------------------------------------ separators --
    const rule = (y: number, solid = false) => {
      ctx.save()
      ctx.strokeStyle = solid ? '#0b0b0d' : '#d9d9e0'
      ctx.lineWidth = 1
      ctx.setLineDash(solid ? [] : [4, 5])
      ctx.beginPath()
      ctx.moveTo(PAD, y)
      ctx.lineTo(W - PAD, y)
      ctx.stroke()
      ctx.restore()
    }

    rule(158, true)

    // ----------------------------------------------------------- who and when --
    let y = 200
    const label = (text: string, x: number, yy: number) => {
      ctx.fillStyle = '#9a9aa4'
      ctx.font = `600 10.5px ${SANS}`
      ctx.fillText(text.toUpperCase(), x, yy)
    }
    const value = (text: string, x: number, yy: number, font = `500 15px ${SANS}`, colour = '#0b0b0d') => {
      ctx.fillStyle = colour
      ctx.font = font
      ctx.fillText(text, x, yy)
    }

    label('Billed to', PAD, y)
    label('Issued', W / 2 + 20, y)
    y += 24
    value(data.clientName, PAD, y)
    value(day(data.date), W / 2 + 20, y, `400 15px ${SANS}`, '#3a3a42')

    y += 22
    const sub = [data.clientCompany, data.clientNo].filter(Boolean).join('  ·  ')
    value(sub, PAD, y, `400 12.5px ${SANS}`, '#8a8a94')

    // ---------------------------------------------------------------- the item --
    y += 58
    rule(y)
    y += 34

    ctx.fillStyle = '#9a9aa4'
    ctx.font = `600 10.5px ${SANS}`
    ctx.fillText('DESCRIPTION', PAD, y)
    ctx.textAlign = 'right'
    ctx.fillText('AMOUNT', W - PAD, y)
    ctx.textAlign = 'left'

    y += 34
    ctx.fillStyle = '#0b0b0d'
    ctx.font = `500 16px ${SANS}`
    const itemText = data.item.length > 46 ? `${data.item.slice(0, 45)}…` : data.item
    ctx.fillText(itemText, PAD, y)

    ctx.textAlign = 'right'
    ctx.font = `500 16px ${MONO}`
    ctx.fillText(money(data.amount, data.currency), W - PAD, y)
    ctx.textAlign = 'left'

    // ------------------------------------------------------------ how it was paid --
    y += 46
    const details: [string, string][] = [
      ['Payment method', data.method || '—'],
      ['Reference', data.reference || '—']
    ]
    for (const [key, val] of details) {
      label(key, PAD, y)
      ctx.textAlign = 'right'
      value(val, W - PAD, y, `400 13.5px ${SANS}`, '#3a3a42')
      ctx.textAlign = 'left'
      y += 30
    }

    if (data.note) {
      label('Note', PAD, y)
      y += 22
      ctx.fillStyle = '#3a3a42'
      ctx.font = `400 13px ${SANS}`
      for (const line of wrap(ctx, data.note, W - PAD * 2 - 40)) {
        ctx.fillText(line, PAD, y)
        y += 20
      }
    }

    // ------------------------------------------------------------------ total --
    const totalY = H - 300
    rule(totalY)
    ctx.fillStyle = '#9a9aa4'
    ctx.font = `600 11px ${SANS}`
    ctx.fillText('TOTAL PAID', PAD, totalY + 42)

    ctx.fillStyle = '#0b0b0d'
    ctx.font = `500 40px ${SANS}`
    ctx.fillText(money(data.amount, data.currency), PAD, totalY + 92)

    // The stamp, rotated slightly — a receipt looks paid when somebody put a mark on it.
    ctx.save()
    ctx.translate(W - PAD - 78, totalY + 58)
    ctx.rotate(-0.12)
    ctx.strokeStyle = '#1d7a56'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(-62, -26, 124, 52, 10)
    ctx.stroke()
    ctx.fillStyle = '#1d7a56'
    ctx.font = `700 19px ${SANS}`
    ctx.textAlign = 'center'
    ctx.fillText('PAID', 0, 7)
    ctx.restore()

    // ----------------------------------------------------------------- footer --
    rule(H - 150)
    ctx.fillStyle = '#9a9aa4'
    ctx.font = `400 12px ${SANS}`
    ctx.fillText('Thank you for your business.', PAD, H - 108)
    ctx.font = `400 11.5px ${MONO}`
    ctx.fillStyle = '#b6b6be'
    ctx.fillText(data.no, PAD, H - 84)

    ctx.textAlign = 'right'
    ctx.fillText(data.businessContact || '', W - PAD, H - 84)
    ctx.textAlign = 'left'

    return canvas
  }

  function download() {
    const canvas = draw()
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `receipt-${data.no}.png`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    }, 'image/png')
  }

  return (
    <button type="button" className="quiet small" onClick={download} title={`Download ${data.no}.png`}>
      {label} ↓
    </button>
  )
}

/** Splits a sentence across lines at word boundaries, measuring with the current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width > max && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
    if (lines.length >= 3) return lines
  }

  if (line) lines.push(line)
  return lines
}
