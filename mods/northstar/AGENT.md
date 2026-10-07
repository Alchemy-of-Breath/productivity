# North Star — setup guide for the agent

You are setting up the **northstar** mod for the person you are working with. The mod draws
their North Star (their purpose, their organisation's purpose, and their focus for the week,
month, quarter, year and five years) above the prompt in every Claude Code session.

The mod reads one file. **Your job is to interview the person and write that file.** You
never edit the plugin's code to personalise it.

## 1. Check the starting state

1. Run `/northstar status` (or ask the person to). It prints the config path and whether
   the mod is on. The default path is `~/.claude/northstar/northstar.json`; the environment
   variable `NORTHSTAR_CONFIG` overrides it.
2. If the person would rather edit it themselves, `/northstar init` writes a starter file
   with placeholder lines (it never overwrites an existing file).
3. If the file already exists, read it and treat this as an **update**: change only what
   the person asks to change, and keep the rest.
4. If `/northstar` is not a known command, the plugin is not installed or not enabled. See
   *Install* in `README.md` before going further.

## 2. Interview the person

Ask **one question at a time**, in plain language. Offer a draft answer they can accept or
correct whenever you have enough context (from the conversation, their CLAUDE.md, or memory),
because most people find it easier to edit a draft than to write from scratch. Keep every
answer short: each one has to fit on one line, under about 70 characters.

| Field | Ask | Good answer looks like |
|---|---|---|
| `you.purpose` | "In one line, what are you personally here to do? Your massive transformative purpose, not your job title." | "Help small teams ship calm, well-built software" |
| `org.name`, `org.label` | "What's the organisation, team or project you give most of your work to? What short tag (2–5 letters) should label it?" | "Acme Studio", "ACME" |
| `org.purpose` | "What is that organisation's purpose, in one line?" | "Make reliable software affordable for every small business" |
| `five_year.goal`, `.metric` | "Five years out, what does success look like? Is there a number that proves it?" | "The default studio for EU small businesses", "1,000 clients" |
| `year.goal`, `.metric` | "And this year: the one outcome that matters most, and its number?" | "Self-serve plan pays for the team", "€40k MRR" |
| `focus.quarter` | "This quarter's focus?" | "Launch the self-serve plan" |
| `focus.month` | "This month's?" | "Close 3 retainer clients" |
| `focus.week` | "This week's?" | "Ship the onboarding redesign" |
| `alignment_note` | "Why does your personal purpose fit the organisation's? One line." | "Calm, well-built software is exactly what Acme sells" |

Rules:
- Work from the long horizon to the short one (5 years → week), so each answer can
  ladder up to the one before it. If the week's focus does not serve the quarter, say so
  gently and ask whether that's intended.
- Any field can be left out. A missing row simply isn't drawn. The WEEK, MONTH and QTR rows
  always show, with a hint, so the person is reminded to set them.
- Never invent goals or numbers. Drafts are suggestions the person must confirm.
- If someone has no organisation (a freelancer, a student), use their main project or
  leave `org` out entirely.

## 3. Write the file

Create the parent directory if needed and write valid JSON (UTF-8, 2-space indent). The full
shape, with every field optional:

```json
{
  "title": "NORTH STAR",
  "you": { "label": "YOU", "purpose": "..." },
  "org": { "label": "ACME", "name": "Acme Studio", "purpose": "..." },
  "focus": { "week": "...", "month": "...", "quarter": "..." },
  "year": { "goal": "...", "metric": "..." },
  "five_year": { "goal": "...", "metric": "..." },
  "alignment_note": "...",
  "live": { "label": "MRR", "file": "~/.cache/northstar-live.json" },
  "placement": { "terminal": "band" }
}
```

- `label` values are cut to 6 characters on screen.
- `live` is optional: see section 5. Leave it out unless the person asks for a live number.
- `placement.terminal` is `"band"` (default, above the prompt) or `"footer"` (the prompt footer,
  for terminal users whose statusline leaves an empty right-hand column). With `"footer"` you can
  set `"footer_offset"` (default 84): the number of columns the statusline takes on the left.
  The desktop app always uses the band.

`examples/northstar.example.json` is a complete fictional file, and
`examples/northstar.malik.json` is a real one, shown with permission.

After writing, validate it (for example `python3 -m json.tool <path>`). Then run `/northstar`
and show the person the result.

## 4. Day-to-day commands (tell the person about these)

- `/northstar`: print the block.
- `/northstar init`: write a starter file (only when none exists).
- `/northstar focus week|month|quarter <text>`: set one focus. No text clears it.
- `/northstar stop`: hide it in **every** session from now on (the choice persists).
- `/northstar start`: show it again.
- `/northstar status`: on/off state and file paths.

For the year, five-year and purpose fields, edit the JSON (or ask you, the agent, to). The mod
re-reads the file every minute, so edits show up without a restart.

## 5. Optional: a live row

`live.file` points to a small JSON file that anything can write (a cron job, a script, another
agent):

```json
{ "text": "€31.2k MRR · 78% of goal", "at": "2026-10-07T14:00:00Z", "status": "ok" }
```

- `text`: one line.
- `at`: ISO time it was written. The mod shows its age and turns it yellow after an hour and red
  after a day.
- `status`: `ok` (green), `warn` (yellow) or `bad` (red).

The mod only reads this file. Producing the number is up to the person's own tooling. If they
want one, help them write a small script that outputs this shape and a schedule that runs it.

## 6. Troubleshooting

- **Nothing above the prompt.** Run `/northstar status`. "off" means run `/northstar start`.
  A config "not found" means write the file. "not valid JSON" means fix it.
- **The command works but the band doesn't show after `/reload-plugins`.** Start a new session.
  The desktop app sometimes stops asking a reloaded plugin to draw the band. A fresh session
  always works.
- **It shows twice in the terminal.** Another statusline or plugin may also draw it. Set
  `placement.terminal` to whichever one the person wants.
