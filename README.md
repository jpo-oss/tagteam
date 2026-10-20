# tagteam

tagteam tracks usage across your own Claude subscription accounts and shows it in a dashboard inside Claude Code. When the account you're on gets close to its limit, it can close your terminal sessions and reopen them on another account with the conversation intact.

tagteam never reads or stores your login. Each account signs in through Anthropic's own page, and Claude Code keeps the login in that account's folder.

Use of Claude is subject to Anthropic's [Usage Policy](https://www.anthropic.com/legal/aup).

## Install

1. In a Claude Code session, install the plugin:

   ```
   /plugin install tagteam --marketplace jpo-oss/tagteam
   ```

2. Load the plugin with `/reload-plugins` (or start a new session), then install the launcher. This step is required: it copies the `tagteam` command to `~/.local/bin`.

   ```
   /tagteam install
   ```

3. If it says `~/.local/bin` is not on your `PATH`, add this to your shell profile and open a new terminal. Then start sessions with `tagteam` instead of `claude`.

   ```sh
   export PATH="$HOME/.local/bin:$PATH"
   ```

On a machine you reach over SSH, where a browser can't open, add accounts with `tagteam add <label>` in a terminal instead (see below).

Claude Code doesn't auto-update plugins from third-party marketplaces like this one by default. To update, run `claude plugin update tagteam@tagteam`, or turn on auto-update in `/plugin` under **Marketplaces**, **tagteam**, **Enable auto-update**. The launcher picks up the new version at your next session start. tagteam also shows a notice when a new version is out.

## Usage

1. Add each account with a short label. Add the login you already use too, since every account gets its own folder:

   ```
   /tagteam add work
   /tagteam add personal
   ```

   Your browser opens Anthropic's sign-in page. It signs in whichever claude.ai account the browser has open, so switch there first if needed. tagteam shows the email it got so you can check.

2. Quit Claude and start it again with `tagteam` instead of `claude`. Arguments pass straight through, and it runs fine inside tmux:

   ```sh
   tagteam
   ```

3. Open the dashboard to see every account's usage:

   ```
   /tagteam status
   ```

   ![The tagteam dashboard beside a chat: one bordered card per account with 5-hour and weekly usage bars, reset times and tokens, the account this session uses highlighted](docs/images/dashboard.png)

4. When the account you're on reaches the threshold, tagteam asks whether to switch. Say yes and the session closes and reopens on the account with the most room. With auto switch on, it switches without asking and tells you.

   ![The question asking whether to switch from work, at 100% of its 7-day limit, to personal at 43%](docs/images/switch.png)

Other commands:

| Command | What it does |
|---|---|
| `/tagteam` or `/tagteam status` | Opens the dashboard: each account's usage windows, reset times, input/output tokens and the auto switch setting. It updates live. |
| `/tagteam switch <label>` | Moves this session to that account now; other `tagteam` sessions follow at the end of their turn |
| `/tagteam edit <label> name=<new> order=<n> exclude=true\|false` | Renames, reorders, or takes an account out of rotation |
| `/tagteam refresh` | Sends a one-line prompt from each account so the dashboard shows its current usage. New accounts get this on their own. |
| `/tagteam remove <label>` (or `delete`) | Signs the account out and deletes its folder. You can't remove an account a running tagteam session is using. |

You can also manage accounts from a terminal, outside Claude. This is the way to add one on a remote machine: it prints the sign-in link, and you can open it on any device and paste the code back.

| Command | What it does |
|---|---|
| `tagteam add <label>` | Signs a new account in. Claude picks it up, with its usage, at the next session start. |
| `tagteam remove <label>` (or `delete`) | Asks first, then signs the account out and deletes its folder |
| `tagteam list` | Lists the accounts, marking the active one |
| `tagteam refresh` | Same as `/tagteam refresh`, then lists the accounts |

Only `add`, `remove`, `delete`, `list` and `refresh` as the first word are tagteam's. Anything else goes to Claude, and `tagteam -- add` sends `add` to Claude as a prompt.

If an account's login lapses, sign it in again with `/tagteam remove <label>` and then `/tagteam add <label>`. Switch away from it first if a running session uses it.

Settings live in `/plugin configure tagteam`:

| Setting | Default | Meaning |
|---|---|---|
| `autoSwitch` | `false` | Switch without asking. When off, one session asks and the rest wait for that answer. No means it won't ask again until that limit window resets. |
| `threshold` | `95` | Usage percentage (50 to 100) that triggers a switch |

Advanced: set `TAGTEAM_STALL` (seconds, default 30) to change how long the launcher waits for Claude to close itself before closing it.

Accounts and state live in `~/.claude-accounts`, or `$TAGTEAM_HOME` if you set it. tagteam writes nothing inside `~/.claude`.

## How it works

1. Each account is a folder under `~/.claude-accounts` with links back to your shared settings and history in `~/.claude`.
2. The plugin records every account's usage windows and token counts as your sessions run.
3. When an account crosses the threshold, the plugin picks the account with the most room and writes a switch request at the end of the current turn.
4. The launcher sees the request, closes Claude (stopping it if it hangs on the limit menu), and starts it again on the new account with `--resume`. A session with no conversation yet starts fresh instead.
5. The first message after the restart tells Claude what happened and to pick up any subagents, workflows or background work that were cut off, without stopping to ask.

If every account is limited, the launcher waits until the soonest reset and resumes there. More detail in [docs/architecture.md](docs/architecture.md).

## Limitations

- Switching only works in the terminal through the `tagteam` launcher. The desktop app and IDE extensions get tracking and warnings, not switching.
- Tested on macOS. Linux should work but hasn't been tested. No Windows support.
- Unattended use needs auto switch on. With it off, the question waits for you. A dismissed or unanswered question isn't asked again until the usage reading changes, and at the hard limit you get Claude's own limit menu.
- State and logins are per machine. Each computer needs its own setup.
- Whether an idle account's login stays valid for days is still being checked.
- A step that was in flight when a session closed gets redone after the restart, and background commands are run again.
- A switch keeps the whole visible conversation, but Claude can't reuse its earlier hidden thinking from another account. Claude Code shows a notice when this happens.

## License

MIT
