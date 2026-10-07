# North Star

A Claude Code mod that keeps your North Star in view in every session: your purpose, your
organisation's purpose, and what you're pushing on this week, month, quarter, year and five years.

```
🔭 NORTH STAR
YOU    Help small teams ship calm, well-built software
ACME   Make reliable software affordable for every small business
WEEK   Ship the onboarding redesign
MONTH  Close 3 retainer clients
QTR    Launch the self-serve plan
1YR    Self-serve plan pays for the team €40k MRR
5YR    The default studio for EU small businesses 1,000 clients
ALIGN  ●○○○○ Calm, well-built software is exactly what Acme sells
MRR    €31.2k MRR · 78% of goal ↻4m
```

It's drawn in the band above the prompt in the desktop app's **Code** tab and in the terminal. It's on in every session until you run
`/northstar stop`.

## Set it up (about 5 minutes)

1. **Install** (see below).
2. **Ask your agent:**
   > Set up my North Star using the northstar plugin's AGENT.md.

   It interviews you one question at a time and writes `~/.claude/northstar/northstar.json`.
   Prefer to fill it in yourself? `/northstar init` writes a starter file with placeholder lines.
   [`AGENT.md`](AGENT.md) is written for the agent: it covers the interview, the file format, and
   troubleshooting.
3. Run `/northstar` to see the result.

Nothing personal lives in the plugin. Everyone gets the same code and their own file. Until that
file exists the mod draws nothing; it never errors.

## Install

The repo is a plugin marketplace. In Claude Code:

```
/plugin marketplace add Alchemy-of-Breath/productivity
/plugin install northstar@aob-productivity
```

Then start a new session.

## Rolling it out to a Claude for Teams organisation

Personal accounts (Pro/Max) and Teams/Enterprise run **the same plugin code**. What differs is
who installs it.

- **Personal or self-serve:** each person runs the two `/plugin` commands above.
- **Teams/Enterprise, admin-managed:** an admin adds the marketplace and turns the plugin on for
  everyone. That's under Organization settings → Claude Code → Managed settings:

  ```json
  {
    "extraKnownMarketplaces": {
      "aob-productivity": { "source": { "source": "github", "repo": "Alchemy-of-Breath/productivity" } }
    },
    "enabledPlugins": { "northstar@aob-productivity": true }
  }
  ```

  Members then get the mod with no install step. `/northstar stop` still works per person,
  because it only hides the block and doesn't uninstall anything.

Org policies that block it (check these if a teammate says it doesn't load):

| Managed setting | Effect on this mod |
|---|---|
| `allowManagedHooksOnly: true` | Only org-managed plugins' hooks run. Deploy it through managed settings as shown above. |
| `strictKnownMarketplaces` | An allowlist of marketplaces. Add `Alchemy-of-Breath/productivity` to it. |
| `disableAllHooks: true` | Turns off every hook, this mod included |

Docs: <https://code.claude.com/docs/en/plugins/org.md>,
<https://code.claude.com/docs/en/plugins/host-marketplace.md>.

## Commands

| Command | What it does |
|---|---|
| `/northstar` | Print the block |
| `/northstar init` | Write a starter config with placeholder text (never overwrites an existing one) |
| `/northstar focus week\|month\|quarter <text>` | Set one focus (no text clears it) |
| `/northstar stop` | Hide it in every session from now on |
| `/northstar start` | Show it again |
| `/northstar status` | On/off, and where the config lives |

The mod re-reads the config every minute, so edits to the file show up without a restart.

## Optional live row

Off by default: no `live` in your file means no live row and no extra file reads.
Point `live.file` at a JSON file `{ "text", "at", "status" }` that your own script or cron job
keeps up to date. A sales number, a deploy status or an email warm-up stage all work. The mod
shows the text and how old it is. See `AGENT.md` §5.

## Where it runs

| Where | Block shown | `/northstar` command |
|---|---|---|
| Terminal `claude` | ✓ | ✓ |
| Desktop app, **Code** tab | ✓ | ✓ |
| VS Code extension, cloud sessions, `claude -p` | ✗ (no plugin UI there) | ✓ |
| Regular Claude chat (claude.ai, desktop Chat tab, mobile app) | ✗ | ✗ |

Mods are a Claude Code feature. They don't run in the regular Claude chat.

## Develop

```
claude plugin test mods/northstar      # run the tests
claude plugin validate mods/northstar
```

Code: [`hooks/register.tsx`](hooks/register.tsx). Tests: [`tests/northstar.test.ts`](tests/northstar.test.ts).
