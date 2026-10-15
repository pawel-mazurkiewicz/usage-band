import { atom, read, update } from 'claude-code'
import type {
  Elements,
  EngineInterface,
  Register,
  RenderElement,
  SessionContextUsage,
  SessionRateLimit,
} from 'claude-code'

import type { Activity, Breakdown, Meter, Place, Pulse, Snapshot } from '../types'
import { PET_HEIGHT, PET_WIDTH, SPRITE_WIDTH, TICK_MS, caption, moodOf, petSvg, terminalSprite } from './claudie'
import type { Mood } from './claudie'
import { CH, INK, cells, lines, meter, runsWidth, stack } from './desktop'
import type { Run } from './desktop'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const pulse = atom({ plugin: 'usage-band', key: 'pulse' } as const, { now: 0, frame: 0 } satisfies Pulse)
const breakdown = atom({ plugin: 'usage-band', key: 'breakdown' } as const, null)
const activity = atom({ plugin: 'usage-band', key: 'activity' } as const, {
  workingSince: null,
  last: null,
  compacting: false,
} satisfies Activity)
const place = atom({ plugin: 'usage-band', key: 'place' } as const, null)
const boop = atom({ plugin: 'usage-band', key: 'boop' } as const, null)

// ── data ─────────────────────────────────────────────────────────────────────

const toMeter = (limits: SessionRateLimit[], kind: string): Meter | undefined => {
  const limit = limits.find(l => l.kind === kind)
  if (!limit) return undefined
  const resetsAt = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN

  return { percent: limit.percentUsed, resetsAt: Number.isNaN(resetsAt) ? undefined : resetsAt }
}

const toSnapshot = (context: SessionContextUsage, limits: SessionRateLimit[]): Snapshot => ({
  context: { percent: context.percent, tokens: context.tokens, window: context.window },
  fiveHour: toMeter(limits, 'five_hour'),
  weekly: toMeter(limits, 'seven_day'),
})

const SHORT_NAMES: Record<string, string> = {
  'System prompt': 'System',
  'System tools': 'Tools',
  'MCP tools': 'MCP',
  'Custom agents': 'Agents',
  'Memory files': 'Memory',
}

const refreshBreakdown = async ($: EngineInterface) => {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const detail = usage.context.breakdown
    if (!detail) return
    const slices = detail.categories
      .filter(c => c.kind === 'used' && c.tokens > 0)
      .map(c => ({ name: SHORT_NAMES[c.name] ?? c.name.split(' ')[0] ?? c.name, tokens: c.tokens }))
    const buffer = detail.categories.filter(c => c.kind === 'buffer').reduce((sum, c) => sum + c.tokens, 0)
    const next: Breakdown = { slices, buffer, max: detail.rawMaxTokens || detail.maxTokens }
    await update($, breakdown, () => next)
  } catch {
    // The breakdown is a nicety: the meters still draw without it.
  }
}

const refreshPlace = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const folder = cwd.split('/').filter(Boolean).pop() ?? cwd
  const found: Place = { folder, ahead: 0, behind: 0, dirty: 0 }
  try {
    const git = await $.process.run(['git', 'status', '--porcelain=v1', '-b'], { cwd, timeoutMs: 3000 })
    if (git.exitCode === 0) {
      const [head = '', ...changes] = git.stdout.split('\n').filter(Boolean)
      const branch = head.replace(/^## (No commits yet on )?/, '').split(/\.\.\.| /)[0]
      found.branch = branch === 'HEAD' ? 'detached' : branch
      found.ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
      found.behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0)
      found.dirty = changes.length
    }
  } catch {
    // Not a repository, or git is missing: the folder alone shows.
  }
  await update($, place, () => found)
}

// ── colour and formatting ────────────────────────────────────────────────────

type Rgb = [number, number, number]

const rgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Rgb
const hexOf = (c: Rgb) => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const mix = (from: string, to: string, t: number) => {
  const [a, b] = [rgb(from), rgb(to)]

  return hexOf(a.map((v, k) => v + (b[k]! - v) * t) as Rgb)
}

