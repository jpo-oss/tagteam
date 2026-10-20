# Contributing

Bug reports and pull requests are welcome. For anything bigger than a fix, open an issue first to agree on the approach.

## Workflow

- GitHub flow: branch off `main`, open a pull request back into `main`. PRs are squash merged.
- Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/) (`fix: ...`, `feat: ...`, `docs: ...`).
- Don't edit the version in `plugin.json` or `marketplace.json`, or the changelog. The release tooling does that.

## Checks

CI runs these, and so should you before opening a PR:

```sh
claude plugin validate . --strict
claude plugin test .
npx -p typescript@latest tsc -p .
shellcheck -s sh bin/tagteam test/launcher.test.sh test/fake-claude
sh test/launcher.test.sh
```

The type check needs Claude Code's plugin types in `.claude-plugin/types/claude-code/index.d.ts` (gitignored). If loading the plugin hasn't put them there, copy `types/claude-code.d.ts` from the `plugin-authoring` skill that ships with Claude Code.

To try your changes, start Claude Code with `claude --plugin-dir .` and point `TAGTEAM_HOME` at a scratch folder so your real accounts stay untouched.

## AI use

I use AI tools while working on tagteam. Every change is reviewed, tested and owned by a person.
