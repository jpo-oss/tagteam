# AGENTS.md

tagteam is a Claude Code plugin plus a POSIX `sh` launcher that tracks usage across one person's own Claude accounts and restarts terminal sessions on another account near a limit.

## Commands

Run all of them before calling a change done. CI runs everything except `tsc`.

```sh
claude plugin validate . --strict
claude plugin test .
npx -p typescript@latest tsc -p .
shellcheck -s sh bin/tagteam test/launcher.test.sh test/fake-claude
sh test/launcher.test.sh
TEST_SH=dash sh test/launcher.test.sh
```

`tsc` is local only: it needs the engine types at `.claude-plugin/types/claude-code/index.d.ts` (gitignored), and Claude Code has no headless way to write them. See CONTRIBUTING.md.

## Layout

- `.claude-plugin/plugin.json`: manifest and the three settings (`autoSwitch`, `threshold`, `stallTimeoutSeconds`).
- `hooks/register.ts`: wires engine events and the `/tagteam` command to `src/`.
- `src/usage.ts`, `src/pick.ts`, `src/appstate.ts`: pure logic, no I/O.
- `src/io.ts`: the `Io` port. File, process and env access goes through it, never through `$` directly. UI, command and plugin calls use `$`.
- `src/store.ts`, `src/session.ts`, `src/folders.ts`, `src/switch.ts`, `src/commands.ts`, `src/pane.tsx`: state, tracking, account folders, switching, commands, dashboard.
- `bin/tagteam`: the launcher.
- `types/index.d.ts`: the contract for the plugin's session state (`$.state`), named in `plugin.json`.
- `test/*.test.ts(x)`: plugin tests on an in-memory `Io` (`test/support/memory.ts`). `test/launcher.test.sh` drives the launcher against `test/fake-claude`.
- `docs/`: architecture page and decision records.

## Launcher rules

- POSIX `sh` only.
- Reads plain `key=value` state files. No `jq`, no JSON.
- Passes the user's arguments through untouched. On relaunch the order is `claude --resume <session> <handover> <original args>`, or plain `claude <original args>` when the request has no session.

## Plugin rules

- ES modules with static `import` only. A module that contains `import()` does not load.
- No Node APIs. All outside access goes through `$`, and file, process and env calls go through `Io` on top of it.
- Pass `$` only to function declarations in other files, not arrow functions. `$.env.get` takes literal names, so add new ones to `EnvName` in `src/io.ts`.
- `$.fs` has no rename, mkdir or remove. Use `$.process.run` with `mv`, `mkdir`, `rm`.
- `$.process` is CLI only. Callers must give a clear message on other surfaces.
- Writes to shared state are atomic: write `<file>.tmp-<random>`, then `mv` over the target.
- Hooks on observed events always return `next(e)`, and a tracking failure never breaks the session.

## Gotchas

- Never read, copy, store or move login tokens, `.credentials.json` contents or keychain entries. Sign-in only happens through `claude auth login` with `CLAUDE_CONFIG_DIR` set.
- Never write `~/.claude.json` or anything inside `~/.claude`. Reading is fine.
- Never call `$.command.run` inside a `command.run` hook; the engine refuses it. Schedule it with `$.clock.after`.
- Switches are written at turn end, not mid-turn, so the launcher's stall timer can't cut a turn short.
- Tests use temp dirs or memory. Never point a test at a real home folder.

## Don'ts

- Don't hand edit the version in `plugin.json` or `marketplace.json`, or `CHANGELOG.md`. Release tooling owns them.
- Don't name anything starting with `claude-`.

## Commits and PRs

- GitHub flow. Branch off `main`, PR into `main`, squash merge.
- Conventional Commits for commits and PR titles. Short subject, body only when the why isn't obvious.
- No AI attribution: no `Co-Authored-By` trailers, no "Generated with" lines.

## Prose

- Keep every `.md`, commit message and comment short and plain.
- No emoji. No em or en dashes.
- Comment only what the code can't say.
