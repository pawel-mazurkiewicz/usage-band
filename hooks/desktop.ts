// The desktop's pieces of the band, drawn as SVG images.
// Its Text takes no monospaced face, so the text that must line up is set here instead: in the
// system's monospaced font, every run at an x worked out from the font's fixed advance, icons
// drawn as shapes rather than borrowed from a fallback font that would change the widths.

export const FONT = 12
export const CH = FONT * 0.602 // SF Mono's and Menlo's advance
const FAMILY = `ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace`

// Mid tones that read on the desktop's light and dark themes alike.
export const INK = {
  dim: '#858b96',
  text: '#8e95a1',
  folder: '#e0a42a',
  branch: '#14b8a6',
  sync: '#3b82f6',
  dirty: '#f59e0b',
  say: '#ec4899',
}

export type Icon = 'folder' | 'branch' | 'clock' | 'bolt' | 'snow' | 'reset' | 'swatch'

// Each icon in a 10 by 10 box, its colour `currentColor`.
const ICONS: Record<Icon, string> = {
  swatch: '<rect x="1" y="1.5" width="8" height="8" rx="2.2" fill="currentColor"/>',
  folder: '<path d="M0.5 2.5h3.2l1 1.1h4.8v5H0.5z" fill="currentColor"/>',
  branch:
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">' +
    '<circle cx="2.5" cy="2" r="1.3"/><circle cx="2.5" cy="8.2" r="1.3"/><circle cx="7.8" cy="3.6" r="1.3"/>' +
    '<path d="M2.5 3.3v3.6M7.8 4.9c0 2-5.3 1.4-5.3 2.2"/></g>',
  clock:
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">' +
    '<circle cx="5" cy="5" r="4.2"/><path d="M5 2.6V5l1.8 1.2"/></g>',
  bolt: '<path d="M6 0.2 1.4 5.8h3.2L3.7 9.8 8.6 3.8H5.3z" fill="currentColor"/>',
  snow:
    '<g stroke="currentColor" stroke-width="1.2" stroke-linecap="round">' +
    '<path d="M5 0.6v8.8M1.2 2.8l7.6 4.4M1.2 7.2l7.6-4.4"/></g>',
  reset:
    '<g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M8.6 5.2A3.7 3.7 0 1 1 7.3 2.2"/><path d="M7.6 0.6v2.1H5.5"/></g>',
}

const ICON_W = 10
const ICON_GAP = 4

/** A piece of a line: text in one colour, or an icon; `width` pins it to so many cells (right-aligned with `end`). */
export type Run = {
  text?: string
  icon?: Icon
  color: string
  bold?: boolean
  italic?: boolean
  cells?: number
  end?: boolean
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const cells = (s: string) => [...s].length

/** How wide a line of runs is, in pixels. */
export function runsWidth(runs: Run[]): number {
  return runs.reduce((x, r) => x + runWidth(r), 0)
}

function runWidth(r: Run): number {
  if (r.icon) return ICON_W + ICON_GAP
  return (r.cells ?? cells(r.text ?? '')) * CH
}

/** The runs from `x`, on a baseline at `y`, as SVG markup. */
function drawRuns(runs: Run[], x: number, y: number): string {
  let out = ''
  for (const r of runs) {
    const w = runWidth(r)
    if (r.icon) {
      out += `<g transform="translate(${x.toFixed(1)} ${y - 9})" color="${r.color}">${ICONS[r.icon]}</g>`
    } else if (r.text) {
      const at = r.end ? x + w : x
      const style = `${r.bold ? ' font-weight="600"' : ''}${r.italic ? ' font-style="italic"' : ''}`
      out += `<text x="${at.toFixed(1)}" y="${y}" xml:space="preserve"${r.end ? ' text-anchor="end"' : ''} fill="${r.color}"${style}>${escape(r.text)}</text>`
    }
    x += w
  }

  return out
}

const svg = (w: number, h: number, body: string, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${h}" viewBox="0 0 ${Math.ceil(w)} ${h}" ` +
  `font-family="${FAMILY}" font-size="${FONT}" style="white-space:pre">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`

export type Picture = { source: string; width: number; height: number }

/** Lines of runs stacked, 16px apart. */
export function lines(rows: Run[][]): Picture {
  const width = Math.max(1, ...rows.map(runsWidth))
  const height = rows.length * 16
  const body = rows.map((runs, i) => drawRuns(runs, 0, 12 + i * 16)).join('')

  return { source: svg(width, height, body), width: Math.ceil(width), height }
}

/**
 * One meter: a label `labelCells` wide, a rounded bar `barPx` long with the heat ramp laid across
 * its whole length and shown up to `percent`, the percentage right-aligned, then the detail.
 */
export function meter(m: {
  label: string
  labelColor: string
  labelCells: number
  percent: number | undefined
  percentColor: string
  ramp: readonly string[]
  barPx: number
  detail: Run[]
  detailCells: number
}): Picture {
  const height = 16
  const labelW = m.labelCells * CH
  const barX = labelW
  const barY = 4
  const barH = 8
  const pctW = 5 * CH
  const detailX = barX + m.barPx + pctW + CH
  const width = detailX + m.detailCells * CH
  const fill = m.percent === undefined ? 0 : (Math.min(100, Math.max(0, m.percent)) / 100) * m.barPx
  const stops = m.ramp.map((c, i) => `<stop offset="${i / (m.ramp.length - 1)}" stop-color="${c}"/>`).join('')

  const defs =
    `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${barX}" x2="${barX + m.barPx}">${stops}</linearGradient>` +
    `<clipPath id="c"><rect x="${barX}" y="${barY}" width="${m.barPx}" height="${barH}" rx="${barH / 2}"/></clipPath>`
  const body =
    drawRuns([{ text: m.label, color: m.labelColor, bold: true }], 0, 12) +
    `<g clip-path="url(#c)"><rect x="${barX}" y="${barY}" width="${m.barPx}" height="${barH}" fill="#8b909a" fill-opacity="0.22"/>` +
    `<rect x="${barX}" y="${barY}" width="${fill.toFixed(1)}" height="${barH}" fill="url(#g)"/></g>` +
    drawRuns(
      [{ text: m.percent === undefined ? '—' : `${Math.round(m.percent)}%`, color: m.percentColor, bold: true, cells: 5, end: true }],
      barX + m.barPx,
      12,
    ) +
    drawRuns(m.detail, detailX, 12)

  return { source: svg(width, height, body, defs), width: Math.ceil(width), height }
}

/** The context split by category: rounded segments in their colours, free space as the track. */
export function stack(parts: { color: string; share: number; hatched?: boolean }[], px: number): Picture {
  const height = 16
  const barY = 4
  const barH = 8
  let x = 0
  let body = ''
  for (const p of parts) {
    const w = p.share * px
    if (w <= 0) continue
    const fill = p.hatched ? 'url(#hatch)' : p.color
    body += `<rect x="${x.toFixed(2)}" y="${barY}" width="${Math.max(1, w).toFixed(2)}" height="${barH}" fill="${fill}"/>`
    x += w
  }
  const hatchColor = parts.find(p => p.hatched)?.color ?? '#858b96'
  const defs =
    `<clipPath id="c"><rect y="${barY}" width="${px}" height="${barH}" rx="${barH / 2}"/></clipPath>` +
    `<pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="2" height="4" fill="${hatchColor}" fill-opacity="0.55"/></pattern>`
  const track = `<rect y="${barY}" width="${px}" height="${barH}" fill="#8b909a" fill-opacity="0.22"/>`

  return { source: svg(px, height, `<g clip-path="url(#c)">${track}${body}</g>`, defs), width: px, height }
}
