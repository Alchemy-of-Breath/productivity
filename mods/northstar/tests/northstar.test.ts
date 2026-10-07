import { expect, mock, test } from 'claude-code/testing'

const CONFIG = '/home/ana/.claude/northstar/northstar.json'
const LIVE = '/home/ana/.cache/northstar-live.json'

const STAR = {
  you: { purpose: 'Help small teams ship calm software' },
  org: { label: 'ACME', name: 'Acme Studio', purpose: 'Make reliable software affordable' },
  focus: { week: 'Ship onboarding', month: '', quarter: 'Launch self-serve' },
  year: { goal: 'Self-serve pays for the team', metric: '€40k MRR' },
  five_year: { goal: 'Default EU studio' },
  alignment_note: 'Calm software is what Acme sells',
  live: { label: 'MRR', file: '~/.cache/northstar-live.json' },
}

// Answers file reads from fixtures (a missing path throws, as the engine does)
// and records writes.
function stub(
  on: any,
  files: Record<string, string>,
  store: Record<string, unknown> = {},
  env: Record<string, string> = { HOME: '/home/ana' },
) {
  const writes: { path: string; text: string }[] = []
  const reads: string[] = []
  mock.clock(on)
  mock.store(on, store)
  mock.env(on, env)
  on('fs.read', ($: unknown, e: { path: string }) => {
    reads.push(e.path)
    if (!(e.path in files)) throw new Error('ENOENT: ' + e.path)
    return { value: files[e.path] }
  })
  on('fs.exists', ($: unknown, e: { path: string }) => ({ value: e.path in files }))
  on('fs.write', ($: unknown, e: { path: string; text: string }) => {
    writes.push(e)
    files[e.path] = e.text
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  return Object.assign(writes, { reads })
}

const files = () => ({
  [CONFIG]: JSON.stringify(STAR),
  [LIVE]: JSON.stringify({ text: '€31.2k', at: new Date().toISOString(), status: 'ok' }),
})

function band(surface: 'terminal' | 'desktop') {
  return {
    plugin: 'northstar',
    component: 'AbovePrompt',
    surface,
    viewport: { columns: 120, rows: 40 },
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 115, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  } as any
}

const run = ($: any, args: string) => $.command.run({ command: 'northstar', args, origin: { kind: 'composer' } } as any)

test('desktop: the band shows purposes, focus, goals and the live row', async ($, on) => {
  stub(on, files())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount(band('desktop'))

  for (const text of ['🔭 NORTH STAR', 'YOU   ', 'ACME  ', 'WEEK  ', 'MONTH ', 'QTR   ', '1YR   ', '5YR   ', 'ALIGN ', 'MRR   ']) {
    expect(await ui.find({ type: 'Text', text })).toBeDefined()
  }
  expect(await ui.find({ type: 'Text', text: 'Ship onboarding' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' /northstar focus month' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '€31.2k' })).toBeDefined()
})

test('terminal: the band by default, nothing in the footer', async ($, on) => {
  stub(on, files())
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: '🔭 NORTH STAR' })).toBeDefined()
})

test('terminal: placement footer moves it out of the band', async ($, on) => {
  stub(on, { ...files(), [CONFIG]: JSON.stringify({ ...STAR, placement: { terminal: 'footer' } }) })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: '🔭 NORTH STAR' })).toBeUndefined()
})

test('no config: nothing drawn, and /northstar says how to set it up', async ($, on) => {
  stub(on, {})
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: '🔭 NORTH STAR' })).toBeUndefined()
  const { text } = await run($, '')
  expect(text).toContain(CONFIG)
  expect(text).toContain('AGENT.md')
})

test('/northstar stop hides it and persists; /northstar start brings it back', async ($, on) => {
  const store: Record<string, unknown> = {}
  stub(on, files(), store)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  expect((await run($, 'stop')).text).toContain('off in every session')
  let ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: '🔭 NORTH STAR' })).toBeUndefined()

  await run($, 'start')
  ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: '🔭 NORTH STAR' })).toBeDefined()
})

test('a stored stop is honoured by the next session', async ($, on) => {
  stub(on, files(), { enabled: false })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: '🔭 NORTH STAR' })).toBeUndefined()
})

test('after a hot reload with no session.start, the first render restarts it', async ($, on) => {
  stub(on, files())
  await $.ui.mount(band('desktop'))
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: '🔭 NORTH STAR' })).toBeDefined()
})

test('/northstar focus month <text> writes only that field', async ($, on) => {
  const writes = stub(on, files())
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  const { text } = await run($, 'focus monthly Close 3 retainers')

  expect(text).toContain('month focus set to "Close 3 retainers"')
  expect(writes.length).toBe(1)
  expect(writes[0]!.path).toBe(CONFIG)
  const saved = JSON.parse(writes[0]!.text)
  expect(saved.focus).toEqual({ week: 'Ship onboarding', month: 'Close 3 retainers', quarter: 'Launch self-serve' })
  expect(saved.year).toEqual(STAR.year)
})

test('/northstar prints the block as text', async ($, on) => {
  stub(on, files())
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const { text } = await run($, '')
  expect(text).toContain('🔭 NORTH STAR')
  expect(text).toContain('ACME   Make reliable software affordable')
  expect(text).toContain('1YR    Self-serve pays for the team (€40k MRR)')
  expect(text).toContain('MRR    €31.2k')
})

test('/northstar init writes a placeholder file, then the band shows it', async ($, on) => {
  const writes = stub(on, {})
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  const { text } = await run($, 'init')

  expect(text).toContain('wrote a starter file to ' + CONFIG)
  expect(writes.length).toBe(1)
  expect(writes[0]!.path).toBe(CONFIG)
  const saved = JSON.parse(writes[0]!.text)
  expect(saved.you.purpose).toBe('Your purpose, in one line')
  expect(saved.live).toBeUndefined()
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: '🔭 NORTH STAR' })).toBeDefined()
})

test('/northstar init never overwrites an existing file, even an invalid one', async ($, on) => {
  const writes = stub(on, { [CONFIG]: '{ not json' })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  expect((await run($, 'init')).text).toContain('already exists')
  expect(writes.length).toBe(0)
})

test('no config: /northstar points at /northstar init', async ($, on) => {
  stub(on, {})
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect((await run($, '')).text).toContain('/northstar init')
})

test('paths follow each person\'s HOME (no machine-specific paths)', async ($, on) => {
  const config = '/Users/sam/.claude/northstar/northstar.json'
  stub(on, { [config]: JSON.stringify(STAR) }, {}, { HOME: '/Users/sam' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect((await run($, 'status')).text).toContain('config  ' + config)
  expect((await run($, 'status')).text).toContain('live    /Users/sam/.cache/northstar-live.json')
})

test('NORTHSTAR_CONFIG points at another file', async ($, on) => {
  stub(on, { '/srv/team/sam.json': JSON.stringify(STAR) }, {}, { HOME: '/Users/sam', NORTHSTAR_CONFIG: '/srv/team/sam.json' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect((await run($, '')).text).toContain('ACME   Make reliable software affordable')
})

test('the live row is off unless the file asks for one: no live file is read', async ($, on) => {
  const { live: _, ...noLive } = STAR
  const writes = stub(on, { [CONFIG]: JSON.stringify(noLive), [LIVE]: JSON.stringify({ text: '€31.2k' }) })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: '€31.2k' })).toBeUndefined()
  expect(writes.reads).not.toContain(LIVE)
})
