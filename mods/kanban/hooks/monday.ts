// Monday.com source for the kanban mod: pure parsing and shaping, plus one
// fetch routine that takes the MCP call as a parameter so it can be tested
// without an engine. Read-only: the only Monday tools used are
// get_user_context, get_board_info and get_board_items_page.
//
// Nothing about a person, a board or a workspace is written here. Each person
// points the mod at their own boards in ~/.claude/kanban/monday.json.

export type BoardCfg = {
  id: number
  ownerColumns?: string[]
  statusColumn?: string
  dueColumn?: string
  priorityColumn?: string
}

export type MondayConfig = {
  // The MCP server name as /mcp lists it; the tool-name spelling is accepted too.
  server: string
  // Your name as Monday shows it in a people column. Empty: asked of Monday.
  userName: string
  boards: BoardCfg[]
  refreshMinutes: number
  // Status labels that are never "open", on top of the board's own "done" flag
  // and the label "Done" (some boards do not flag their Done label).
  ignoreStatuses: string[]
}

export type Task = {
  id: string
  title: string
  url: string
  board: string
  status: string
  due: string | null
  priority: string
  priorityRank: number
  owners: string[]
  isDone: boolean
}

export type Snapshot = {
  fetchedAt: number
  userName: string
  tasks: Task[]
  errors: string[]
}

export const DEFAULT_SERVER = 'claude_ai_monday_com'
export const DEFAULT_REFRESH_MINUTES = 10
const MAX_PAGES = 10
const PAGE_SIZE = 500

export const TEMPLATE_CONFIG = {
  boards: [{ id: 'REPLACE_WITH_BOARD_ID' }],
}

function strList(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map((x) => String(x)).filter((x) => x.length > 0) : undefined
}

export function parseConfig(text: string): { config?: MondayConfig; error?: string } {
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    return { error: 'is not valid JSON' }
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.boards) || raw.boards.length === 0) {
    return { error: 'needs a "boards" list with at least one board id' }
  }
  const boards: BoardCfg[] = []
  for (const b of raw.boards) {
    const id = Number(typeof b === 'object' && b !== null ? b.id : b)
    if (!Number.isInteger(id) || id <= 0) {
      return { error: 'has a board id that is not a number (replace the placeholder with the number in your board\'s URL)' }
    }
    const entry: BoardCfg = { id }
    if (typeof b === 'object' && b !== null) {
      const owners = strList(b.ownerColumns)
      if (owners && owners.length) entry.ownerColumns = owners
      if (typeof b.statusColumn === 'string' && b.statusColumn) entry.statusColumn = b.statusColumn
      if (typeof b.dueColumn === 'string' && b.dueColumn) entry.dueColumn = b.dueColumn
      if (typeof b.priorityColumn === 'string' && b.priorityColumn) entry.priorityColumn = b.priorityColumn
    }
    boards.push(entry)
  }
  const refresh = Number(raw.refreshMinutes)
  return {
    config: {
      server: typeof raw.server === 'string' && raw.server ? raw.server : DEFAULT_SERVER,
      userName: typeof raw.userName === 'string' ? raw.userName.trim() : '',
      boards,
      refreshMinutes: Number.isFinite(refresh) && refresh >= 1 ? refresh : DEFAULT_REFRESH_MINUTES,
      ignoreStatuses: strList(raw.ignoreStatuses) ?? [],
    },
  }
}

// ── Reading MCP results ────────────────────────────────────────────────────

export type McpResult = { content?: { type: string; text?: string }[]; isError?: boolean }
export type McpCall = (tool: string, args: Record<string, unknown>) => Promise<McpResult>

export function resultJson(res: McpResult): any {
  const text = (res.content || []).find((b) => b.type === 'text' && typeof b.text === 'string')?.text ?? ''
  if (res.isError) throw new Error(text.trim().slice(0, 160) || 'Monday returned an error')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Monday returned something that is not JSON')
  }
}

// ── Board layout: which column is which ────────────────────────────────────

type Label = { text: string; isDone: boolean; index: number }
export type Layout = {
  boardName: string
  ownerCols: string[]
  statusCol: string | null
  dueCol: string | null
  priorityCol: string | null
  statusLabels: Label[]
  priorityLabels: Label[]
}

function labelsOf(col: any): Label[] {
  const list = col?.settings?.labels
  return Array.isArray(list)
    ? list.map((l: any) => ({ text: String(l.label ?? ''), isDone: l.is_done === true, index: Number(l.index) }))
    : []
}

export function layoutFor(info: any, cfg: BoardCfg): Layout {
  const board = info?.board ?? {}
  const cols: any[] = Array.isArray(board.columns) ? board.columns : []
  const byId = (id: string | undefined) => cols.find((c) => c.id === id)
  const ofType = (...t: string[]) => cols.filter((c) => t.includes(c.type))
  const titled = (list: any[], re: RegExp) => list.find((c) => re.test(String(c.title)))

  const people = ofType('people')
  const named = people.filter((c) => /owner|assign|person|responsible/i.test(String(c.title))).map((c) => c.id as string)
  const ownerCols = cfg.ownerColumns?.length ? cfg.ownerColumns : named.length ? named : people.slice(0, 1).map((c) => c.id as string)

  const statuses = ofType('status')
  const priorityCol =
    byId(cfg.priorityColumn) ?? titled(statuses, /priorit/i) ?? null
  const statusCol =
    byId(cfg.statusColumn) ??
    titled(statuses, /^status$/i) ??
    statuses.find((c) => c !== priorityCol) ??
    null

  const dates = ofType('date', 'timeline')
  const dueCol = byId(cfg.dueColumn) ?? titled(dates, /due/i) ?? ofType('date')[0] ?? ofType('timeline')[0] ?? null

  return {
    boardName: String(board.name ?? `Board ${cfg.id}`),
    ownerCols,
    statusCol: statusCol?.id ?? null,
    dueCol: dueCol?.id ?? null,
    priorityCol: priorityCol?.id ?? null,
    statusLabels: labelsOf(statusCol),
    priorityLabels: labelsOf(priorityCol),
  }
}

