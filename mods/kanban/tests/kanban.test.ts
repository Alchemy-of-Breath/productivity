import { expect, mock, test } from 'claude-code/testing'
import { fetchOpenTasks, layoutFor, openTasksOf, parseConfig, toTasks, type McpResult } from '../hooks/monday.ts'

// Mocked data only: invented people, boards and tasks. Shapes follow what the
// Monday connector returns (display strings per column id; a status whose label
// was retired comes back as { index }).

const ME = 'Ana Example'
const BOARD = 111

const STATUS_LABELS = [
  { label: 'Working on it', index: 1, is_done: false },
  { label: 'Done', index: 3, is_done: true },
  { label: 'Stuck', index: 2, is_done: false },
  { label: 'Not Started', index: 0, is_done: false },
  { label: 'INFO ONLY', index: 5, is_done: false },
]

const INFO = {
  board: {
    id: String(BOARD),
    name: 'Demo Tasks',
    columns: [
      { id: 'name', title: 'Name', type: 'name', settings: {} },
      { id: 'owner', title: 'Owner', type: 'people', settings: {} },
      { id: 'support', title: 'Support', type: 'people', settings: {} },
      { id: 'status', title: 'Status', type: 'status', settings: { labels: STATUS_LABELS } },
      { id: 'prio', title: 'Priority', type: 'status', settings: { labels: [
        { label: 'Critical', index: 0, is_done: false },
        { label: 'High', index: 1, is_done: false },
        { label: 'Low', index: 3, is_done: false },
      ] } },
      { id: 'when', title: 'Timeline', type: 'timeline', settings: {} },
      { id: 'due', title: 'Due date', type: 'date', settings: {} },
    ],
  },
}

const item = (id: string, name: string, cv: Record<string, unknown>) => ({
  id,
  name,
  url: `https://example.invalid/boards/${BOARD}/pulses/${id}`,
  column_values: cv,
})

const ITEMS = [
  item('1', 'Write the report', { owner: ME, status: 'Working on it', due: '2000-01-02', prio: 'High' }),
  item('2', 'Already shipped', { owner: ME, status: 'Done', due: '2000-01-01', prio: null }),
  item('3', 'Someone else', { owner: 'Ben Sample', status: 'Working on it', due: '2000-01-01', prio: null }),
  item('4', 'Shared with me', { owner: 'Ben Sample, ' + ME, status: 'Stuck', due: '2999-12-31', prio: 'Critical' }),
  item('5', 'Only supporting', { owner: 'Ben Sample', support: ME, status: 'Not Started', due: null, prio: null }),
  item('6', 'No status yet', { owner: ME, status: null, due: null, prio: 'Low' }),
  item('7', 'FYI item', { owner: ME, status: { changed_at: '2026-01-01T00:00:00Z', index: 5 }, due: null, prio: null }),
  item('8', 'Timeline only', { owner: ME, status: 'Not Started', due: '2999-01-01' }),
]

const ok = (data: unknown): McpResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false })

const CFG = { boards: [{ id: BOARD }], userName: ME, ignoreStatuses: ['INFO ONLY'] }

// ── Config ──────────────────────────────────────────────────────────────────

test('config: board ids as numbers or numeric strings, defaults filled in', () => {
  const { config } = parseConfig(JSON.stringify({ boards: [{ id: '123' }, 456] }))
  expect(config?.boards.map((b) => b.id)).toEqual([123, 456])
  expect(config?.server).toBe('claude_ai_monday_com')
  expect(config?.refreshMinutes).toBe(10)
  expect(config?.userName).toBe('')
})

test('config: the placeholder, no boards and bad JSON are refused with a reason', () => {
  expect(parseConfig(JSON.stringify({ boards: [{ id: 'REPLACE_WITH_BOARD_ID' }] })).error).toContain('not a number')
  expect(parseConfig(JSON.stringify({ boards: [] })).error).toContain('boards')
  expect(parseConfig('{ nope').error).toContain('JSON')
})

// ── Shaping ─────────────────────────────────────────────────────────────────

test('layout finds owner, status, priority and due columns without being told', () => {
  const l = layoutFor(INFO, { id: BOARD })
  expect(l.ownerCols).toEqual(['owner'])
  expect(l.statusCol).toBe('status')
  expect(l.priorityCol).toBe('prio')
  expect(l.dueCol).toBe('due')
  expect(l.boardName).toBe('Demo Tasks')
})

test('layout honours explicit column ids from the config', () => {
  const l = layoutFor(INFO, { id: BOARD, ownerColumns: ['support'], dueColumn: 'when' })
  expect(l.ownerCols).toEqual(['support'])
  expect(l.dueCol).toBe('when')
})

