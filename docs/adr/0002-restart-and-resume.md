# 2. Restart and resume instead of hot swap

## Context

A running Claude Code session can't change its login. It reads its config folder at start. Claude can resume a conversation from another config folder with `--resume`, appending to the same transcript.

## Decision

To switch, the plugin writes a switch request at the end of the current turn and closes the session. The launcher starts Claude again in the target folder with `--resume <session>` and a handover message as the first prompt.

## Consequences

- The conversation carries over. Running subagents and background commands do not, so the handover asks Claude to check and resume them.
- A step in flight at the cut may be redone, and background commands run again.
- Switching needs the launcher, so it only works in the terminal.
- Waiting for turn end delays a switch by up to one turn. If Claude is stuck on the limit menu, the launcher's stall timeout closes it.