const ramp = (stops: readonly string[], fraction: number) => {
  const at = Math.min(1, Math.max(0, fraction)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(at))

  return mix(stops[i]!, stops[i + 1]!, at - i)
}

// Heat ramp: teal → green → amber → orange → red. Bright for the terminal's dark cells and the
// bars' fills; one shade deeper for text on the desktop, which may be light or dark.
const HEAT = ['#2dd4bf', '#4ade80', '#facc15', '#fb923c', '#f87171']
const HEAT_INK = ['#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444']
const heat = (fraction: number) => ramp(HEAT, fraction)

// Each meter's own pair of colours, so the three read apart at a glance.
const ACCENT = {
  ctx: ['#38bdf8', '#818cf8'],
  '5h': ['#a78bfa', '#e879f9'],
  '7d': ['#f472b6', '#fb7185'],
} as const
const ACCENT_INK = { ctx: '#0ea5e9', '5h': '#8b5cf6', '7d': '#ec4899' } as const

// Pastels for the context breakdown, one per category in order.
const PASTELS = ['#f9a8d4', '#c4b5fd', '#93c5fd', '#86efac', '#fde68a', '#fdba74', '#a5f3fc', '#fca5a5']

// The card's border follows Claudie's mood.
const BORDER: Record<Mood, string> = {
  working: '#d97757',
  compacting: '#a78bfa',
  worried: '#f87171',
  sleepy: '#64748b',
  happy: '#f9a8d4',
  booped: '#f472b6',
  idle: '#8b5cf6',
}

const PINK = '#f9a8d4'
const TRACK = '#3f3f46'

const width = (s: string) => [...s].length

const tokens = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : `${n}`

const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`

  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

const countdown = (resetsAt: number | undefined, now: number) => {
  if (resetsAt === undefined || now === 0) return undefined
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`

  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

// ── the model both surfaces draw ─────────────────────────────────────────────

type MeterRow = {
  key: keyof typeof ACCENT
  icon: string
  label: string
  percent?: number
  /** Tokens for the context, the reset countdown for a limit. */
  detail?: string
  resets: boolean
}

type TurnInfo = { isLive: boolean; ms: number; isStopped: boolean } | null
type CacheInfo = { state: 'warm' } | { state: 'left'; ms: number; hit?: number; fraction: number } | { state: 'cold' } | null

type Model = {
  act: Activity
  slices: Breakdown | null
  where: Place | null
  frame: number
  mood: Mood
  sinceBoop: number | null
  meters: MeterRow[]
  turn: TurnInfo
  cache: CacheInfo
  canCompact: boolean
  isHot: boolean
}

let cacheTtlMs = 60 * 60_000

function buildModel(
  snap: Snapshot,
  act: Activity,
  slices: Breakdown | null,
  where: Place | null,
  { now, frame }: Pulse,
  boopedAt: number | null,
  isWorkingProp: boolean,
): Model {
  const isWorking = isWorkingProp || act.workingSince !== null
  const pressure = Math.max(
    snap.context.percent ?? 0,
    (snap.fiveHour?.percent ?? 0) - 10,
    (snap.weekly?.percent ?? 0) - 10,
  )
  const sinceTurn = act.last && now ? now - act.last.endedAt : null
  const sinceBoop = boopedAt !== null && now ? now - boopedAt : null
  const mood = moodOf({
    isWorking,
    isCompacting: act.compacting,
    pressure,
    sinceTurn,
    sinceBoop,
    isFresh: sinceTurn !== null && sinceTurn < 90_000 && !act.last?.isAborted,
  })

  const meters: MeterRow[] = [
    {
      key: 'ctx',
      icon: '◉',
      label: 'Context',
      percent: snap.context.percent,
      resets: false,
      detail:
        snap.context.tokens !== undefined
          ? `${tokens(snap.context.tokens)}/${tokens(snap.context.window)}`
          : tokens(snap.context.window),
    },
  ]
  if (snap.fiveHour) {
    const left = countdown(snap.fiveHour.resetsAt, now)
    meters.push({ key: '5h', icon: '◷', label: '5h', percent: snap.fiveHour.percent, detail: left, resets: true })
  }
  if (snap.weekly) {
    const left = countdown(snap.weekly.resetsAt, now)
    meters.push({ key: '7d', icon: '◫', label: 'Week', percent: snap.weekly.percent, detail: left, resets: true })
  }

  let turn: TurnInfo = null
  if (isWorking && act.workingSince !== null && now) {
    turn = { isLive: true, ms: now - act.workingSince, isStopped: false }
  } else if (act.last) {
    turn = { isLive: false, ms: act.last.durationMs, isStopped: act.last.isAborted }
  }

  let cache: CacheInfo = null
  if (isWorking) {
    cache = { state: 'warm' }
  } else if (act.last && now) {
    const left = cacheTtlMs - (now - act.last.endedAt)
    cache =
      left > 0
        ? { state: 'left', ms: left, hit: act.last.hitRate, fraction: 1 - left / cacheTtlMs }
        : { state: 'cold' }
  }

  return {
    act,
    slices,
    where,
    frame,
    mood,
    sinceBoop,
    meters,
    turn,
    cache,
    canCompact: !isWorking && !act.compacting && (snap.context.tokens ?? 0) > 0,
    isHot: (snap.context.percent ?? 0) >= 70,
  }
}

