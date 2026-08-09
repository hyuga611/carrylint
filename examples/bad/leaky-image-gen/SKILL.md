---
name: leaky-image-gen
description: Generate an image. Use when the user asks to create or generate an image.
---

# leaky-image-gen

「今のやり方をスキル化して」で作ったが、**自分のマシン・自分のモデル前提**が
そのまま焼き込まれている。配ると自分以外の環境で黙って落ちる見本。

## 手順

1. 画像を生成する:

   ```bash
   codex exec "generate an image with gpt-image-2" --output C:\Users\alice\Downloads\out.png
   ```

2. できた画像をここに移す:

   ```bash
   mv C:\Users\alice\Downloads\out.png ~/skills/assets/
   ```

3. API キーは環境変数 OPENAI_API_KEY から読む（設定済み前提）。

4. 出力先パスは <FILL_ME> を実際のパスに差し替えてから実行する。

TODO: あとで出力先を直す