// ── Items → tasks ──────────────────────────────────────────────────────────

// A status or priority cell is its label, null (nothing chosen), or an object
// with only an index (a label the board has since retired).
function labelOf(cell: unknown, labels: Label[]): string {
  if (typeof cell === 'string') return cell
  if (cell && typeof cell === 'object' && typeof (cell as any).index === 'number') {
    return labels.find((l) => l.index === (cell as any).index)?.text ?? ''
  }
  return ''
}

// "2026-10-23" or "2026-10-19 - 2026-10-23": the last date is the due date.
export function dueOf(cell: unknown): string | null {
  if (typeof cell !== 'string') return null
  const all = cell.match(/\d{4}-\d{2}-\d{2}/g)
  return all ? all[all.length - 1]! : null
}

export function toTasks(items: any[], layout: Layout): Task[] {
  return items.map((it) => {
    const cv = it?.column_values ?? {}
    const status = layout.statusCol ? labelOf(cv[layout.statusCol], layout.statusLabels) : ''
    const prio = layout.priorityCol ? labelOf(cv[layout.priorityCol], layout.priorityLabels) : ''
    const flagged = layout.statusLabels.find((l) => l.text === status)?.isDone === true
    const owners = layout.ownerCols
      .flatMap((c) => (typeof cv[c] === 'string' ? (cv[c] as string).split(',') : []))
      .map((s) => s.trim())
      .filter(Boolean)
    const prioLabel = layout.priorityLabels.find((l) => l.text === prio)
    return {
      id: String(it?.id ?? ''),
      title: String(it?.name ?? ''),
      url: String(it?.url ?? ''),
      board: layout.boardName,
      status,
      due: layout.dueCol ? dueOf(cv[layout.dueCol]) : null,
      priority: prio,
      priorityRank: prioLabel ? prioLabel.index : 99,
      owners,
      isDone: flagged || status.toLowerCase() === 'done',
    }
  })
}

export function openTasksOf(tasks: Task[], userName: string, ignore: string[]): Task[] {
  const me = userName.trim().toLowerCase()
  const skip = new Set(ignore.map((s) => s.toLowerCase()))
  return tasks.filter(
    (t) => !t.isDone && !skip.has(t.status.toLowerCase()) && t.owners.some((o) => o.toLowerCase() === me),
  )
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.due !== b.due) return a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1
    if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank
    return a.title.localeCompare(b.title)
  })
}

// ── The fetch ──────────────────────────────────────────────────────────────

export async function fetchOpenTasks(call: McpCall, cfg: MondayConfig, now: number): Promise<Snapshot> {
  const errors: string[] = []
  let userName = cfg.userName
  if (!userName) {
    try {
      userName = String(resultJson(await call('get_user_context', {}))?.user?.name ?? '').trim()
    } catch (err) {
      errors.push('could not ask Monday who you are: ' + String((err as Error).message))
    }
    if (!userName && errors.length === 0) errors.push('Monday did not say who you are; set "userName" in the config')
  }
  const tasks: Task[] = []
  if (userName) {
    for (const b of cfg.boards) {
      try {
        const layout = layoutFor(resultJson(await call('get_board_info', { boardId: b.id, filters: { columns: { only: true } } })), b)
        const columnIds = [...layout.ownerCols, layout.statusCol, layout.dueCol, layout.priorityCol].filter(
          (c, i, all): c is string => !!c && all.indexOf(c) === i,
        )
        let cursor: string | null = null
        for (let page = 0; page < MAX_PAGES; page++) {
          const args: Record<string, unknown> = {
            boardId: b.id,
            includeColumns: true,
            columnIds,
            includeGroup: false,
            limit: PAGE_SIZE,
          }
          if (cursor) args.cursor = cursor
          const data = resultJson(await call('get_board_items_page', args))
          tasks.push(...toTasks(Array.isArray(data?.items) ? data.items : [], layout))
          cursor = data?.pagination?.has_more ? data?.pagination?.nextCursor ?? null : null
          if (!cursor) break
          if (page === MAX_PAGES - 1) errors.push(`${layout.boardName}: stopped after ${MAX_PAGES * PAGE_SIZE} items`)
        }
      } catch (err) {
        errors.push(`board ${b.id}: ${(err as Error).message}`)
      }
    }
  }
  return { fetchedAt: now, userName, tasks: sortTasks(openTasksOf(tasks, userName, cfg.ignoreStatuses)), errors }
}

// ── Showing it ─────────────────────────────────────────────────────────────

export function isoToday(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export function bucketOf(t: Task, today: string, weekEnd: string): 'Overdue' | 'This week' | 'Later' | 'No date' {
  if (t.due === null) return 'No date'
  if (t.due < today) return 'Overdue'
  return t.due <= weekEnd ? 'This week' : 'Later'
}