test('open tasks: mine, not done, not ignored; a retired label resolves by index', () => {
  const l = layoutFor(INFO, { id: BOARD })
  const tasks = toTasks(ITEMS, l)
  const open = openTasksOf(tasks, ME, ['INFO ONLY']).map((t) => t.title).sort()
  expect(open).toEqual(['No status yet', 'Shared with me', 'Timeline only', 'Write the report'])
  expect(tasks.find((t) => t.id === '7')?.status).toBe('INFO ONLY')
})

test('a Done label the board forgot to flag is still done', () => {
  const info = structuredClone(INFO)
  info.board.columns[3]!.settings = { labels: STATUS_LABELS.map((x) => ({ ...x, is_done: false })) } as never
  const tasks = toTasks(ITEMS, layoutFor(info, { id: BOARD }))
  expect(tasks.find((t) => t.id === '2')?.isDone).toBe(true)
})

test('due date of a range is its end; none is null', () => {
  const l = layoutFor(INFO, { id: BOARD, dueColumn: 'when' })
  const t = toTasks([item('9', 'Range', { owner: ME, when: '2026-10-19 - 2026-10-23' })], l)
  expect(t[0]!.due).toBe('2026-10-23')
  expect(toTasks([item('10', 'None', { owner: ME })], l)[0]!.due).toBeNull()
})

// ── Fetching (the MCP call is injected) ─────────────────────────────────────

function fakeMonday(pages: unknown[][] = [ITEMS]) {
  const calls: { tool: string; args: Record<string, any> }[] = []
  const call = async (tool: string, args: Record<string, any>): Promise<McpResult> => {
    calls.push({ tool, args })
    if (tool === 'get_user_context') return ok({ user: { id: '1', name: ME } })
    if (tool === 'get_board_info') return ok(INFO)
    if (tool === 'get_board_items_page') {
      const n = args.cursor ? Number(args.cursor) : 0
      return ok({
        items: pages[n],
        pagination: { has_more: n + 1 < pages.length, nextCursor: n + 1 < pages.length ? String(n + 1) : null },
      })
    }
    throw new Error('unexpected tool ' + tool)
  }
  return { call, calls }
}

test('fetch: sorted by due then priority, overdue first, no-date last', async () => {
  const { call } = fakeMonday()
  const cfg = parseConfig(JSON.stringify(CFG)).config!
  const snap = await fetchOpenTasks(call, cfg, 1000)
  expect(snap.tasks.map((t) => t.title)).toEqual(['Write the report', 'Timeline only', 'Shared with me', 'No status yet'])
})

test('fetch: read-only tools only; follows the cursor; asks Monday who you are when no name is set', async () => {
  const { call, calls } = fakeMonday([[ITEMS[0]!], [ITEMS[3]!]])
  const cfg = parseConfig(JSON.stringify({ boards: [{ id: BOARD }] })).config!
  const snap = await fetchOpenTasks(call, cfg, 1000)
  expect(snap.userName).toBe(ME)
  expect(snap.tasks.map((t) => t.id).sort()).toEqual(['1', '4'])
  expect(new Set(calls.map((c) => c.tool))).toEqual(new Set(['get_user_context', 'get_board_info', 'get_board_items_page']))
  const pageCalls = calls.filter((c) => c.tool === 'get_board_items_page')
  expect(pageCalls.length).toBe(2)
  expect(pageCalls[1]!.args.cursor).toBe('1')
  expect(pageCalls[0]!.args.columnIds).toEqual(['owner', 'status', 'due', 'prio'])
})

test('fetch: one failing board is reported, the others still load', async () => {
  const good = fakeMonday()
  const call = async (tool: string, args: Record<string, any>) => {
    if (args.boardId === 222) return { content: [{ type: 'text', text: 'No access to board' }], isError: true }
    return good.call(tool, args)
  }
  const cfg = parseConfig(JSON.stringify({ ...CFG, boards: [{ id: 222 }, { id: BOARD }] })).config!
  const snap = await fetchOpenTasks(call, cfg, 1000)
  expect(snap.errors[0]).toContain('board 222')
  expect(snap.errors[0]).toContain('No access')
  expect(snap.tasks.length).toBe(4)
})

test('fetch: Monday not connected gives an error line, not a throw', async () => {
  const call = async () => { throw new Error('server not connected') }
  const cfg = parseConfig(JSON.stringify({ boards: [{ id: BOARD }] })).config!
  const snap = await fetchOpenTasks(call, cfg, 1000)
  expect(snap.tasks).toEqual([])
  expect(snap.errors[0]).toContain('server not connected')
})

// ── The mod, in an engine ───────────────────────────────────────────────────

const HOME = '/home/ana'
const CONFIG = HOME + '/.claude/kanban/monday.json'
const BOARD_PY = HOME + '/.claude/kanban/board.py'

