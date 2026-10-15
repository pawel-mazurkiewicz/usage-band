export type Meter = { percent: number; resetsAt?: number }

export type Snapshot = {
  context: { percent?: number; tokens?: number; window: number }
  fiveHour?: Meter
  weekly?: Meter
}

/** One used category of the context window, as /context names it. */
export type Slice = { name: string; tokens: number }

export type Breakdown = { slices: Slice[]; buffer: number; max: number }

export type LastTurn = { durationMs: number; endedAt: number; hitRate?: number; isAborted: boolean }

export type Activity = { workingSince: number | null; last: LastTurn | null; compacting: boolean }

export type Place = { folder: string; branch?: string; ahead: number; behind: number; dirty: number }

/** The clock the band animates and counts down by: `frame` steps every 250ms tick. */
export type Pulse = { now: number; frame: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      snapshot: Snapshot | null
      pulse: Pulse
      breakdown: Breakdown | null
      activity: Activity
      place: Place | null
      /** When Claudie was last clicked. */
      boop: number | null
    }
  }
}
