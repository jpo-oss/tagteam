# 1. No token handling

## Context

Switching accounts could be done by swapping login tokens in and out of one config folder. Claude Code already supports one config folder per account through `CLAUDE_CONFIG_DIR`, and it keeps and refreshes each folder's tokens itself.

## Decision

tagteam never reads, copies, stores or moves login tokens, `.credentials.json` contents or keychain entries. Each account signs in with `claude auth login` into its own folder. tagteam only chooses which folder a session starts in.

## Consequences

- Each account, including the one you already use, needs one sign-in at setup.
- tagteam reads `~/.claude.json` and `~/.claude` but never writes them.
- A login that expires while idle can't be refreshed by tagteam. The account would need signing in again.