function stub(on: any, files: Record<string, string>, opts: { monday?: ReturnType<typeof fakeMonday>; store?: Record<string, unknown> } = {}) {
  const writes: { path: string; text: string }[] = []
  const runs: string[] = []
  const mcp: { server: string; tool: string }[] = []
  mock.clock(on)
  mock.store(on, opts.store ?? {})
  mock.env(on, { HOME })
  on('fs.read', (_: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error('ENOENT: ' + e.path)
    return { value: files[e.path] }
  })
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: e.path in files }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    writes.push(e)
    files[e.path] = e.text
    return { value: undefined }
  })
  on('mcp.call', async (_: unknown, e: { server: string; tool: string; args: Record<string, unknown> }) => {
    mcp.push({ server: e.server, tool: e.tool })
    return { value: await (opts.monday ?? fakeMonday()).call(e.tool, e.args) }
  })
  on('process.run', (_: unknown, e: { argv?: string[] }) => {
    runs.push(String(e.argv?.join(' ')))
    return { value: { exitCode: 0, stdout: JSON.stringify([{ id: 'c1', title: 'Water the plants', status: 'todo', day: null }]), stderr: '' } }
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  return Object.assign(writes, { runs, mcp })
}

const run = ($: any, args: string) => $.command.run({ command: 'kanban', args, origin: { kind: 'composer' } } as any)
const pane = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'kanban',
    component: 'Pane',
    requestId: 'kanban',
    surface,
    viewport: { columns: 140, rows: 40 },
    props: { title: 'KANBAN', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  }) as any

test('no config, no personal board: the pane says how to set Monday up; nothing is fetched', async ($, on) => {
  const w = stub(on, {})
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await run($, '')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Text', text: /Monday is not set up yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'v-day' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'v-monday' })).toBeDefined()
  expect(w.mcp.length).toBe(0)
  expect(w.runs.length).toBe(0)
})

test('/kanban init writes placeholders only, and never overwrites', async ($, on) => {
  const w = stub(on, {})
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect((await run($, 'init')).text).toContain('Wrote a starter file to ' + CONFIG)
  expect(w.length).toBe(1)
  expect(w[0]!.text).toContain('REPLACE_WITH_BOARD_ID')
  expect(w[0]!.text).not.toMatch(/@|token|Bearer/)
  expect((await run($, 'init')).text).toContain('Not overwritten')
  expect(w.length).toBe(1)
  expect((await run($, 'refresh')).text).toContain('not a number')
})

test('configured: /kanban refresh fetches through the Monday server in the config and the pane lists my open tasks', async ($, on) => {
  const w = stub(on, { [CONFIG]: JSON.stringify({ ...CFG, server: 'test_monday' }) })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  expect((await run($, 'refresh')).text).toContain('4 open for ' + ME)
  expect(new Set(w.mcp.map((m) => m.server))).toEqual(new Set(['test_monday']))
  expect(w.runs.length).toBe(0)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ type: 'Text', text: /Write the report/ }) ?? await ui.find({ type: 'Button', text: /Write the report/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Already shipped/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: /Someone else/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the last result is kept in the store and shown by the next session before any fetch', async ($, on) => {
  const kept = { fetchedAt: 0, userName: ME, errors: [], tasks: [{ id: '1', title: 'Kept task', url: '', board: 'Demo Tasks', status: 'Stuck', due: null, priority: '', priorityRank: 99, owners: [ME], isDone: false }] }
  const w = stub(on, { [CONFIG]: JSON.stringify(CFG) }, { store: { mondaySnapshot: kept } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await run($, '')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Button', text: /Kept task/ })).toBeDefined()
  expect(w.mcp.length).toBe(0)
})

test('a Monday failure shows in the pane and the personal board keeps working', async ($, on) => {
  const monday = { calls: [], call: async () => ({ content: [{ type: 'text', text: 'connector off' }], isError: true }) } as any
  const w = stub(on, { [CONFIG]: JSON.stringify(CFG), [BOARD_PY]: '# board' }, { monday })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await run($, 'refresh')
  await run($, 'day')
  const ui = await $.ui.mount(pane('terminal'))
  expect(w.runs.some((r) => r.includes('board.py') && r.includes('list'))).toBe(true)
  expect(await ui.find({ type: 'Button', text: /Water the plants/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'v-day' })).toBeDefined()
  await ui.unmount()
  await run($, 'monday')
  const ui2 = await $.ui.mount(pane('terminal'))
  expect(await ui2.find({ type: 'Text', text: /connector off/ })).toBeDefined()
})

test('personal board present, Monday not configured: Day view works as before', async ($, on) => {
  const w = stub(on, { [BOARD_PY]: '# board' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await run($, '')
  const ui = await $.ui.mount(pane('terminal'))
  expect(await ui.find({ type: 'Button', text: /Water the plants/ })).toBeDefined()
  expect(w.mcp.length).toBe(0)
})

test('paths follow HOME and KANBAN_MONDAY_CONFIG: nothing machine-specific', async ($, on) => {
  const w = stub(on, {})
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect((await run($, 'status')).text).toContain('config  ' + CONFIG)
  expect(w.length).toBe(0)
})
