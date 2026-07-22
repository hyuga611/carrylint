---
name: portable-image-gen
description: Generate an image from a Japanese prompt via an external image CLI. Use when the user asks to create or generate an image.
---

# portable-image-gen

作りたい画像を日本語で受け取り、外部の画像生成 CLI で 1 枚生成して、
**このスキルのディレクトリからの相対パス**に保存する。

## 事前準備 / Requirements

このスキルは `codex` CLI を使う。未導入なら次で入れる:

```bash
npm i -g @openai/codex
codex login
```

API キーは環境変数で渡す。必要な変数は同梱の `.env.example` を参照（未設定なら
ユーザーに導入を案内すること）。

## 手順

1. ユーザーから作りたい画像の内容（日本語）を受け取る。
2. 出力先を用意する（このスキル配下の相対パス）:

   ```bash
   mkdir -p ./out
   ```

3. 画像を生成し、`./out/` に保存する。
4. 生成したファイルのパスをユーザーに返す。

参照テンプレートは `references/prompt-template.md` を使う。
