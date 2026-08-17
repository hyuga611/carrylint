# Changelog

## 0.4.1

- **「いつやってよいか」を定めた行を、手順として数えていた。** 0.4.0 で禁止語のある行
  （`Never run \`git push\``）は外したが、禁止語を含まない方針文
  ——「`git push` は明示の指示があるときだけ」「Only run it when the user asks」
  「`npm publish` requires approval」——は残っていた。AGENTS.md / CLAUDE.md で
  **書き込みの扱いをきちんと定めている人ほど**当たる形で、0.4.0 で直したものと同じ向き。
  条件・許可の語がある行は数えない。ただし fence の中は実行するコマンドの並びなので
  この除外は当てない（`# main のみ` のようなコメントで本物が落ちるのを避ける）。
  実データ586スキルの真陽性4件は変わらず、発火率も 0.7% のまま。

## 0.4.0

dev.to で記事に付いたコメント2件が、そのままルール候補になった。どちらも
「ERROR にはならないが、次の人の手元では静かに落ちる」型で、carrylint が見ていなかったところ。

### `~/Desktop` は可搬な接頭辞の下にある、存在するとは限らないディレクトリだった（`gui-path`）

v0.1.1 で `~` / `$HOME` / `%USERPROFILE%` を「可搬」として `abs-path` から外した。誤検知
85% を潰した当の変更だが、その結果 **可搬な接頭辞 + 無いかもしれないディレクトリ** が
まるごと素通りするようになっていた。「スクショを撮って `~/Desktop` に保存」はヘッドレスの
ランナーに `~/Desktop` が無いところで落ち、XDG やロケール次第で名前も変わる。
壊れ方は `/Users/<実名>/` と同じで、エラーを出さずに何もしない。

`Desktop` / `Downloads` / `Screenshots` / `Pictures/Screenshots` をホーム直下の保存先として
書いている行を WARN にした。

### 宣言しても install しても、画面が無ければ動かないバイナリがあった（`gui-cli`）

`screencapture` `scrot` `flameshot` `gnome-screenshot` `grim` などのキャプチャ系。
`undeclared-cli` とは別のルールにしてある——あれは「宣言されていない」が問題なので
宣言すれば黙るが、こちらは**宣言しても解決しない**（ディスプレイが無い）。

### 書き換えたきり、どこでも読み直していない手順（`unverified-write`）

