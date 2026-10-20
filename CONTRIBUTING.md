# Contributing

Bug reports and pull requests are welcome. For anything bigger than a fix, open an issue first to agree on the approach.

## Workflow

- GitHub flow: branch off `main`, open a pull request back into `main`. PRs are squash merged.
- Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/) (`fix: ...`, `feat: ...`, `docs: ...`).
- Don't edit the version in `plugin.json` or `marketplace.json`, or the changelog. The release tooling does that.

## Releases

- Release PRs are opened by release-please. They don't trigger CI on their own, so re-run the check before merging.
- `release-as` in `release-please-config.json` forces the first release to 0.1.0. Remove it after that release.

## Checks

CI runs all of these except the type check, which is local only. Run them before opening a PR:

```sh
claude plugin validate . --strict
claude plugin test .
npx -p typescript@latest tsc -p .
shellcheck -s sh bin/tagteam test/launcher.test.sh test/fake-claude
sh test/launcher.test.sh
TEST_SH=dash sh test/launcher.test.sh
```

CI can't run the type check because Claude Code has no headless way to write the types it needs. It needs Claude Code's plugin types in `.claude-plugin/types/claude-code/index.d.ts` (gitignored). If loading the plugin hasn't put them there, copy `types/claude-code.d.ts` from the `plugin-authoring` skill that ships with Claude Code.

To try your changes, start Claude Code with `claude --plugin-dir .` and point `TAGTEAM_HOME` at a scratch folder so your real accounts stay untouched.

## AI use

I use AI tools while working on tagteam. Every change is reviewed, tested and owned by a person.
