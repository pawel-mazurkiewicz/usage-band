// Claudie: a little pixel Claude who lives in the band and shows how the session feels.
// On the desktop she is an SVG whose frame steps with the band's 250ms tick (a plain image per
// frame: an animated SVG repaints blank whenever its source changes). On the terminal she is
// Claude Code's own logo in quarter blocks, with a mood mark beside her.

export type Mood = 'working' | 'compacting' | 'worried' | 'sleepy' | 'happy' | 'booped' | 'idle'

export const TICK_MS = 250
export const BOOP_MS = 2500
const SLEEP_AFTER_MS = 10 * 60_000

// ── mood ─────────────────────────────────────────────────────────────────────

/** Which mood the session puts Claudie in, the most urgent first. */
export function moodOf(s: {
  isWorking: boolean
  isCompacting: boolean
  pressure: number
  sinceTurn: number | null
  sinceBoop: number | null
  isFresh: boolean
}): Mood {
  if (s.isCompacting) return 'compacting'
  if (s.isWorking) return 'working'
  if (s.sinceBoop !== null && s.sinceBoop < BOOP_MS) return 'booped'
  if (s.pressure >= 80) return 'worried'
  if (s.isFresh) return 'happy'
  const quiet = Math.min(s.sinceTurn ?? Infinity, s.sinceBoop ?? Infinity)
  if (quiet !== Infinity && quiet >= SLEEP_AFTER_MS) return 'sleepy'

  return 'idle'
}

const CAPTIONS: Record<Mood, readonly string[]> = {
  working: ['pondering', 'tinkering', 'noodling', 'brewing', 'scheming'],
  compacting: ['squishing context'],
  worried: ['context is filling up'],
  sleepy: ['zzz'],
  happy: ['all done!'],
  booped: ['hehe ♥'],
  idle: ['ready when you are'],
}

/** What Claudie says: working captions change every few seconds and grow dots. */
export function caption(mood: Mood, frame: number): string {
  const list = CAPTIONS[mood]
  if (mood !== 'working' && mood !== 'compacting') return list[0]!
  const word = list[Math.floor(frame / 16) % list.length]!

  return `${word}${'.'.repeat(Math.floor(frame / 2) % 4)}`
}

// ── desktop: pixel art ───────────────────────────────────────────────────────

export const PET_WIDTH = 75
export const PET_HEIGHT = 40

const VIEW_W = 30
const VIEW_H = 16

const C = {
  body: '#d97757',
  light: '#e9977a',
  shade: '#bf6040',
  eye: '#1f1a17',
  blush: '#f6a6a0',
  heart: '#f472b6',
  z: '#94a3b8',
  drop: '#7dd3fc',
  spark: ['#fde68a', '#c4b5fd', '#f9a8d4', '#93c5fd'],
}

// Claude's shape, 18 by 8: a head, the arms either side, the body under them.
const BODY = [
  '..##############..',
  '..##############..',
  '..##############..',
  '..##############..',
  '##################',
  '##################',
  '..##############..',
  '..##############..',
]
// Squashed for compaction: two rows shorter, an arm's width wider.
const SQUASHED = [
  '.################.',
  '.################.',
  '##################',
  '##################',
  '.################.',
  '.################.',
]

type Rect = [x: number, y: number, w: number, h: number]

const rect = ([x, y, w, h]: Rect, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`

// A grid of '#' cells as one rect per horizontal run.
function grid(rows: readonly string[], ox: number, oy: number, fill: string): string {
  let out = ''
  rows.forEach((row, y) => {
    for (const run of row.matchAll(/#+/g)) out += rect([ox + run.index, oy + y, run[0].length, 1], fill)
  })

  return out
}

type Eyes = 'open' | 'shut' | 'wide' | 'happy' | 'left' | 'right'

const EYES: Record<Eyes, Rect[]> = {
  open: [[5, 2, 1, 2], [12, 2, 1, 2]],
  left: [[4, 2, 1, 2], [11, 2, 1, 2]],
  right: [[6, 2, 1, 2], [13, 2, 1, 2]],
  shut: [[4, 3, 2, 1], [12, 3, 2, 1]],
  wide: [[4, 2, 2, 2], [12, 2, 2, 2]],
  happy: [[4, 3, 1, 1], [5, 2, 1, 1], [6, 3, 1, 1], [11, 3, 1, 1], [12, 2, 1, 1], [13, 3, 1, 1]],
}

const LEG_X = [3, 5, 12, 14]
const GROUND = 15

type Pose = { eyes: Eyes; lift?: number; dx?: number; blush?: boolean; squash?: boolean; stride?: number }

// Claudie at (1, 5) in the view, lifted `lift` pixels, legs drawn for `stride` 0 or 1.
function claudie(p: Pose): string {
  const ox = 1 + (p.dx ?? 0)
  const lift = p.lift ?? 0
  if (p.squash) {
    const oy = 7 - lift
    const eyes = EYES[p.eyes].map(([x, y, w, h]): Rect => [ox + x, oy + y - 1, w, h])

    return (
      grid(SQUASHED, ox, oy, C.body) +
      rect([ox + 2, oy, 14, 1], C.light) +
      eyes.map(r => rect(r, C.eye)).join('') +
      LEG_X.map(x => rect([ox + x, oy + SQUASHED.length, 1, GROUND - oy - SQUASHED.length], C.body)).join('')
    )
  }
  const oy = 5 - lift
  const stride = p.stride ?? -1
  // Legs hang from the body to the ground (y 15); mid-stride, every other one is a pixel up.
  const top = oy + BODY.length
  const legs = LEG_X.map((x, i) => {
    const isLifted = stride >= 0 && i % 2 !== stride
    return rect([ox + x, top, 1, Math.max(1, GROUND - top - (isLifted ? 1 : 0))], C.body)
  })

  return (
    grid(BODY, ox, oy, C.body) +
    rect([ox + 2, oy, 14, 1], C.light) +
    rect([ox + 2, oy + 7, 14, 1], C.shade) +
    EYES[p.eyes].map(([x, y, w, h]) => rect([ox + x, oy + y, w, h], C.eye)).join('') +
    (p.blush ? rect([ox + 3, oy + 4, 2, 1], C.blush) + rect([ox + 13, oy + 4, 2, 1], C.blush) : '') +
    legs.join('')
  )
}

const HEART = ['##.##', '#####', '.###.', '..#..']
const Z = ['####', '..#.', '.#..', '####']
const DROP = ['.#.', '###', '###', '.#.']
const SPARK = ['.#.', '###', '.#.']

function view(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" shape-rendering="crispEdges">${body}</svg>`
}