`git push` / `npm publish` / SQL の更新系 / `terraform apply` などがあるのに、本文の
どこにも読み直しの記述が無いファイルを1件だけ WARN にする。
**「その手順が実際は何もしなかった」を静的解析が見つけられるわけではない**——見えるのは
「読み直す場所がどこにも無い」という形だけで、そこから先は
[genchi](https://github.com/hyuga611/genchi) の担当。

### 出す前に実データ586スキルに当てた（そして2回削った）

自分のテストが通っても正しさの証明にならないのは v0.1.1 で学んだので、今回も公開前に
ClawHub から 600 スキルを引いて（本文が取れたのは 586）そのまま走らせた。初回の誤検知は
2つの型に集中していた。

- **例示パスを保存先と読んでいた。** `— e.g., ~/Downloads/paper.pdf` のような「例えば
  こういうパス」の行。`YOUR_API_KEY` / `/path/to/` を ERROR から外したのと同じ文書慣習で、
  同じ穴を踏んでいた。例示の語がある行は見ない。
- **HTTP POST を書き込みとして数えていた。** 当たった16件のうち8件が MCP エンドポイント・
  検索・生成への**問い合わせ**で、外部状態を何も変えていなかった。POST は仕様上
  「これを処理してくれ」であって書き込みとは限らない。POST を落とし、変更が確定的な
  PUT / PATCH / DELETE だけ残した。

削ったあとの発火率は `gui-path` 0.7% / `gui-cli` 0.2% / `unverified-write` 0.7%。
`unverified-write` の4件（`npm publish` 1件・`git push` 2件・`curl -X PUT` 1件）は
すべて本物だった。GUI 系で当たった5スキルのうち2件は「移植可能に書けたはずの手順に
デスクトップの保存先が焼き込まれている」本物、残り3件は skill 自体が macOS の
スクリーンショット/デスクトップ操作ツールで、**指摘は正しいが本人には自明**という当たり方。
事実として誤っている当たりは無かった。実データの当たりは
[`test/realworld.test.mjs`](test/realworld.test.mjs) に両方向で固定した。

### publish 直前に別モデル（GPT-5.4）へ渡して、さらに4件直した

実データ監査を通しても残っていた分。うち1件は出してはいけない形だった。

- 🔴 **「やるな」と書いてある行を書き込み手順として数えていた。** `Never run \`git push --force\``
  や「勝手に `npm publish` するな」は、AGENTS.md / CLAUDE.md に普通に並ぶ。**禁止を明記した人ほど
  警告される**という、0.3.1 で直した undeclared-cli（依存を正しく宣言した人ほど刺さる）と同型。
  禁止語のある行は数えず、書き込みの印もコード文脈（fence / バッククォート）でだけ数えるようにした
  （散文の「その後 git に push する」も手順ではない）。
- `carry-ignore` した行に読み直しの語があると、その行が `unverified-write` を黙らせる側に
  回っていた。無効化した行が判定に効くのは carry-ignore の意味として一貫しないので、数えない。
- `--allow` が `gui-cli` を黙らせていた。`--allow` は「そのコマンドは在ることにする」という宣言で、
  **画面の有無とは無関係**。このルールの理由そのものと矛盾していたので外した
  （黙らせるなら `carry-ignore`、または `rules.json` の `guiClis` を空にする）。
- README の表が `curl -X POST` を対象と書いていた（コードでは POST を外したのに直し忘れ）。

同じレビューで、`scp`/`rsync` の判定 `[^\n]*\s\S+@\S+:` が **@ を多く含み : を含まない長い行で
二乗**になることも確認した（2万文字77ms・4万文字312ms）。リンタは他人の任意のファイルの全行に
当たるので、埋め草が `@` を跨がない形に直して線形にし、8万文字1行の走査を回帰テストに入れた。

### 注意

追加したのはすべて WARN なので既定では CI を落とさないが、**`--strict` で運用している場合は
新しく落ちうる**。抑制は行末 `<!-- carry-ignore -->`、または `rules.json` の
`guiDirs` / `guiClis` / `writeSignals` / `readbackSignals` を書き換える（コード変更不要）。

## 0.3.1

- Node 18 で CLI のテストが途中で落ちていたのを直した（`v0.3.0` 以降・テストのみ）。
- **依存をきちんと宣言してあるスキルほど誤検知していた。** frontmatter の
  `requires` / `dependencies` / `tools` / `allowed-tools` を、値が同じ行にある形
  （`requires: codex`）でしか読んでいなかった。依存が複数あれば YAML では普通
  ブロックリストで書くので、`requires:` の下に `- codex` と並べた宣言は素通りし、
  宣言済みの CLI に `undeclared-cli` が出ていた。誤検知はこのリンタの唯一の死因だと
  README に書いておきながら、その誤検知が「正しく書いた人」だけに当たっていたことになる。
  既存テストがインライン形しか見ていなかったので気づけなかった。
- ブロックリストを読むようにし、次のキーで打ち切るようにした（打ち切らないと無関係な
  リスト項目まで宣言扱いになり、今度は本物の見逃しになる）。両方向を
  `test/check.test.mjs` に固定した。
- README に「依存を宣言する」節を追加した。宣言先が frontmatter にあること自体が
  どこにも書かれておらず、載っていた逃げ道は `--allow`（使う側のフラグで、スキルと
  一緒には運ばれない）だけだった。

## 0.3.0

（リリース時に書き漏らしていたので後から追記した。）

- **打ち間違えたフラグが、リンタを黙って無効にしていた。** `-` で始まる不明なトークンを
  パスとして受け取っていたため、`--strct` のような CI の打ち間違いは「存在しないディレクトリを
  走査 → 対象ファイル0件 → exit 0」となり、チェックは緑のままだった。0.2.4 の「install した
  CLI が何もせず exit 0」と同じ壊れ方で、守られていないことが誰にも見えない。
- 不明なオプションは exit 2 で拒否するようにした（`test/cli.test.mjs`）。

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