const cacheLeft = (ms: number) => (ms < 60_000 ? `${Math.ceil(ms / 1000)}s` : `${Math.ceil(ms / 60_000)}m`)

// ── shared by the hooks ──────────────────────────────────────────────────────

const beat = async ($: EngineInterface) => {
  const now = await $.clock.now()
  await update($, pulse, p => ({ now, frame: (p?.frame ?? 0) + 1 }))
}

const poke = async ($: EngineInterface) => {
  const now = await $.clock.now()
  await update($, boop, () => now)
}

const compact = async ($: EngineInterface) => {
  await update($, activity, a => ({ ...a!, compacting: true }))
  try {
    const result = await $.session.compact()
    if ('skip' in result && result.skip) $.ui.toast('Compaction was skipped')
  } catch (error) {
    $.ui.toast(`Couldn't compact: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await update($, activity, a => ({ ...a!, compacting: false }))
    void refreshBreakdown($)
  }
}

// ── desktop: a card of monospaced SVG rows, Claudie in pixel art ─────────────

const LABEL_CELLS = 9
// The desktop's cells as the band measures them, a little under the SVG's advance so nothing spills.
const CELL_PX = 7.2

function drawDesktop($: EngineInterface, ui: Elements['desktop'], m: Model, columns: number): RenderElement {
  const { Box, Button, Svg } = ui
  const pet = petSvg(m.mood, m.frame, m.sinceBoop)
  const said = caption(m.mood, m.frame)

  // Header, left: where the session is, and what Claudie says.
  const where: Run[] = m.where
    ? [
        { icon: 'folder', color: INK.folder },
        { text: m.where.folder, color: INK.folder, bold: true },
        ...(m.where.branch
          ? ([
              { text: '  ', color: INK.dim },
              { icon: 'branch', color: INK.branch },
              { text: m.where.branch, color: INK.branch },
              ...(m.where.ahead ? [{ text: ` ↑${m.where.ahead}`, color: INK.sync }] : []),
              ...(m.where.behind ? [{ text: ` ↓${m.where.behind}`, color: INK.sync }] : []),
              ...(m.where.dirty ? [{ text: ` ±${m.where.dirty}`, color: INK.dirty }] : []),
            ] satisfies Run[])
          : []),
      ]
    : [{ text: '…', color: INK.dim }]
  const info = lines([where, [{ text: `“${said}”`, color: INK.say, italic: true }]])

  // Header, right: the turn's time and the cache.
  const status: Run[] = []
  if (m.turn) {
    status.push({ icon: 'clock', color: m.turn.isLive ? '#f97316' : '#8b5cf6' })
    status.push({ text: m.turn.isLive ? duration(m.turn.ms) : `last ${duration(m.turn.ms)}`, color: INK.text })
    if (m.turn.isStopped) status.push({ text: ' (stopped)', color: INK.dim })
  }
  if (m.cache) {
    if (status.length) status.push({ text: '   ', color: INK.dim })
    if (m.cache.state === 'warm') {
      status.push({ icon: 'bolt', color: '#22c55e' }, { text: 'cache warm', color: INK.text })
    } else if (m.cache.state === 'left') {
      status.push({ icon: 'bolt', color: ramp(HEAT_INK, m.cache.fraction) })
      status.push({ text: `cache ${cacheLeft(m.cache.ms)}`, color: INK.text })
      if (m.cache.hit !== undefined) status.push({ text: ` · ${m.cache.hit}% hit`, color: INK.dim })
    } else {
      status.push({ icon: 'snow', color: '#0ea5e9' }, { text: 'cache cold', color: INK.text })
    }
  }
  const statusPic = status.length ? lines([status]) : null
  const statusAlt = [
    m.turn ? `${m.turn.isLive ? 'turn' : 'last turn'} ${duration(m.turn.ms)}` : '',
    m.cache?.state === 'left' ? `cache ${cacheLeft(m.cache.ms)} left` : m.cache ? `cache ${m.cache.state}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  // Meters: every tile the same width, so they line up in a row or stacked.
  const details = m.meters.map(r =>
    r.detail
      ? ([
          ...(r.resets ? [{ icon: 'reset', color: INK.dim } as const] : []),
          { text: r.detail, color: ACCENT_INK[r.key] },
        ] satisfies Run[])
      : [],
  )
  const detailCells = Math.max(0, ...details.map(d => Math.ceil(runsWidth(d) / CH)))
  const fixedPx = (LABEL_CELLS + 6 + detailCells + 3) * CH
  const availPx = columns * CELL_PX
  const inRow = availPx - fixedPx * m.meters.length >= 60 * m.meters.length
  const barPx = Math.floor(
    inRow
      ? Math.min(160, (availPx - fixedPx * m.meters.length) / m.meters.length)
      : Math.max(60, Math.min(260, availPx - fixedPx)),
  )
  const tiles = m.meters.map((r, i) => ({
    key: r.key,
    alt: `${r.label} ${r.percent === undefined ? 'unknown' : `${Math.round(r.percent)}%`}${r.detail ? ` ${r.resets ? 'resets in ' : ''}${r.detail}` : ''}`,
    pic: meter({
      label: r.label,
      labelColor: ACCENT_INK[r.key],
      labelCells: LABEL_CELLS,
      percent: r.percent,
      percentColor: r.percent === undefined ? INK.dim : ramp(HEAT_INK, r.percent / 100),
      ramp: HEAT,
      barPx,
      detail: details[i]!,
      detailCells: detailCells + 3,
    }),
  }))
  const rowPx = inRow ? tiles.reduce((sum, t) => sum + t.pic.width, 0) - 3 * CH : (tiles[0]?.pic.width ?? 0)

  // The context's mix: the same label column, a stacked bar to the row's end, a legend beneath.
  let mixRows: RenderElement[] = []
  const slices = m.slices
  if (slices && slices.slices.length > 0) {
    const used = slices.slices.reduce((sum, s) => sum + s.tokens, 0)
    const usedText = `${tokens(used)} used`
    const mixBarPx = Math.max(60, Math.floor(rowPx - (LABEL_CELLS + 2 + cells(usedText)) * CH))
    const parts = [
      ...slices.slices.map((s, i) => ({ color: PASTELS[i % PASTELS.length]!, share: s.tokens / slices.max })),
      { color: 'transparent', share: Math.max(0, (slices.max - used - slices.buffer) / slices.max) },
      { color: '#858b96', share: slices.buffer / slices.max, hatched: true },
    ]
    const bar = stack(parts, mixBarPx)
    const label = lines([[{ text: 'Mix', color: '#6366f1', bold: true, cells: LABEL_CELLS }]])
    const usedPic = lines([[{ text: `  ${usedText}`, color: INK.dim }]])

    const legend: Run[] = [{ text: '', color: INK.dim, cells: LABEL_CELLS }]
    const colored = slices.slices.map((s, i) => ({ ...s, color: PASTELS[i % PASTELS.length]! }))
    for (const s of colored.sort((a, b) => b.tokens - a.tokens)) {
      const item: Run[] = [
        { icon: 'swatch', color: s.color },
        { text: `${s.name} ${tokens(s.tokens)}   `, color: INK.text },
      ]
      if (runsWidth(legend) + runsWidth(item) > rowPx) break
      legend.push(...item)
    }
    const legendPic = lines([legend])

    mixRows = [
      <Box key="mix" flexDirection="row" alignItems="center">
        <Svg source={label.source} alt="Context mix" width={label.width} height={label.height} />
        <Svg
          source={bar.source}
          alt={slices.slices.map(s => `${s.name} ${tokens(s.tokens)}`).join(', ')}
          width={bar.width}
          height={bar.height}
        />
        <Svg source={usedPic.source} alt={usedText} width={usedPic.width} height={usedPic.height} />
      </Box>,
      <Box key="legend" flexDirection="row">
        <Svg source={legendPic.source} alt="Context mix legend" width={legendPic.width} height={legendPic.height} />
      </Box>,
    ]
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={BORDER[m.mood]} paddingX={1} rowGap={1}>
      <Box key="header" flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={2}>
        <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={1} minWidth={0}>
          {/* Only a Button takes a click and none holds an Svg, so a blank one lies over Claudie. */}
          <Box position="relative" flexShrink={0}>
            <Svg source={pet.source} alt={pet.alt} width={PET_WIDTH} height={PET_HEIGHT} />
            <Box position="absolute" top={0} left={0} right={0} bottom={0} justifyContent="center" alignItems="center">
              <Button key="boop" label={' '.repeat(6)} plain onPress={() => void poke($)} />
            </Box>
          </Box>
          <Svg
            source={info.source}
            alt={`${m.where ? `${m.where.folder}${m.where.branch ? ` on ${m.where.branch}` : ''}` : ''} — ${said}`}
            width={info.width}
            height={info.height}
          />
        </Box>
        <Box flexDirection="row" alignItems="center" columnGap={2} flexShrink={0}>
          {statusPic ? (
            <Svg source={statusPic.source} alt={statusAlt} width={statusPic.width} height={statusPic.height} />
          ) : null}
          {m.canCompact ? (
            <Button
              key="compact"
              label="⇣ compact"
              variant={m.isHot ? 'primary' : 'secondary'}
              onPress={() => void compact($)}
            />
          ) : null}
        </Box>
      </Box>
      <Box key="meters" flexDirection={inRow ? 'row' : 'column'}>
        {tiles.map(t => (
          <Svg key={t.key} source={t.pic.source} alt={t.alt} width={t.pic.width} height={t.pic.height} />
        ))}
      </Box>
      {mixRows}
    </Box>
  )
}

// ── terminal: text, every cell counted ───────────────────────────────────────

function drawTerminal(
  $: EngineInterface,
  ui: Elements['terminal'],
  m: Model,
  bodyColumns: number,
  maxRows: number,
): RenderElement {
  const { Box, Text, Button } = ui
  const hasBorder = maxRows >= 5
  const inner = bodyColumns - (hasBorder ? 4 : 0)
  const hasPet = maxRows >= 3 && inner >= 70
  const columns = inner - (hasPet ? SPRITE_WIDTH + 1 : 0)

  const gradient = (text: string, from: string, to: string) =>
    [...text].map((ch, i, all) => (
      <Text color={mix(from, to, all.length > 1 ? i / (all.length - 1) : 0)} bold>
        {ch}
      </Text>
    ))

  // Row 1: the meters, bars sized to what the text leaves.
  const detailOf = (r: MeterRow) => (r.detail ? `${r.resets ? '↻ ' : ''}${r.detail}` : undefined)
  const fixed =
    m.meters.reduce((sum, r) => sum + r.label.length + 8 + (r.detail ? width(detailOf(r)!) + 2 : 0), 0) +
    (m.meters.length - 1) * 5
  const barWidth = Math.min(16, Math.floor((columns - fixed) / m.meters.length))
  const showBars = barWidth >= 4
  const showDetail = showBars || columns >= fixed - 10

  const meterRow = (
    <Box key="meters" flexDirection="row">
      {m.meters.map((r, i) => {
        const percent = r.percent === undefined ? undefined : Math.min(100, Math.max(0, r.percent))
        const filled = percent === undefined ? 0 : Math.round((percent / 100) * barWidth)
        const [from, to] = ACCENT[r.key]
        const detail = detailOf(r)

        return (
          <Box key={r.key} flexDirection="row">
            {i > 0 ? <Text dimColor>{'  │  '}</Text> : null}
            <Text color={from}>{r.icon} </Text>
            <Text>{gradient(r.label, from, to)} </Text>
            {showBars ? (
              <Text>
                {Array.from({ length: filled }, (_, cell) => (
                  <Text color={heat(barWidth > 1 ? cell / (barWidth - 1) : 0)}>█</Text>
                ))}
                <Text color={TRACK}>{'░'.repeat(barWidth - filled)}</Text>
              </Text>
            ) : null}
            <Text color={percent === undefined ? 'inactive' : heat(percent / 100)} bold>
              {` ${percent === undefined ? '—' : `${Math.round(percent)}%`}`}
            </Text>
            {showDetail && detail ? <Text color={to}>{`  ${detail}`}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )

  // Row 2: what fills the context.
  let mixRow = null
  const slices = m.slices
  if (slices && slices.slices.length > 0 && columns >= 40) {
    const mixWidth = Math.max(12, Math.min(28, Math.floor(columns / 4)))
    const cellsOf = slices.slices.map(s => Math.round((s.tokens / slices.max) * mixWidth))
    const used = cellsOf.reduce((a, b) => a + b, 0)
    const bufferCells = Math.max(0, Math.min(mixWidth - used, Math.round((slices.buffer / slices.max) * mixWidth)))
    const free = Math.max(0, mixWidth - used - bufferCells)

    let room = columns - mixWidth - 9
    const legend = []
    const colored = slices.slices.map((s, i) => ({ ...s, color: PASTELS[i % PASTELS.length]! }))
    for (const s of colored.sort((a, b) => b.tokens - a.tokens)) {
      const text = `${s.name} ${tokens(s.tokens)}`
      if (width(text) + 4 > room) break
      room -= width(text) + 4
      legend.push(
        <Text key={s.name}>
          <Text color={s.color}>{'  ■ '}</Text>
          <Text dimColor>{text}</Text>
        </Text>,
      )
    }

    mixRow = (
      <Box key="mix" flexDirection="row">
        <Text color="#a5b4fc">◔ </Text>
        <Text>{gradient('Mix', '#a5b4fc', PINK)} </Text>
        <Text>
          {slices.slices.map((s, i) => (
            <Text color={PASTELS[i % PASTELS.length]}>{'█'.repeat(cellsOf[i] ?? 0)}</Text>
          ))}
          <Text color={TRACK}>{'░'.repeat(free)}</Text>
          <Text dimColor>{'▒'.repeat(bufferCells)}</Text>
        </Text>
        {legend}
      </Box>
    )
  }

  // Row 3: where, when, cache, what Claudie says, and the compact button, dropped by priority.
  type Chip = { key: string; priority: number; text: string; color: string }
  const chips: Chip[] = []
  if (m.where) {
    const w = m.where
    chips.push({ key: 'folder', priority: 3, text: `⌂ ${w.folder}`, color: '#fbbf24' })
    if (w.branch) {
      const marks = `${w.ahead ? ` ↑${w.ahead}` : ''}${w.behind ? ` ↓${w.behind}` : ''}${w.dirty ? ` ±${w.dirty}` : ''}`
      chips.push({ key: 'branch', priority: 2, text: `⎇ ${w.branch}${marks}`, color: '#5eead4' })
    }
  }
  if (m.turn) {
    const text = m.turn.isLive
      ? `⏱ ${duration(m.turn.ms)}`
      : `⏱ last ${duration(m.turn.ms)}${m.turn.isStopped ? ' (stopped)' : ''}`
    chips.push({ key: 'turn', priority: 1, text, color: m.turn.isLive ? '#fdba74' : '#c4b5fd' })
  }
  if (m.cache) {
    const c = m.cache
    chips.push(
      c.state === 'warm'
        ? { key: 'cache', priority: 1, text: '⚡ cache warm', color: '#4ade80' }
        : c.state === 'left'
          ? {
              key: 'cache',
              priority: 1,
              text: `⚡ cache ${cacheLeft(c.ms)}${c.hit !== undefined ? ` · ${c.hit}% hit` : ''}`,
              color: heat(c.fraction),
            }
          : { key: 'cache', priority: 1, text: '❄ cache cold', color: '#7dd3fc' },
    )
  }
  if (hasPet) chips.push({ key: 'says', priority: 4, text: `“${caption(m.mood, m.frame)}”`, color: PINK })

  const compactLabel = '⇣ compact'
  let room = columns - (m.canCompact ? width(compactLabel) + 7 : 0)
  const kept = new Set<string>()
  for (const chip of [...chips].sort((a, b) => a.priority - b.priority)) {
    const cost = width(chip.text) + 3
    if (cost > room) continue
    room -= cost
    kept.add(chip.key)
  }

  const statusRow = (
    <Box key="status" flexDirection="row">
      {chips
        .filter(c => kept.has(c.key))
        .map((c, i) => (
          <Text key={c.key}>
            {i > 0 ? <Text dimColor>{' · '}</Text> : null}
            <Text color={c.color} italic={c.key === 'says'}>
              {c.text}
            </Text>
          </Text>
        ))}
      {m.canCompact ? (
        <Box flexDirection="row">
          <Text>{'   '}</Text>
          <Button
            key="compact"
            label={compactLabel}
            variant={m.isHot ? 'primary' : 'secondary'}
            onPress={() => void compact($)}
          />
        </Box>
      ) : m.act.compacting ? (
        <Text dimColor>{'   compacting…'}</Text>
      ) : null}
    </Box>
  )

  const rows = [meterRow, mixRow, statusRow].filter(Boolean).slice(0, Math.max(1, maxRows - (hasBorder ? 2 : 0)))
  const body = (
    <Box flexDirection="row">
      {hasPet ? (
        <Box flexDirection="column" marginRight={1}>
          {terminalSprite(m.mood, m.frame).map((row, i) => (
            <Text key={`pet${i}`}>
              {row.map(s => (
                <Text color={s.color} bold={s.bold}>
                  {s.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box flexDirection="column">{rows}</Box>
    </Box>
  )

  return hasBorder ? (
    <Box flexDirection="column" borderStyle="round" borderColor={BORDER[m.mood]} paddingX={1}>
      {body}
    </Box>
  ) : (
    body
  )
}

// ── hooks ────────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const ttlMinutes = typeof options.cacheTtlMinutes === 'number' ? options.cacheTtlMinutes : 60
  cacheTtlMs = ttlMinutes * 60_000

  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage()
    await update($, snapshot, () => toSnapshot(usage.context, usage.rateLimits))
    await beat($)
    void refreshBreakdown($)
    void refreshPlace($).catch(() => undefined)
    // Claudie's frames, and the countdowns, step on this tick.
    $.clock.every(TICK_MS, () => void beat($))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => toSnapshot(e.context, e.rateLimits))
    if (e.changed.includes('context')) void refreshBreakdown($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, activity, a => ({ ...a!, workingSince: now }))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      const u = e.usage
      const prompt = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
      await update($, activity, a => ({
        ...a!,
        workingSince: null,
        last: {
          durationMs: e.durationMs,
          endedAt: now,
          isAborted: e.isAborted,
          hitRate: u && prompt > 0 ? Math.round((u.cache_read_input_tokens / prompt) * 100) : undefined,
        },
      }))
      void refreshBreakdown($)
      void refreshPlace($).catch(() => undefined)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || snap === null) return next(e)

    const m = buildModel(
      snap,
      await read($, activity),
      await read($, breakdown),
      await read($, place),
      await read($, pulse),
      await read($, boop),
      e.props.isWorking,
    )

    if (e.surface === 'desktop') return drawDesktop($, $.ui.resolve(e), m, e.props.bodyColumns - 4)
    if (e.surface === 'terminal') return drawTerminal($, $.ui.resolve(e), m, e.props.bodyColumns, e.props.maxRows)

    return next(e)
  })
}