/** Claudie for this frame as an SVG document, with what she is doing for a reader. */
export function petSvg(mood: Mood, frame: number, sinceBoop: number | null): { source: string; alt: string } {
  switch (mood) {
    case 'working': {
      const step = frame % 2
      const spark = grid(SPARK, 21 + (frame % 4 < 2 ? 0 : 4), 1 + (frame % 3), C.spark[frame % 4]!)
      return { source: view(claudie({ eyes: 'open', lift: step, stride: step }) + spark), alt: 'Claude working' }
    }
    case 'compacting': {
      const squash = frame % 2 === 0
      const dust = squash ? rect([0, 14, 1, 1], C.z) + rect([20, 14, 1, 1], C.z) : ''
      return { source: view(claudie({ eyes: squash ? 'shut' : 'open', squash }) + dust), alt: 'Claude compacting' }
    }
    case 'booped': {
      const t = Math.floor((sinceBoop ?? 0) / TICK_MS)
      const lift = t < 8 && t % 4 < 2 ? 2 : 0
      const heart = grid(HEART, 22, Math.max(0, 6 - Math.floor(t / 2)), C.heart)
      return { source: view(claudie({ eyes: 'happy', lift, blush: true }) + heart), alt: 'Claude happy' }
    }
    case 'worried': {
      const bob = Math.floor(frame / 2) % 2
      const dx = frame % 8 === 0 ? 1 : 0
      return {
        source: view(claudie({ eyes: 'wide', dx }) + grid(DROP, 21, 3 + bob, C.drop)),
        alt: 'Claude worried',
      }
    }
    case 'sleepy': {
      const breath = Math.floor(frame / 6) % 2
      const k = frame % 16
      const z = k < 12 ? grid(Z, 21 + Math.floor(k / 4), 5 - Math.floor(k / 3), C.z) : ''
      return { source: view(claudie({ eyes: 'shut', lift: -breath }) + z), alt: 'Claude sleeping' }
    }
    case 'happy': {
      const lift = frame % 8 < 2 ? 1 : 0
      const spark = frame % 8 < 4 ? grid(SPARK, 22, 2, C.spark[2]!) : ''
      return { source: view(claudie({ eyes: 'happy', lift, blush: true }) + spark), alt: 'Claude happy' }
    }
    default: {
      const k = frame % 48
      const eyes: Eyes = k === 47 ? 'shut' : k >= 30 && k < 34 ? 'left' : k >= 34 && k < 38 ? 'right' : 'open'
      return { source: view(claudie({ eyes })), alt: 'Claude idle' }
    }
  }
}

// ── terminal: Claude Code's logo ─────────────────────────────────────────────

/** A run of sprite text in one colour. */
export type Segment = { text: string; color?: string; bold?: boolean }

export const SPRITE_WIDTH = 11

const MARKS: Record<Mood, readonly Segment[]> = {
  working: [
    { text: '✦ ', color: C.spark[0] },
    { text: ' ✧', color: C.spark[1] },
    { text: '⋆ ', color: C.spark[2] },
    { text: ' ✦', color: C.spark[3] },
  ],
  compacting: [{ text: '⇣ ', color: C.spark[1] }],
  worried: [{ text: '! ', color: '#f87171', bold: true }],
  sleepy: [
    { text: 'z ', color: C.z },
    { text: 'zZ', color: C.z },
  ],
  happy: [{ text: '✿ ', color: C.heart }],
  booped: [{ text: '♥ ', color: C.heart }],
  idle: [{ text: '  ' }],
}

/** Claudie's three rows on the terminal, the logo's own glyphs, her feet shuffling while she works. */
export function terminalSprite(mood: Mood, frame: number): Segment[][] {
  const marks = MARKS[mood]
  const mark = marks[Math.floor(frame / 2) % marks.length]!
  const isWalking = mood === 'working' || mood === 'compacting'
  const feet = isWalking && Math.floor(frame / 2) % 2 === 1 ? '  ▝▘ ▝▘  ' : '  ▘▘ ▝▝  '

  return [
    [{ text: ' ▐▛███▜▌ ', color: C.body }, mark],
    [{ text: '▝▜█████▛▘', color: C.body }, { text: '  ' }],
    [{ text: feet, color: C.body }, { text: '  ' }],
  ]
}
