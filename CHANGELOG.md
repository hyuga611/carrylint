# Changelog

## 0.2.4

- **`npm i -g` や `npx` で入れた CLI が、何もせずに終了していた。** 入口判定が `process.argv[1]` を
  そのまま `import.meta.url` と比べていた。この2つはシンボリックリンク越しに呼ばれると一致しない
  （`argv[1]` はリンク、`import.meta.url` は解決済みの実パス）ので、install した版は本体を一度も
  実行しないまま exit 0 で終わっていた。リンタにとってこれは最悪の壊れ方で、「問題を見つけなかった」
  と「一度も動いていない」が区別できない。終了コードを読む CI からも同じに見えるので、これを CI に
  入れていた人は、何も守られていない状態で緑を見ていたことになる。公開物を clean なコンテナに
  `npm i -g` して測った結果は、修正前が出力0バイト、修正後は出力あり。
- リンクを解決してから比較するようにし、`test/entrypoint.test.mjs` を追加した。既存のテストは
  すべて関数を import して確かめており、bin を一度も実行していなかったので何も気づけなかった。
  この修正を戻すと、このテストは落ちる（確認済み）。

## 0.2.3

- **The examples no longer carry a real Windows account name.** The fixtures that demonstrate
  the `abs-path` rule used the maintainer's own home directory, and one of them lives in `src/`,
  so it shipped in the package. It is not a credential, but a generic name demonstrates the rule
  exactly as well. The rule itself is unchanged and still fires on the example.
- Releases are now made by pushing a tag: the workflow runs the tests on Node 20, 22 and 24,
  refuses to publish if the tag and `package.json` disagree, and publishes with
  [provenance](https://docs.npmjs.com/generating-provenance-statements) using npm trusted
  publishing, so no long-lived token is stored anywhere.

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
