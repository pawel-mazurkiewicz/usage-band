import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const SURFACES = ['terminal', 'desktop'] as const

const band = (bodyColumns: number, maxRows = 12) =>
  ({
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows,
      bodyColumns,
      scroll: { offset: 0, bodyRows: maxRows - 1 },
      view: {},
    },
  }) as const

const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 3_100, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'System tools', tokens: 12_000, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 61_000, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
    { name: 'Free space', tokens: 90_900, color: 'inactive', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 76_100,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'model-default',
  percentage: 38,
  gridRows: [],
  model: 'claude-opus-5-5',
}

// Stands in for the engine beneath the plugin.
const engine = (on: On) => {
  const calls = { compact: 0 }
  on('session.usage', ($, e) => ({
    value: {
      startedAt: NOW,
      context: { window: 200_000, ...(e.breakdown ? { breakdown: BREAKDOWN } : {}) },
      rateLimits: [],
    } as never,
  }))
  on('session.cwd', () => ({ value: '/Users/someone/code/my-app' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '## main...origin/main [ahead 1]\n M a.ts\n?? b.ts\n', stderr: '' } as never,
  }))
  on('session.start', () => ({ cwd: '/' }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.compact', () => {
    calls.compact += 1

    return { skip: 'test' }
  })

  return calls
}

const measure = (withLimits: boolean) =>
  ({
    context: { tokens: 84_000, window: 200_000, percent: 42 },
    rateLimits: withLimits
      ? [
          { kind: 'five_hour', percentUsed: 31, resetsAt: '2026-10-15T14:14:00Z' },
          { kind: 'seven_day', percentUsed: 57.5, resetsAt: '2026-10-18T16:00:00Z' },
        ]
      : [],
    changed: ['context', 'rateLimits'],
  }) as never

const boot = async ($: Engine, on: On, withLimits = true) => {
  const clock = mock.clock(on, { now: NOW })
  const calls = engine(on)
  await $.session.start({ source: 'startup', cwd: '/' } as never)
  await $.session.measure(measure(withLimits))
  await clock.settle()

  return { clock, calls }
}

// What the desktop drew: its pictures' alt texts, and their markup.
const pictures = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) => {
  const svgs = await ui.findAll({ type: 'Svg' })

  return {
    alts: svgs.map(s => String(s.props.alt)).join('\n'),
    sources: svgs.map(s => String(s.props.source)).join('\n'),
    count: svgs.length,
  }
}

test('desktop draws a card of monospaced SVG rows and pixel Claudie', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(150) })
  const { alts, sources } = await pictures(ui)

  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Claude idle')
  expect(alts).toContain('Context 42% 84k/200k')
  expect(alts).toContain('5h 31% resets in 2h14m')
  expect(alts).toContain('Week 58% resets in 3d 4h')
  expect(alts).toContain('my-app on main — ready when you are')
  expect(alts).toContain('Messages 61k')
  expect(sources).toContain('ui-monospace')
  expect(sources).toContain('linearGradient')
  expect(sources).toContain('±2')
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
  expect(await ui.find({ key: 'compact' })).toBeDefined()
  await ui.unmount()
})

test('clicking Claudie on the desktop makes her happy', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(150) })
  await ui.press({ key: 'boop' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Claude happy')
  expect((await pictures(ui)).alts).toContain('hehe ♥')
  await ui.unmount()
})

test('a narrow desktop band stacks the meters instead of squeezing them', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(70) })
  const meters = await ui.find({ key: 'meters' })
  expect(meters?.props.flexDirection).toBe('column')
  await ui.unmount()
})

test('terminal draws the logo Claudie beside text meters, mix and status', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...band(150) })
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /84k\/200k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /31%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↻ 2h14m/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Messages 61k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⌂ my-app/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⎇ main ↑1 ±2/ })).toBeDefined()
  expect(await ui.find({ key: 'compact' })).toBeDefined()
  await ui.unmount()
})

test('while a turn runs Claudie works and the cache is warm; after it, turn time and cache show', async ($, on) => {
  const { clock } = await boot($, on)
  await $.turn.start({ text: 'hi', turnId: 't1' } as never)
  await clock.advance(12_000)

  const term = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...band(150) })
  expect(await term.find({ type: 'Text', text: /⚡ cache warm/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /⏱ 12s/ })).toBeDefined()
  expect(await term.find({ key: 'compact' })).toBeUndefined()
  await term.unmount()

  const desk = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(150) })
  expect((await desk.find({ type: 'Svg' }))?.props.alt).toBe('Claude working')
  expect((await pictures(desk)).alts).toContain('turn 12s · cache warm')
  expect(await desk.find({ key: 'compact' })).toBeUndefined()
  await desk.unmount()

  await $.turn.complete({
    reason: 'answer',
    answer: 'ok',
    durationMs: 42_000,
    isAborted: false,
    turnId: 't1',
    usage: {
      input_tokens: 1_000,
      output_tokens: 500,
      cache_read_input_tokens: 9_000,
      cache_creation_input_tokens: 0,
      model: 'claude-opus-5-5',
    },
  } as never)
  await clock.settle()

  const after = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...band(150) })
  expect(await after.find({ type: 'Text', text: /⏱ last 42s/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: /⚡ cache 60m · 90% hit/ })).toBeDefined()
  expect(await after.find({ type: 'Text', text: /all done!/ })).toBeDefined()
  await after.unmount()

  const afterDesk = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(150) })
  const { alts, sources } = await pictures(afterDesk)
  expect(alts).toContain('last turn 42s · cache 60m left')
  expect(sources).toContain('90% hit')
  expect((await afterDesk.find({ type: 'Svg' }))?.props.alt).toBe('Claude happy')
  await afterDesk.unmount()
})

test('the compact button compacts the conversation', async ($, on) => {
  const { calls } = await boot($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, ...band(150) })
    await ui.press({ key: 'compact' })
    await ui.unmount()
  }
  expect(calls.compact).toBe(2)
})

test('a narrow terminal band drops Claudie but keeps the numbers', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...band(60) })
  expect(await ui.find({ type: 'Text', text: /▐▛███▜▌/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /42%/ })).toBeDefined()
  await ui.unmount()
})

test('without a subscription only the context meter shows', async ($, on) => {
  await boot($, on, false)
  const term = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', ...band(150) })
  expect(await term.find({ type: 'Text', text: /Week/ })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: /Context/ })).toBeDefined()
  await term.unmount()

  const desk = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', ...band(150) })
  const { alts } = await pictures(desk)
  expect(alts).toContain('Context 42%')
  expect(alts).not.toContain('Week')
  await desk.unmount()
})
