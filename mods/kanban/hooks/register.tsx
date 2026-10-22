/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { On, RenderElement } from 'claude-code'
import {
  TEMPLATE_CONFIG,
  bucketOf,
  fetchOpenTasks,
  isoToday,
  parseConfig,
  type MondayConfig,
  type Snapshot,
  type Task,
} from './monday.ts'

/**
 * Kanban mod: `/kanban` toggles a pane with two sources.
 *
 * 1. Your Monday.com open tasks (the MONDAY view). Read-only. Fetched straight
 *    from the Monday connector the person has in Claude (`$.mcp.call`), so
 *    there is no helper script or cache file to keep running. The last result
 *    is kept in the mod's own store so the pane has something to show at once.
 *    Config: ~/.claude/kanban/monday.json (see examples/monday.example.json).
 *
 * 2. An optional personal board (DAY / WEEK views): ~/.claude/kanban/board.json,
 *    only ever written by ~/.claude/kanban/board.py; every button shells out to
 *    it. Where board.py does not exist those views and buttons are hidden.
 *
 * Nothing personal lives in the plugin: no ids, names, emails or tokens.
 */

const PANE_ID = 'kanban'
const POLL_MS = 4000
const STORE_SNAPSHOT = 'mondaySnapshot'

type Proposal = { to: string; text: string; status: string }
type Card = {
  id: string
  title: string
  desc?: string
  status: 'inbox' | 'todo' | 'doing' | 'done' | 'later'
  day: string | null
  bonus?: boolean
  needs_human?: boolean
  done_when?: string
  proposal?: Proposal | null
  done_at?: string
}
type View = 'day' | 'week' | 'monday'

const ICON: Record<string, string> = { inbox: '◇', todo: '○', doing: '◑', done: '●', later: '▱' }
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

const isoDay = (d: Date): string => isoToday(d)

function weekDays(from: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => isoDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)))
}

