// North Star: your purpose, your organisation's purpose, and what you are
// pushing on this week, month, quarter, year and five years, kept in view in
// every Claude Code session.
//
// Everything personal lives in one JSON file per person (see AGENT.md):
//   ~/.claude/northstar/northstar.json   (or $NORTHSTAR_CONFIG)
// The mod only reads and draws it; `/northstar init` (a starter file, never
// over an existing one) and `/northstar focus ...` are the only writes.
// With no file it draws nothing.
//
// Where it draws:
//   • Desktop app (Code tab): the band above the prompt.
//   • Terminal: the same band by default, or the prompt footer when the file
//     says "placement": { "terminal": "footer" } (for people whose statusline
//     leaves an empty column on the right).
//
// On/off: `/northstar stop` hides it in every session from then on, and
// `/northstar start` brings it back. The switch is kept in the plugin's own
// store, so it survives restarts and reloads.

import type { Register } from 'claude-code'

const TICK_MS = 60_000
const STORE_ENABLED = 'enabled'

const HORIZONS = [
  { key: 'week', tag: 'WEEK', aliases: ['week', 'weekly', 'w'] },
  { key: 'month', tag: 'MONTH', aliases: ['month', 'monthly', 'm'] },
  { key: 'quarter', tag: 'QTR', aliases: ['quarter', 'quarterly', 'q', 'qtr'] },
] as const

type Goal = { goal?: string; metric?: string }

export type Star = {
  title?: string
  you?: { label?: string; purpose?: string }
  org?: { label?: string; name?: string; purpose?: string }
  focus?: { week?: string; month?: string; quarter?: string }
  year?: Goal
  five_year?: Goal
  alignment_note?: string
  live?: { label?: string; file?: string }
  placement?: { terminal?: 'band' | 'footer'; footer_offset?: number }
}

// What a `live` file holds: one line of text, when it was written, and how
// it is going. Anything that can write JSON can feed it (a cron job, a script).
export type Live = { text?: string; at?: string; status?: 'ok' | 'warn' | 'bad' }

// The module's cache: the timer fills it, the render hooks only read it.
let home = ''
let configPath = ''
let star: Star | null = null
let starError = ''
let live: Live | null = null
let enabled = true
// A hot reload re-imports this module (clearing everything above) without
// re-firing session.start when the code is unchanged, so the render hooks
// start it too.
let started = false
let lastText = ''

function expand(path: string): string {
  return path.startsWith('~/') ? home + path.slice(1) : path
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'as', 'is', 'in', 'for',
  'with', 'your', 'our', 'my', 'that', 'it', 'on', 'by', 'from',
])

function words(text: unknown): Set<string> {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 0 && !STOPWORDS.has(w)),
  )
}

// Word overlap of the two purposes (Jaccard), as 0-5 pips. A rough nudge,
// not a score: the alignment note says the real reason they fit.
export function alignmentPips(a: unknown, b: unknown): number {
  const x = words(a)
  const y = words(b)
  if (x.size === 0 || y.size === 0) return 0
  let shared = 0
  for (const w of x) if (y.has(w)) shared += 1
  const union = new Set([...x, ...y]).size
  return union === 0 ? 0 : Math.min(5, Math.floor((shared * 5) / union))
}

function truncate(text: unknown, max: number): string {
  const s = String(text || '')
  return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s
}

export function describeAge(iso: unknown, now = Date.now()): { text: string; color: string } {
  const then = Date.parse(String(iso))
  if (Number.isNaN(then)) return { text: '', color: 'gray' }
  const min = Math.max(0, Math.floor((now - then) / 60_000))
  if (min <= 5) return { text: min + 'm', color: 'green' }
  if (min <= 60) return { text: min + 'm', color: 'yellow' }
  if (min < 1440) return { text: 'stale ' + Math.floor(min / 60) + 'h', color: 'red' }
  return { text: 'stale ' + Math.floor(min / 1440) + 'd', color: 'red' }
}

async function readFiles($: any) {
  try {
    star = JSON.parse(await $.fs.read(configPath))
    starError = ''
  } catch (err) {
    star = null
    starError = String(err).includes('JSON') ? 'is not valid JSON' : 'was not found'
  }
  live = null
  if (star && star.live && star.live.file) {
    try {
      live = JSON.parse(await $.fs.read(expand(star.live.file)))
    } catch {
      live = null
    }
  }
}

// Re-reads the files and redraws only when something changed.
async function tick($: any) {
  await readFiles($)
  const text = JSON.stringify([star, live, enabled])
  if (text !== lastText) {
    lastText = text
    $.ui.invalidate('ui.render')
  }
}

