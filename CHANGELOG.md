# Changelog

## 0.2.2

- **An uppercase word template in the user segment of an absolute path is no longer reported as
  an author path.** `/home/YOUR_USER/.cloudflared/…`, `/Users/USERNAME/…` and `/Users/MY_NAME/…`
  are the same "replace this" documentation convention v0.1.1 already accepted for
  `YOUR_API_KEY` and `/path/to/`, but they were still reported as machine-specific paths.
  Only underscore-separated uppercase words and a small known set (`USERNAME`, `YOURNAME`, …)
  are excused — a bare uppercase segment is deliberately *not* enough, because `/Users/CS/` is
  a real author's initials, confirmed genuine in the 2026-07 audit. Both directions are pinned
  in `test/realworld.test.mjs`. Found auditing the ClawHub registry, 2026-08.

## 0.2.1

- **Added `main` / `exports` so the package can be imported as a library.** With neither field
  present, `import { scan } from '@hyuga/carrylint'` did not resolve: the rules were reachable
  only by spawning the CLI, even though `src/check.mjs` had exported `scan`, `findFiles`,
  `toJson` and `main` all along. The CLI, its flags and its output are unchanged. `./rules.json`
  is exported as well, so a consumer can read the shipped rule set without reaching into the
  package layout.

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
