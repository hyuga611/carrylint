# Changelog

## 0.1.1

Precision hardening, driven by a real-world audit of **230 public `SKILL.md` / `AGENTS.md`
files** (160 tuning + 70 hold-out). v0.1.0 raised ~85% false positives on real skills;
v0.1.1 drives the `error` false-positive rate to ~0 while keeping every genuine bug.

- **abs-path**: `$HOME` / `${HOME}` / `~` / `%USERPROFILE%` are portable (resolve per-user) →
  no longer flagged. Only absolute paths with a real username (`/Users/<name>/`, `/home/<name>/`,
  `C:\Users\<name>\`) are errors; generic names (`/home/user`, `/home/ubuntu`, `/home/*/`) are excluded.
- **placeholder**: `YOUR_API_KEY`, `/path/to/…`, `<your-x>` are legitimate "replace at runtime"
  documentation conventions → removed from `error`. Only unfinished markers remain
  (`<FILL_ME>`, `REPLACE_ME`, `CHANGEME`, `<INSERT …>`).
- **undeclared-cli**: host setup/inspection subcommands (`claude mcp add`, `codex mcp add`,
  `claude --version`, `… login`) are excluded — the host runtime isn't a dependency to declare.
  Demoted from `error` to `warn` (advisory; no longer fails the PR).
- **home-path**: rule removed — `~/…` is portable.
- Added `test/realworld.test.mjs`: regression tests distilled from the audit (5 genuine bugs that
  must stay caught, 11 real-world patterns that must stay silent).

## 0.1.0

Initial release. Runtime-portability linter for agent skills & commands: fail CI when a
`SKILL.md` / `AGENTS.md` / slash-command hardcodes machine- or model-specific assumptions.
Zero-dependency, model-agnostic, no LLM at runtime. Rules: abs-path, placeholder,
undeclared-cli, home-path, provider-env, todo, model-id (opt-in). Composite GitHub Action,
`--format json`, `--allow`, `--strict`, `<!-- carry-ignore -->`.
