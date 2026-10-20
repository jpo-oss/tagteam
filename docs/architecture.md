# Architecture

tagteam has three parts: account folders, a plugin loaded in every session, and a launcher that runs Claude in the terminal.

## Account folders

Each account is a Claude Code config folder at `~/.claude-accounts/<label>/`, signed in with `claude auth login` and `CLAUDE_CONFIG_DIR` pointing at it. The login you already use gets its own folder too, so every account has the same shape and `~/.claude.json` is never written.

Every top-level entry in `~/.claude` is symlinked into each folder, so settings, plugins, history and `/resume` are shared. `.credentials.json`, `.claude.json`, `backups/` and lock files are not. A new folder's `.claude.json` is seeded from `~/.claude.json` without login or account keys, which skips Claude's first-run screens. Before a switch, the plugin copies the working folder's trust entry into the target so the reopened session doesn't stop on the trust prompt.

Accounts are identified by `oauthAccount.accountUuid`, so readings from a plain `claude` session still land on the right account.

## Plugin

- Records the usage windows from `session.measure` and token counts from `turn.complete` per account, and spots windows that reset early.
- At the threshold, picks the eligible account with the lowest usage (ties go to the order you set). With auto switch off, it asks once per limit window across all sessions.
- Writes the switch at turn end: the new active account, a switch request for the launcher, then a scheduled `exit`.
- Provides the `/tagteam` commands, the dashboard pane and a status line entry.

Sessions outside the launcher (desktop app, IDE, plain `claude`) get tracking and warnings only.

## Launcher

`bin/tagteam` starts `claude` in the active account's folder and stays behind it. When Claude exits, it reads the session's switch request. With none, it exits with Claude's code. With one, it runs `claude --resume <session> <handover> <original args>` in the target folder. The handover tells Claude why it moved and to check interrupted subagents and background work.

If Claude hasn't exited within the stall timeout after a request (for example on the limit menu), the launcher sends SIGTERM, then SIGKILL 10 seconds later. When every account is limited, the request carries a resume time and the launcher sleeps until then.

## State

Shared state lives in `~/.claude-accounts/state/` (or `$TAGTEAM_HOME/state/`): account records and usage as one JSON file each, the active account, snoozes, question claims, and one plain `key=value` switch file per launcher run. Every write goes to a temp file and is moved into place.