export function ageText(at: number, now: number): string {
  const min = Math.max(0, Math.floor((now - at) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  if (min < 1440) return `${Math.floor(min / 60)}h ago`
  return `${Math.floor(min / 1440)}d ago`
}

export const SETUP_HELP = [
  'Monday is not set up yet.',
  '  1. Run /kanban init to write a starter config.',
  '  2. Open it and replace REPLACE_WITH_BOARD_ID with the number in your board\'s URL',
  '     (monday.com/boards/<number>). Add more boards to the list if you like.',
  '  3. Run /kanban refresh. Needs the Monday connector turned on in Claude.',
].join('\n')

// Personal board (board.py)
let cards: Card[] = []
let selected: string | null = null
let lastError = ''
let lastRaw = ''
let hasBoard = false
let poll: { cancel?: () => void } | null = null

// Monday
let mcfg: MondayConfig | null = null
let mcfgState: 'missing' | 'invalid' | 'ok' = 'missing'
let mcfgError = ''
let snap: Snapshot | null = null
let isFetching = false
let monTimer: { cancel?: () => void } | null = null
let mselected: string | null = null

// Shared
let view: View = 'day'
let isOpen = false
let started = false
let home = ''
let configPath = ''
let run: (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>
let invalidate: () => void = () => {}

// A hot reload re-imports the module without re-firing session.start, so
// the command and render hooks start it too.
async function init($: any) {
  if (started) return
  started = true
  home = String((await $.env.get('HOME')) || '')
  configPath = String((await $.env.get('KANBAN_MONDAY_CONFIG')) || home + '/.claude/kanban/monday.json')
  const boardPy = home + '/.claude/kanban/board.py'
  run = (args) =>
    $.process.run(['bash', '-lc', `python3 '${boardPy}' ${args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ')}`])
  invalidate = () => $.ui.invalidate('ui.render')
  hasBoard = await $.fs.exists(boardPy).catch(() => false)
  if (!hasBoard) view = 'monday'
  try {
    const kept = (await $.store.get(STORE_SNAPSHOT)) as Snapshot | undefined
    if (kept && Array.isArray(kept.tasks) && typeof kept.fetchedAt === 'number') snap = kept
  } catch {
    snap = null
  }
  await readConfig($)
}

async function readConfig($: any) {
  let text: string
  try {
    text = String(await $.fs.read(configPath))
  } catch {
    mcfg = null
    mcfgState = 'missing'
    mcfgError = ''
    return
  }
  const parsed = parseConfig(text)
  if (parsed.config) {
    mcfg = parsed.config
    mcfgState = 'ok'
    mcfgError = ''
  } else {
    mcfg = null
    mcfgState = 'invalid'
    mcfgError = parsed.error || 'is not valid'
  }
}

async function refreshMonday($: any) {
  if (!mcfg || isFetching) return
  isFetching = true
  invalidate()
  const cfg = mcfg
  try {
    snap = await fetchOpenTasks((tool, args) => $.mcp.call(cfg.server, tool, args), cfg, Number(await $.clock.now()))
    await $.store.set(STORE_SNAPSHOT, snap).catch(() => undefined)
  } finally {
    isFetching = false
    invalidate()
  }
}

async function loadBoard() {
  if (!hasBoard) return
  const r = await run(['list', '--json'])
  if (r.exitCode !== 0) {
    lastError = (r.stderr || r.stdout).trim().slice(0, 200)
    invalidate()
    return
  }
  if (r.stdout !== lastRaw) {
    lastRaw = r.stdout
    try {
      cards = JSON.parse(r.stdout)
      lastError = ''
    } catch {
      lastError = 'board.json unreadable'
    }
    invalidate()
  }
}

async function act(args: string[]) {
  const r = await run(args)
  if (r.exitCode !== 0) lastError = (r.stderr || r.stdout).trim().slice(0, 200)
  lastRaw = ''
  await loadBoard()
}

function summary(): string {
  if (mcfgState === 'missing') return SETUP_HELP
  if (mcfgState === 'invalid') return `Monday config ${configPath} ${mcfgError}.`
  if (!snap) return 'Monday: nothing fetched yet. Run /kanban refresh.'
  const today = isoDay(new Date())
  const late = snap.tasks.filter((t) => t.due !== null && t.due < today).length
  const errs = snap.errors.length ? `\n  ! ${snap.errors.join('\n  ! ')}` : ''
  return `Monday: ${snap.tasks.length} open for ${snap.userName || 'you'}, ${late} overdue (${ageText(snap.fetchedAt, Date.now())}).${errs}`
}

function stopTimers() {
  poll?.cancel?.()
  monTimer?.cancel?.()
}


export function register(on: On) {
  on('session.start', async ($, e, next) => {
    await init($)
    try {
      await $.command.register({
        name: 'kanban',
        description: 'Kanban: your open Monday tasks, plus your personal board · /kanban init|refresh|status|day|week|monday',
      })
    } catch (err) {
      $.ui.log(`kanban: could not register /kanban (${String(err).slice(0, 120)})`)
    }
    return next(e)
  })

  on('command.run', { command: 'kanban' }, async ($, e, next) => {
    await init($)
    const arg = String(e.args ?? '').trim().toLowerCase()

    if (arg === 'init') {
      if (await $.fs.exists(configPath)) return { text: `Not overwritten: ${configPath} already exists.` }
      await $.fs.write(configPath, JSON.stringify(TEMPLATE_CONFIG, null, 2) + '\n')
      await readConfig($)
      return { text: `Wrote a starter file to ${configPath}. Replace REPLACE_WITH_BOARD_ID with your board's number, then run /kanban refresh.` }
    }
    if (arg === 'status') {
      await readConfig($)
      return { text: `config  ${configPath}\nboard   ${hasBoard ? 'personal board found' : 'no personal board (Monday only)'}\n${summary()}` }
    }
    if (arg === 'refresh') {
      await readConfig($)
      if (!mcfg) return { text: summary() }
      await refreshMonday($)
      return { text: summary() }
    }

    if (arg === 'monday' || (hasBoard && (arg === 'week' || arg === 'day'))) {
      view = arg as View
    } else if (isOpen && arg === '') {
      await $.ui.close({ id: PANE_ID })
      isOpen = false
      stopTimers()
      return { text: 'Kanban hidden.' }
    }
    if (!hasBoard) view = 'monday'

    await readConfig($)
    await loadBoard()
    const opened: unknown = await $.ui.open({ id: PANE_ID, title: 'KANBAN', holdToasts: true })
    if (opened && typeof opened === 'object' && (opened as { isPlaced?: boolean }).isPlaced === false) {
      await $.ui.close({ id: PANE_ID }).catch(() => undefined)
      return { text: 'Widen the terminal (or use fullscreen) to dock the kanban pane.' }
    }
    isOpen = true
    stopTimers()
    if (hasBoard) poll = $.clock.every(POLL_MS, () => void loadBoard().catch(() => undefined)) as never
    if (mcfg) {
      const cfg = mcfg
      monTimer = $.clock.every(cfg.refreshMinutes * 60_000, () => void refreshMonday($).catch(() => undefined)) as never
      const age = snap ? Number(await $.clock.now()) - snap.fetchedAt : Infinity
      if (age > 60_000) void refreshMonday($).catch(() => undefined)
    }
    return { text: `Kanban shown (${view}).` }
  })

  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    isOpen = false
    stopTimers()
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    await init($)
    const { Box, Text, Button } = await $.ui.resolve(e)
    const now = new Date()
    const today = isoDay(now)
    const width: number = e.props?.bodyColumns ?? 60

    const Label = (t: string) => <Text bold>{t.toUpperCase()}</Text>
    const rule = <Text dimColor>{'─'.repeat(Math.max(10, Math.min(width - 2, 60)))}</Text>

    // ── Personal board ────────────────────────────────────────────────────
    const flagsOf = (c: Card) => {
      const f: string[] = []
      if (c.day && c.day < today && c.status !== 'done' && c.status !== 'later') f.push(`▲ LATE ${c.day.slice(5)}`)
      if (c.needs_human) f.push('◆ MANUAL')
      if (c.proposal?.status === 'pending') f.push('➤ TO APPROVE')
      if (c.proposal?.status === 'approved') f.push('✓ APPROVED')
      return f.join('  ')
    }

    const row = (c: Card): RenderElement => (
      <Box key={c.id} flexDirection="column">
        <Box flexDirection="row">
          <Button key={`sel-${c.id}`} plain onPress={() => { selected = selected === c.id ? null : c.id; invalidate() }}>
            {`${ICON[c.status] ?? '·'} ${c.title}`}
          </Button>
          <Box flexGrow={1} />
          <Text dimColor>{flagsOf(c)}</Text>
        </Box>
        {selected === c.id ? detail(c) : null}
      </Box>
    )

    const btn = (key: string, label: string, args: string[]) => (
      <Button key={key} onPress={() => void act(args)}>{label}</Button>
    )

    const detail = (c: Card): RenderElement => {
      const days = weekDays(new Date()).filter((d) => d !== c.day)
      return (
        <Box flexDirection="column" borderStyle="single" paddingX={1}>
          {c.desc ? <Text>{c.desc}</Text> : null}
          {c.done_when ? <Text dimColor>{`DONE WHEN: ${c.done_when}`}</Text> : null}
          {c.proposal?.status === 'pending' ? (
            <Box flexDirection="column">
              <Text bold>{`TO APPROVE → ${c.proposal.to}`}</Text>
              <Text>{c.proposal.text}</Text>
              <Box flexDirection="row">
                {btn(`ap-${c.id}`, 'APPROVE', ['propose', 'approve', c.id])}
                <Text> </Text>
                {btn(`rj-${c.id}`, 'REJECT', ['propose', 'reject', c.id])}
              </Box>
            </Box>
          ) : null}
          <Box flexDirection="row" flexWrap="wrap">
            {btn(`do-${c.id}`, 'DOING', ['move', c.id, 'doing'])}
            <Text> </Text>
            {c.needs_human || c.status !== 'done' ? btn(`dn-${c.id}`, 'DONE', ['move', c.id, 'done']) : null}
            <Text> </Text>
            {days.slice(0, 5).map((d) => (
              <Box key={`dw-${c.id}-${d}`} flexDirection="row">
                {btn(`d-${c.id}-${d}`, DOW[new Date(d + 'T12:00').getDay()]!, ['plan', c.id, d])}
                <Text> </Text>
              </Box>
            ))}
            {btn(`lt-${c.id}`, 'LATER', ['move', c.id, 'later'])}
            <Text> </Text>
            {btn(`bn-${c.id}`, c.bonus ? 'PRIORITY' : 'IF TIME', ['edit', c.id, c.bonus ? '--no-bonus' : '--bonus'])}
            <Text> </Text>
            {btn(`ar-${c.id}`, 'CLOSE', ['archive', c.id])}
          </Box>
        </Box>
      )
    }

    const section = (title: string, list: Card[]) => (
      <Box key={title} flexDirection="column" marginBottom={1}>
        {Label(`${title} ${list.length}`)}
        {list.length ? list.map(row) : <Text dimColor>—</Text>}
      </Box>
    )

    // ── Monday ────────────────────────────────────────────────────────────
    const weekEnd = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7))

    const taskRow = (t: Task): RenderElement => {
      const flags = [t.status || 'no status', t.due ? `due ${t.due.slice(5)}` : '', t.priority].filter(Boolean).join(' · ')
      return (
        <Box key={`${t.board}-${t.id}`} flexDirection="column">
          <Box flexDirection="row">
            <Button key={`m-${t.id}`} plain onPress={() => { mselected = mselected === t.id ? null : t.id; invalidate() }}>
              {`○ ${t.title}`}
            </Button>
            <Box flexGrow={1} />
            <Text dimColor>{flags}</Text>
          </Box>
          {mselected === t.id ? (
            <Box flexDirection="column" borderStyle="single" paddingX={1}>
              <Text dimColor>{`BOARD: ${t.board}`}</Text>
              <Text dimColor>{t.url}</Text>
            </Box>
          ) : null}
        </Box>
      )
    }

    const mondayBody = (): RenderElement => {
      if (mcfgState === 'missing') return <Text>{SETUP_HELP}</Text>
      if (mcfgState === 'invalid') return <Text color="red">{`Monday config ${configPath} ${mcfgError}.`}</Text>
      const tasks = snap?.tasks ?? []
      const groups = (['Overdue', 'This week', 'Later', 'No date'] as const).map((b) =>
        tasks.filter((t) => bucketOf(t, today, weekEnd) === b),
      )
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text dimColor>
              {snap
                ? `${snap.userName || 'you'} · ${tasks.length} open · ${ageText(snap.fetchedAt, now.getTime())}`
                : isFetching ? 'fetching…' : 'not fetched yet'}
            </Text>
            <Box flexGrow={1} />
            <Button key="m-refresh" plain onPress={() => void refreshMonday($).catch(() => undefined)}>
              {isFetching ? 'FETCHING…' : 'REFRESH'}
            </Button>
          </Box>
          {(snap?.errors ?? []).map((m, i) => <Text key={`me-${i}`} color="red">{m}</Text>)}
          {snap && tasks.length === 0 && snap.errors.length === 0 ? <Text dimColor>Nothing open. Clear.</Text> : null}
          {groups.map((g, i) =>
            g.length ? (
              <Box key={`mg-${i}`} flexDirection="column" marginBottom={1}>
                {Label(`${['Overdue', 'This week', 'Later', 'No date'][i]} ${g.length}`)}
                {g.map(taskRow)}
              </Box>
            ) : null,
          )}
        </Box>
      )
    }

    // ── Header and body ───────────────────────────────────────────────────
    const tab = (key: string, label: string, v: View) => (
      <Button key={key} plain dimColor={view !== v} onPress={() => { view = v; invalidate() }}>{label}</Button>
    )
    const header = (
      <Box flexDirection="row">
        <Text bold>{`TODAY ${DOW[now.getDay()]} ${today.slice(8)}`}</Text>
        <Box flexGrow={1} />
        {hasBoard ? tab('v-day', 'DAY', 'day') : null}
        {hasBoard ? <Text> </Text> : null}
        {hasBoard ? tab('v-week', 'WEEK', 'week') : null}
        {hasBoard ? <Text> </Text> : null}
        {tab('v-monday', 'MONDAY', 'monday')}
      </Box>
    )

    const open = cards.filter((c) => c.status !== 'done' && c.status !== 'later')
    let body: RenderElement
    if (view === 'monday' || !hasBoard) {
      body = mondayBody()
    } else if (view === 'day') {
      const dueToday = (c: Card) => !c.bonus && (c.day === null || c.day <= today)
      const late = (snap?.tasks ?? []).filter((t) => t.due !== null && t.due < today).length
      body = (
        <Box flexDirection="column">
          {snap ? (
            <Button key="m-peek" plain onPress={() => { view = 'monday'; invalidate() }}>
              {`MONDAY ${snap.tasks.length} open${late ? ` · ${late} overdue` : ''} →`}
            </Button>
          ) : null}
          {section('Todo', open.filter((c) => (c.status === 'todo' || c.status === 'inbox') && dueToday(c) && c.day !== null))}
          {section('Doing', open.filter((c) => c.status === 'doing'))}
          {section('Done', cards.filter((c) => c.status === 'done' && (c.done_at ?? '').slice(0, 10) === today))}
          {section('✦ If time', open.filter((c) => c.bonus))}
          {section('No day', open.filter((c) => !c.bonus && c.day === null && c.status !== 'doing'))}
        </Box>
      )
    } else {
      const days = weekDays(new Date())
      body = (
        <Box flexDirection="column">
          {days.map((d) => section(`${DOW[new Date(d + 'T12:00').getDay()]} ${d.slice(5)}`, open.filter((c) => c.day === d)))}
          {section('No day', open.filter((c) => c.day === null))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {header}
        {rule}
        {lastError ? <Text color="red">{lastError}</Text> : null}
        {body}
      </Box>
    )
  })
}
