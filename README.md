# carrylint

> Part of a set of zero-dependency CI tools for AI-agent repos — start with **[reflint](https://github.com/hyuga611/reflint)**.

**Your skill works on your machine. Does it work on your teammate's — or in a different agent?**
`carrylint` is a zero-dependency, model-agnostic linter that fails your PR when a `SKILL.md`, `AGENTS.md`, or slash-command has your machine or your model baked in — absolute paths, undeclared external CLIs, unresolved placeholders. It runs **no LLM and needs no API key**: pure static analysis.

**あなたのスキル、自分のマシンでは動く。でも "次の人の環境・別のエージェント" で動きますか？**
`carrylint` は、`SKILL.md` / `AGENTS.md` / スラッシュコマンドに**作った本人の環境・モデル前提が焼き込まれていないか**を CI で落とす、依存ゼロ・モデル非依存のリンタ。絶対パス・未宣言の外部CLI・未解決プレースホルダを検出します。**実行時に LLM も API キーも使いません**（純静的解析）。

---

## Why / なぜ

[Agent Skills](https://agentskills.io) became an open standard in Dec 2025 — one `SKILL.md` runs across 20+ agents (Claude Code, Codex, Gemini CLI, Cursor, Copilot …). The **format** is portable now. But the **content** still isn't: a skill that shells out to `codex` you never installed, writes to `C:\Users\you\Downloads`, or hardcodes `gpt-image-2` silently breaks the moment someone else installs it.

Other skill linters check your skill is **spec-valid**. carrylint checks it **actually runs when someone else installs it**.

> オープン標準化で "形式" は可搬になった。carrylint は "中身が実際に動くか" を見る側です。

## What it checks / 何を見るか

| kind | severity | 説明 |
|---|---|---|
| `abs-path` | **error** | 作者環境前提の絶対パス（`C:\Users\…` / `/Users/<実名>/` / `/home/<実名>/`）。`$HOME` / `~` / `%USERPROFILE%` と汎用名（`/home/user` 等）は可搬なので**対象外** |
| `placeholder` | **error** | 配布物に残った未完成マーカー（`<FILL_ME>` / `REPLACE_ME` / `CHANGEME` / `<INSERT …>`）。`YOUR_API_KEY` / `/path/to/` は「置き換えてね」の正当な文書慣習なので**対象外** |
| `undeclared-cli` | warn | 外部/プロバイダCLI（`codex` `ollama` …）を宣言なしで叩く。ホストの設定/確認（`claude mcp add` `codex --version` 等）は**除外** |
| `provider-env` | warn | プロバイダ固有 API キー env の生参照（`OPENAI_API_KEY` …） |
| `todo` | warn | 配布物に残った `TODO:` / `FIXME:` |
| `model-id` | opt-in | モデルID直書き（`claude-*` / `gpt-*` / `gemini-*`）※`--model-ids` で有効化 |

Low-noise by design: only unambiguous, author-only breakers are **error** (fail the PR); the rest are **warn**. Validated against a real-world audit of 230 public skills (v0.1.1): every remaining `error` was a genuine hardcoded personal path.

> 誤検知＝狼少年化が唯一の死因。実データ230リポの監査で ERROR の誤検知をゼロに追い込みました（v0.1.1）。

## Use as a GitHub Action / CIで使う（定着の本体）

```yaml
# .github/workflows/carrylint.yml
name: carrylint
on: [push, pull_request]
jobs:
  carrylint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hyuga611/carrylint@v0
        with:
          paths: .          # optional; default = repo
          # strict: 'true'      # warnings also fail
          # model-ids: 'true'   # enable the opt-in model-id rule
```

Findings appear as inline PR annotations and the job fails (exit 1) on any **error**, so a non-portable skill can't be merged.

## Use as a CLI / ローカルで使う

```bash
npx @hyuga/carrylint                     # scan the repo
npx @hyuga/carrylint path/to/skills      # scan a dir/file
npx @hyuga/carrylint --allow codex,gemini   # I depend on these on purpose
npx @hyuga/carrylint --strict            # warnings fail too
npx @hyuga/carrylint --model-ids         # enable the model-id rule
npx @hyuga/carrylint --format json       # machine-readable (VS Code / tooling)
```

### Suppress a line / 行単位の無効化

```md
Save to `C:\tools\out.png` <!-- carry-ignore -->

<!-- carry-ignore-next -->
This model is pinned on purpose: `claude-opus-4-8`
```

## Config / 設定

The provider-CLI / model-ID / env dictionary lives in `rules.json` (data-driven — edit it, no code change). CLI flags also read env: `CARRYLINT_STRICT=1`, `CARRYLINT_MODEL_IDS=1`, `CARRYLINT_FORMAT=json`.

## Model-agnostic / モデル非依存

carrylint treats `codex` / `gemini` / `claude` / `ollama` / `aider` … **equally** as provider lock-in — it never favors one vendor. The check itself is "are you locked to one machine or one model?", so it works the same whether you author with Claude, Codex, or Gemini. No LLM at runtime.

## How it differs / 既存との違い

- **reflint** — does the reference *exist*? (referential integrity)
- **skills-lint** — do two skills *collide*? is the frontmatter valid?
- **carrylint** — does the reference *resolve on someone else's machine / another agent*? (runtime portability)

Part of a small family of zero-dependency, language-agnostic, CI-resident linters for AI-native artifacts.

## License

## Related tools

Zero-dependency CI linters for repos where AI agents do the work. Each one fails the PR on something that breaks quietly.

| | Catches |
| --- | --- |
| [reflint](https://github.com/hyuga611/reflint) | `AGENTS.md` / `llms.txt` / `CLAUDE.md` pointing at commands, scripts, or paths that no longer exist |
| [skills-lint](https://github.com/hyuga611/skills-lint) | `SKILL.md` broken references + `name`/trigger collisions between skills |
| **carrylint** ← you are here | Skills with the author's machine or model baked in — absolute paths, undeclared CLIs, unresolved placeholders |
| [genchi](https://github.com/hyuga611/genchi) | Agents reporting "done" without re-fetching real-world state |
| [tracklint](https://github.com/hyuga611/tracklint) | Forms and CTAs that quietly stopped being wired for conversion tracking |
| [tokenlint](https://github.com/hyuga611/tokenlint) | Hardcoded colors that bypass your design tokens |
| [reflint for VS Code](https://github.com/hyuga611/reflint-vscode) | The same reflint checks, inline in the editor as you save |
| [orogami](https://github.com/hyuga611/orogami) | Not a linter — natural Japanese/CJK line breaking for OGP images (BudouX + font subsetting) |

MIT © hyuga611
