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
function stub(on: any, files: Record<string, string>, store: Record<string, unknown> = {}) {
  const writes: { path: string; text: string }[] = []
  mock.clock(on)
  mock.store(on, store)
  mock.env(on, { HOME: '/home/ana' })
  on('fs.read', ($: unknown, e: { path: string }) => {
    if (!(e.path in files)) throw new Error('ENOENT: ' + e.path)
    return { value: files[e.path] }
  })
  on('fs.write', ($: unknown, e: { path: string; text: string }) => {
    writes.push(e)
    files[e.path] = e.text
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  return writes
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