async function start($: any) {
  if (started) return
  started = true
  home = String((await $.env.get('HOME')) || '')
  configPath = expand(String((await $.env.get('NORTHSTAR_CONFIG')) || '~/.claude/northstar/northstar.json'))
  enabled = (await $.store.get(STORE_ENABLED)) !== false
  await $.command.register({
    name: 'northstar',
    description: 'Show your North Star · /northstar init · /northstar focus week|month|quarter <text> · /northstar stop|start',
  })
  $.clock.every(TICK_MS, () => tick($))
  await tick($)
}

// What `/northstar init` writes: placeholder text only, nothing personal.
export const TEMPLATE: Star = {
  title: 'NORTH STAR',
  you: { label: 'YOU', purpose: 'Your purpose, in one line' },
  org: { label: 'ORG', name: 'Your organisation', purpose: "Your organisation's purpose, in one line" },
  focus: { week: '', month: '', quarter: '' },
  year: { goal: 'The one outcome that matters most this year', metric: 'its number' },
  five_year: { goal: 'What success looks like in five years', metric: 'its number' },
}

const SETUP_HELP = [
  'North Star is not set up yet.',
  '  Run /northstar init for a starter file to edit, or',
  '  Ask your agent: "Set up my North Star using the northstar plugin\'s AGENT.md."',
  '  It interviews you and writes the config file named above.',
].join('\n')

// The full block as plain text, for /northstar.
export function textBlock(s: Star, l: Live | null): string {
  const you = s.you || {}
  const org = s.org || {}
  const pad = (t: string) => ('  ' + t).padEnd(9)
  const lines = ['🔭 ' + (s.title || 'NORTH STAR')]
  if (you.purpose) lines.push(pad(you.label || 'YOU') + you.purpose)
  if (org.purpose) lines.push(pad(org.label || org.name || 'ORG') + org.purpose)
  for (const h of HORIZONS) {
    lines.push(pad(h.tag) + (s.focus?.[h.key] || '— (/northstar focus ' + h.key + ' <text>)'))
  }
  if (s.year?.goal) lines.push(pad('1YR') + s.year.goal + (s.year.metric ? ' (' + s.year.metric + ')' : ''))
  if (s.five_year?.goal) lines.push(pad('5YR') + s.five_year.goal + (s.five_year.metric ? ' (' + s.five_year.metric + ')' : ''))
  if (you.purpose && org.purpose) {
    const pips = alignmentPips(you.purpose, org.purpose)
    lines.push(pad('ALIGN') + '●'.repeat(pips) + '○'.repeat(5 - pips) + (s.alignment_note ? '  ' + s.alignment_note : ''))
  }
  if (s.live && l && l.text) {
    const age = describeAge(l.at).text
    lines.push(pad(s.live.label || 'LIVE') + l.text + (age ? ' · ' + age : ''))
  }
  return lines.join('\n')
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    await start($)
    return out
  })

  on('command.run', { command: 'northstar' }, async ($, e) => {
    await start($)
    const raw = String(e.args ?? '').trim()
    const word = raw.split(/\s+/)[0]?.toLowerCase() || ''

    if (word === 'stop' || word === 'start') {
      enabled = word === 'start'
      await $.store.set(STORE_ENABLED, enabled)
      lastText = ''
      await tick($)
      return {
        text: enabled
          ? 'North Star: on. It shows in every session again.'
          : 'North Star: off in every session from now on. /northstar start brings it back.',
      }
    }

    if (word === 'path' || word === 'status') {
      await readFiles($)
      return {
        text: [
          'North Star: ' + (enabled ? 'on' : 'off (/northstar start)'),
          '  config  ' + configPath + (star ? '' : '  (' + starError + ')'),
          star && star.live && star.live.file ? '  live    ' + expand(star.live.file) + (live ? '' : '  (not readable yet)') : '',
        ].filter(Boolean).join('\n'),
      }
    }

    if (word === 'init') {
      if (await $.fs.exists(configPath)) {
        return { text: 'North Star: ' + configPath + ' already exists, so nothing was written. Edit it, or ask your agent to.' }
      }
      await $.fs.write(configPath, JSON.stringify(TEMPLATE, null, 2) + '\n')
      lastText = ''
      await tick($)
      return {
        text: [
          'North Star: wrote a starter file to ' + configPath + '.',
          '  Replace the placeholder lines with your own, or ask your agent:',
          '  "Set up my North Star using the northstar plugin\'s AGENT.md."',
        ].join('\n'),
      }
    }

    if (word === 'focus') {
      const m = raw.match(/^focus\s+(\S+)\s*(.*)$/i)
      const which = (m?.[1] || '').toLowerCase()
      const h = HORIZONS.find((x) => (x.aliases as readonly string[]).includes(which))
      if (!h) return { text: 'Usage: /northstar focus week|month|quarter <text>  (no text clears it)' }
      await readFiles($)
      if (!star) return { text: 'North Star: ' + configPath + ' ' + starError + '.\n' + SETUP_HELP }
      const value = (m?.[2] || '').trim()
      const next = { ...star, focus: { ...(star.focus || {}), [h.key]: value } }
      await $.fs.write(configPath, JSON.stringify(next, null, 2) + '\n')
      lastText = ''
      await tick($)
      return { text: 'North Star: ' + h.key + ' focus ' + (value ? 'set to "' + value + '".' : 'cleared.') }
    }

    await readFiles($)
    if (!star) return { text: 'North Star: ' + configPath + ' ' + starError + '.\n' + SETUP_HELP }
    return { text: textBlock(star, live) + (enabled ? '' : '\n  (hidden in sessions: /northstar start shows it)') }
  })

  // Terminal footer, for those who choose it: the column right of the statusline.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!started) void start($)
    if (!enabled || !star || e.surface !== 'terminal' || star.placement?.terminal !== 'footer') return next(e)
    const cols = Number(e.viewport?.columns ?? 120)
    const offset = Number(star.placement?.footer_offset ?? 84)
    const width = Math.max(28, Math.min(72, cols - offset))
    return northStarTree($.ui.resolve(e), width)
  })

  // Everywhere else: the band above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!started) void start($)
    if (!enabled || !star) return next(e)
    if (e.surface === 'terminal' && star.placement?.terminal === 'footer') return next(e)
    const width = Math.max(40, Math.min(110, Number(e.props?.bodyColumns ?? e.viewport?.columns ?? 90) - 2))
    const mine = northStarTree($.ui.resolve(e), width)
    const theirs = await next(e)
    if (!theirs) return mine
    const { Box } = $.ui.resolve(e)
    return <Box flexDirection="column">{mine}{theirs}</Box>
  })
}

