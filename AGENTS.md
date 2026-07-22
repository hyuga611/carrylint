# AGENTS.md

carrylint 自身の開発ガイド。

## コマンド

- テスト: `npm run test`
- 検出デモ（意図的に非可搬な例で exit 1）: `npm run poc`

## 構成

- チェッカ本体（純粋 `scan()` + CLI）: `src/check.mjs`
- ルール辞書（データ駆動・プロバイダCLI/モデルID/env）: `rules.json`
- テスト: `test/check.test.mjs`
- GitHub Action 定義: `action.yml`
- 可搬な例（CIが通る）: `examples/good`
- 非可搬な例（poc が exit 1）: `examples/bad`

## 方針

- 依存ゼロ・言語非依存・実行時に LLM もネットワークも使わない。
- 誤検知ゼロ優先。曖昧さゼロのものだけ `error`（PRを落とす）、残りは `warn`。
- 特定プロバイダに肩入れしない（`codex` / `gemini` / `claude` / `ollama` を等しく扱う）。
