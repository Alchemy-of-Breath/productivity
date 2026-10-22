# Kanban

A Claude Code mod that keeps your open Monday.com tasks in a pane beside the chat.

`/kanban` opens (and closes) the pane. The **MONDAY** view lists the tasks assigned to you that are
not done, grouped Overdue / This week / Later / No date, with status, due date and priority. Click a
task for its board and link. It never writes to Monday.

If you also keep a personal board in `~/.claude/kanban/board.json` (driven by `board.py`), the
**DAY** and **WEEK** views and their buttons show up as well. If you do not, they are hidden and the
pane is just your Monday tasks.

## Install

The repo is a plugin marketplace. In Claude Code:

```
/plugin marketplace add Alchemy-of-Breath/productivity
/plugin install kanban@aob-productivity
/plugin install northstar@aob-productivity
```

(`northstar` is the other mod in this repo; install only the ones you want.) Then start a new
session, or run `/reload-plugins`.

From a shell: `claude plugin marketplace add Alchemy-of-Breath/productivity` and
`claude plugin install kanban@aob-productivity`.

## Set up Monday (about 3 minutes)

You need the **Monday connector** turned on in your own Claude account (Settings, Connectors). The
mod uses that connection, so it sees exactly what you see in Monday. There is no token to paste and
nothing to share between people.

1. Run `/kanban init`. It writes `~/.claude/kanban/monday.json` with a placeholder.
2. Open the file and replace `REPLACE_WITH_BOARD_ID` with the number in your board's address
   (`monday.com/boards/<number>`). Add more boards to the list if your tasks live in several.
3. Run `/kanban refresh`, then `/kanban`.

`examples/monday.example.json` shows every option:

| Key | Meaning | Default |
|---|---|---|
| `boards` | Boards to read. Each is `{ "id": <number> }`, optionally with `ownerColumns`, `statusColumn`, `dueColumn`, `priorityColumn` (column ids) if auto-detection picks the wrong column. | required |
| `userName` | Your name exactly as Monday shows it in a people column. | asked of Monday |
| `refreshMinutes` | How often the open pane re-fetches. | `10` |
| `ignoreStatuses` | Status labels to treat as not-open, such as `["INFO ONLY"]`. | none |
| `server` | The Monday connector's name, if yours is called something else. | `claude_ai_monday_com` |

How a task counts as yours and open: your name appears in the board's Owner column (several
people can share a task), and its status is not a label the board marks as done, not the label
"Done", and not in `ignoreStatuses`. Columns are found by type and title (Owner, Status, Priority,
Due date or Timeline). Sub-items are not read.

## Commands

| Command | Does |
|---|---|
| `/kanban` | Open or close the pane |
| `/kanban monday` · `day` · `week` | Open on a view |
| `/kanban refresh` | Re-fetch from Monday now and print a one-line summary |
| `/kanban status` | Where the config is, whether a personal board exists, last fetch |
| `/kanban init` | Write the starter config (never overwrites) |

## How it works

The mod calls the Monday connector itself (`get_user_context`, `get_board_info`,
`get_board_items_page`: all read-only) when you open the pane and then every `refreshMinutes`. The
last result is kept in the mod's own store so the pane shows something immediately next time. If
Monday fails, the pane says why and keeps showing the last good result.

Nothing personal lives in this repo: no names, ids, emails or tokens. Everyone gets the same code
and their own `monday.json`. To keep the config elsewhere, set `KANBAN_MONDAY_CONFIG` to its path.

## Troubleshooting

- **"Monday is not set up yet"**: no `~/.claude/kanban/monday.json`. Run `/kanban init`.
- **"is not a number"**: the board id is still the placeholder.
- **A refusal that mentions a permission or classifier**: your session's permission mode would not
  let the mod call the Monday connector. Run `/kanban refresh` from a normal interactive session.
- **Nothing open but you expect tasks**: your name in `userName` (or in Monday) differs from the
  Owner column's display name. Run `/kanban status`, then set `userName` to the exact text.
- **Wrong column used for due date or status**: set `dueColumn` / `statusColumn` for that board.

## Development

```
claude plugin validate mods/kanban
claude plugin test mods/kanban
```

Tests use invented boards and people only.