function northStarTree(ui: any, width: number) {
  const { Box, Text } = ui
  const s = star || {}
  const you = s.you || {}
  const org = s.org || {}
  const body = width - 7

  const row = (tag: string, color: string, text: string, hint?: string) => (
    <Box flexDirection="row">
      <Text color={color} bold>{truncate(tag, 6).padEnd(6)}</Text>
      <Text>{truncate(text, hint ? Math.max(8, body - hint.length - 1) : body)}</Text>
      {hint && <Text dimColor>{' ' + hint}</Text>}
    </Box>
  )

  const pips = alignmentPips(you.purpose, org.purpose)
  const age = describeAge(live && live.at)
  const liveColor = live?.status === 'bad' ? 'red' : live?.status === 'warn' ? 'yellow' : 'green'

  return (
    <Box flexDirection="column" width={width}>
      <Text color="yellow" bold wrap="truncate-end">{'🔭 ' + (s.title || 'NORTH STAR')}</Text>
      {you.purpose && row(you.label || 'YOU', 'cyan', you.purpose)}
      {org.purpose && row(org.label || org.name || 'ORG', 'blue', org.purpose)}
      {HORIZONS.map((h) => {
        const text = s.focus?.[h.key] || ''
        return text ? row(h.tag, 'magenta', text) : row(h.tag, 'magenta', '—', '/northstar focus ' + h.key)
      })}
      {s.year?.goal && row('1YR', 'magenta', s.year.goal, s.year.metric)}
      {s.five_year?.goal && row('5YR', 'magenta', s.five_year.goal, s.five_year.metric)}
      {you.purpose && org.purpose && (
        <Box flexDirection="row">
          <Text color="green" bold>{'ALIGN'.padEnd(6)}</Text>
          <Text color={pips >= 3 ? 'yellow' : 'gray'}>{'●'.repeat(pips) + '○'.repeat(5 - pips)}</Text>
          {s.alignment_note && <Text dimColor>{' ' + truncate(s.alignment_note, Math.max(8, body - 6))}</Text>}
        </Box>
      )}
      {s.live && live && live.text && (
        <Box flexDirection="row">
          <Text color="cyan" bold>{truncate(s.live.label || 'LIVE', 6).padEnd(6)}</Text>
          <Text color={liveColor}>{truncate(live.text, Math.max(8, body - 10))}</Text>
          {age.text && <Text color={age.color}>{' ↻' + age.text}</Text>}
        </Box>
      )}
    </Box>
  )
}
