# 3. POSIX sh launcher

## Context

Something has to stay alive behind Claude to restart it on another account. It has to run on a stock macOS or Linux machine, inside tmux or a plain terminal, with nothing extra installed.

## Decision

The launcher is a single POSIX `sh` script, checked with `shellcheck -s sh`. It reads only plain `key=value` files and never parses JSON, so it needs no `jq`. The plugin does all JSON work.

## Consequences

- No runtime to install, and `/tagteam install` just copies one file to `~/.local/bin`.
- The switch request format stays flat text.
- Process handling (finding the Claude child, SIGTERM then SIGKILL) is done with `ps`, `pgrep` and `kill`, which limits how much logic belongs in the launcher.
