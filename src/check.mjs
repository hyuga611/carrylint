#!/usr/bin/env node
// carrylint — 「そのスキル/コマンド、他人のマシン・別のエージェントで本当に動く?」を CI で落とす。
//
// SKILL.md / .claude/commands / AGENTS.md / CLAUDE.md / GEMINI.md / .cursor/rules などの本文から、
// 作った本人の環境・モデル前提が焼き込まれた「実行時に可搬でない」記述を検出する。
//
//   ・abs-path       : 作者環境前提の絶対パス (C:\… や /Users/<実名>/ /home/<実名>/)          [ERROR]
//                      ※ $HOME / ~ / %USERPROFILE% と汎用名(/home/user 等)は可搬なので対象外
//   ・placeholder    : 配布物に残った未完成マーカー (<FILL_ME> REPLACE_ME CHANGEME <INSERT…>)  [ERROR]
//                      ※ YOUR_API_KEY / /path/to/ は「置き換えてね」の正当な文書慣習なので対象外
//   ・gui-path       : GUI 前提の保存先 (~/Desktop $HOME/Downloads ~/Pictures/Screenshots)     [WARN]
//                      ※ ~ /$HOME 自体は可搬でも、その下の Desktop 等はヘッドレスに存在しない
//   ・undeclared-cli : 外部/プロバイダCLIを宣言なしで叩く。ホストの mcp add/--version 等は除外  [WARN]
//   ・gui-cli        : ディスプレイが要るキャプチャ系バイナリ (screencapture scrot …)          [WARN]
//   ・provider-env   : プロバイダ固有の API キー env の生参照                                    [WARN]
//   ・unverified-write: 外部状態を書き換えるのに、本文のどこでも読み直していない                 [WARN]
//   ・todo           : 配布物に残った TODO:/FIXME:/XXX:                                          [WARN]
//   ・model-id       : モデルID直書き (claude-* gpt-* gemini-*)   ← 既定OFF・--model-ids で有効  [opt-in]
//
// v0.1.1: 実データ160+70リポの監査に基づき誤検知を除去（$HOME/~・汎用名・API例・ホストCLI）。
//
// Agent Skills はオープン標準として "形式" は 20+ エージェントで可搬になった。carrylint は
// "中身が実際に動くか" を見る側。実行時に LLM も API キーも使わない純静的解析（依存ゼロ）。
//
//   node src/check.mjs [path ...]        # path 省略時はカレント配下の対象ファイルを自動探索
//   --strict        WARN も exit 1 にする
//   --model-ids     model-id ルールを有効化
//   --allow a,b     意図的に依存する CLI を許可（undeclared-cli を抑制）
//   --format json   機械可読 JSON 出力（VS Code 拡張向け）
//
// 行内無効化: 行末に <!-- carry-ignore --> でその行を無視。単独行 <!-- carry-ignore-next --> で次行を無視。

import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Read rather than hardcoded: a version constant is one more place a release has to
// remember, and the one nobody notices going stale.
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();

// ---------------- ルール辞書（既定・rules.json で上書き可能） ----------------

export const DEFAULT_RULES = {
  // コマンド位置で叩かれたら「そのエージェント/モデルに固定」とみなす外部CLI群。
  providerClis: [
    'codex', 'gemini', 'ollama', 'claude', 'aider', 'cursor-agent',
    'llm', 'sgpt', 'mods', 'copilot', 'goose',
  ],
  // 「npm i -g <package>」等が提供するバイナリ名の別名（宣言判定を正確にする）。
  packageBinaries: {
    '@openai/codex': 'codex',
    '@google/gemini-cli': 'gemini',
    '@anthropic-ai/claude-code': 'claude',
    '@githubnext/github-copilot-cli': 'copilot',
    '@block/goose': 'goose',
    'aider-chat': 'aider',
    'aider-install': 'aider',
    'llm': 'llm',
    'shell-gpt': 'sgpt',
  },
  // プロバイダ固有のモデルID（opt-in）。
  modelIdPatterns: [
    'claude-[a-z0-9][a-z0-9.\\-]*',
    'gpt-[0-9][a-z0-9.\\-]*',
    'gpt-image-[0-9]',
    'o[0-9]-[a-z0-9\\-]+',
    'gemini-[0-9][a-z0-9.\\-]*',
    'dall-e-[0-9]',
    'text-embedding-[a-z0-9\\-]+',
  ],
  // プロバイダ固有の API キー等 env（生参照は環境前提＝WARN）。
  providerEnv: [
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY',
    'AZURE_OPENAI_API_KEY', 'GROQ_API_KEY', 'MISTRAL_API_KEY', 'COHERE_API_KEY',
    'OLLAMA_HOST', 'OPENROUTER_API_KEY', 'PERPLEXITY_API_KEY',
  ],
  // ホーム直下にあっても「デスクトップセッションがある」前提の保存先。
  // ヘッドレスのランナーには存在せず、XDG ではロケールで名前が変わる。
  guiDirs: ['Desktop', 'Downloads', 'Screenshots', 'Pictures/Screenshots'],
  // ディスプレイ（X11/Wayland/Quartz）が無いと動かないキャプチャ系バイナリ。
  guiClis: [
    'screencapture', 'snippingtool', 'scrot', 'gnome-screenshot',
    'spectacle', 'flameshot', 'maim', 'grim', 'xwd',
  ],
  // 外部の状態を書き換える手順の印。ローカルファイルへの書き出しは含めない
  // （読み直しの有無が問題になるのは、自分では見えない先に書いたときだけ）。
  writeSignals: [
    '\\bgit\\s+push\\b',
    '\\bnpm\\s+publish\\b',
    '\\bdocker\\s+push\\b',
    // POST は入れない。実データ586スキルでは POST の当たりの半分が MCP エンドポイント・
    // 検索・生成への「問い合わせ」で、外部状態を書き換えていなかった（HTTP の POST は
    // 仕様上「処理してくれ」であって書き込みとは限らない）。PUT/PATCH/DELETE は変更が確定的。
    '\\b(?:curl|wget)\\b[^\\n]*?(?:-X|--request|--method=?)\\s*(?:PUT|PATCH|DELETE)\\b',
    '\\bhttp(?:ie)?\\s+(?:PUT|PATCH|DELETE)\\s',
    '\\b(?:INSERT\\s+INTO|DELETE\\s+FROM|TRUNCATE\\s+TABLE|DROP\\s+TABLE)\\b',
    '\\bUPDATE\\s+[\\w."`\\[\\]]+\\s+SET\\b',
    '\\baws\\s+s3\\s+(?:cp|sync|mv|rm)\\b',
    '\\bgcloud\\s+storage\\s+(?:cp|rsync|rm)\\b',
    '\\bkubectl\\s+(?:apply|create|delete)\\b',
    '\\bterraform\\s+apply\\b',
    '\\bgh\\s+(?:release|pr|issue)\\s+create\\b',
    // `[^\n]*\s\S+@\S+:` と書くと、@ を多く含み : を含まない長い行で総当たりになる
    // （2万文字で77ms・4万文字で312ms＝二乗）。リンタは任意のファイルの全行に当たるので、
    // 手前の埋め草が @ を跨がないようにして曖昧さを消す。
    '\\b(?:scp|rsync)\\b[^\\n@]*\\s[^\\s@]+@[^\\s:]+:',
    '\\bwp\\s+(?:post|option|user|term)\\s+(?:create|update|delete)\\b',
  ],
  // 「書いたあとに実結果を見に行っている」ことを示す語。取りこぼすと誤検知になるので
  // わざと広く取る（このルールは再現率より適合率を優先する）。
  readbackSignals: [
    're-?fetch', 're-?read\\b', 'read[\\s-]?back\\b',
    '\\bverif(?:y|ies|ied|ication)\\b', '\\bvalidat(?:e|es|ed|ion)\\b',
    '\\bconfirm(?:s|ed|ation)?\\b', '\\bcheck(?:s|ed|ing)?\\b', '\\bassert\\b',
    '\\bSELECT\\s+[\\w*]', '\\bgit\\s+(?:log|status|show|diff)\\b',
    '\\bgh\\s+run\\s+(?:watch|view)\\b', '\\bstatus\\s*code\\b', '\\b2\\d\\d\\s*OK\\b',
    '\\btest\\s+-[edfs]\\b',
    '確認|検証|再取得|突き合わせ|照合|実在',
  ],
};

// 配布物に残っていたら「作者が埋め忘れた未完成」を示す、曖昧さゼロのマーカーのみ（ERROR）。
// v0.1.1: YOUR_API_KEY / /path/to/ / <your-x> は「実行時に置き換えてね」という正当な
// ドキュメント慣習（実データ監査で 26/26 が誤検知）だったので ERROR から除外した。
const PLACEHOLDER_ERROR = [
  /<fill[_\- ]?me>?/i,
  /\bfill[_\-]me\b/i,
  /\breplace[_\-]?me\b/i,
  /\bchange[_\-]?me\b/i,
  /<insert[ _\-][^>]{1,40}>/i,
];

// ---------------- パターン（純粋・textスキャン） ----------------

const DRIVE_ABS = /(?<![\w.])[A-Za-z]:\\[^\s`"')<>|]+/g;                       // C:\Users\alice\…（Windows絶対=非可搬）
// /Users/<name>/ ・ /home/<name>/ の <name> を捕捉（汎用名/glob は後段で除外）。
const UNIX_USER_ABS = /(?<![\w.\-\/])\/(Users|home)\/([^\s/`"')<>|]+)([^\s`"')<>|]*)/g;
const TODO_MARK = /(?:\b(?:TODO|FIXME|HACK|XXX)\b\s*[:：]|<!--\s*(?:TODO|FIXME)\b)/;

// ユーザーごとに解決される＝可搬なホーム表記。abs-path はこれを意図的に見逃す（v0.1.1）が、
// 「可搬な接頭辞 + 存在するとは限らないディレクトリ」はそこをすり抜けていた（gui-path で拾う）。
const HOME_PREFIX = String.raw`(?:~|\$HOME|\$\{HOME\}|\$env:(?:USERPROFILE|HOME)|%USERPROFILE%|%HOMEPATH%|\$USERPROFILE)`;
// 「例えばこういうパス」を挙げているだけの行。YOUR_API_KEY / /path/to/ を ERROR から
// 外したのと同じ文書慣習で、実データではここが gui-path の誤検知の主な出どころだった。
const ILLUSTRATIVE = /\b(?:e\.?g\.?|for example|example[:s]?|sample)\b|例え?ば|たとえば|例：/i;
// 「やるな」と書いてある行は手順ではない。AGENTS.md / CLAUDE.md には
// 「`git push` は勝手にするな」の類が普通に並ぶので、これを書き込み手順と数えると
// **禁止を明記した人ほど警告される**（0.3.1 の undeclared-cli と同じ形の誤検知）。
const PROHIBITION = /\b(?:never|do not|don't|doesn't|must not|should not|avoid|prohibited|forbidden|no need to)\b|禁止|するな|しないで|してはいけない|勝手に|不可/i;
// 長い一致で行が読めなくなるので、メッセージに載せる引用は詰める。
const brief = (s) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);

// v0.1.1: $HOME / ${HOME} / %USERPROFILE% / ~ は各ユーザーで解決＝可搬。エラーにしない
// （実データ監査で「これらは可搬な書き方」だと確認）。実在の個人パスは /Users/<実名>/ のみ。
const GENERIC_USER = new Set([
  'user', 'users', 'you', 'me', 'example', 'name', 'username', 'ubuntu', 'root',
  'admin', 'foo', 'bar', 'home', 'someone', 'yourname', 'test', 'ec2-user',
]);
// 大文字で書かれた「置き換えてね」の雛形語（GENERIC_USER と違い大小を区別する）。
const PLACEHOLDER_USER = new Set(['USERNAME', 'USER', 'YOURNAME', 'YOURUSER', 'NAME', 'ME']);
// ホスト/セットアップ系サブコマンドは「その場で使う道具」でなく「環境設定・確認」なので依存扱いしない
// （実データ監査の undeclared-cli 誤検知は大半が `claude mcp add` / `codex mcp add` 等だった）。
const META_SUBCMD = new Set([
  'mcp', 'login', 'logout', 'config', 'configure', 'auth', 'add', 'install',
  'update', 'upgrade', 'init', 'setup', 'doctor', 'version', 'help',
  '--version', '-v', '--help', '-h',
]);

function push(findings, ln, kind, severity, msg) {
  findings.push({ ln, kind, severity, msg });
}

/** frontmatter と本文中の install/宣言行から「宣言済みツール名」を集める。 */
function declaredTools(text, rules) {
  const declared = new Set();
  const add = (raw) => {
    if (!raw) return;
    let name = String(raw).trim().toLowerCase();
    if (!name) return;
    if (rules.packageBinaries[name]) {
      declared.add(rules.packageBinaries[name]);
      return;
    }
    name = name.replace(/^@[\w.\-]+\//, '').replace(/@[\w.\-]+$/, '').replace(/[^\w.\-]/g, '');
    if (name) declared.add(name);
  };

  // frontmatter の allowed-tools / requires。
  // インラインだけでなく YAML のブロックリストも読む。`requires:` の下に `- codex` と
  // 並べるのは YAML では最も自然な書き方で、そこを読めないと「依存をきちんと宣言した
  // スキル」ほど undeclared-cli に刺さる（誤検知＝リンタの死因）。
  const fm = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const addList = (s) => s.replace(/[\[\]"']/g, '').split(/[,\s]+/).forEach(add);
    let inDepList = false;
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^\s*(?:allowed-tools|requires|tools|dependencies)\s*:\s*(.*)$/i);
      if (m) {
        if (m[1].trim()) addList(m[1]);   // requires: codex / [a, b]
        else inDepList = true;            // requires:  → 次行以降の `- x` を拾う
        continue;
      }
      const item = inDepList && line.match(/^\s+-\s*(.+)$/);
      if (item) addList(item[1]);
      else if (line.trim()) inDepList = false; // 別のキーに移ったら終了（空行は跨ぐ）
    }
  }

  // 本文の install 手順（npm i -g … / brew install … / pip install … 等）
  const installRe = /\b(?:npm\s+(?:i|install)(?:\s+-g|\s+--global)?|pnpm\s+add(?:\s+-g)?|yarn\s+(?:global\s+)?add|brew\s+install(?:\s+--cask)?|pipx?\s+install|pip3?\s+install|cargo\s+install|go\s+install|apt(?:-get)?\s+install|choco\s+install|scoop\s+install|uv\s+tool\s+install)\s+([^\n`|&;]+)/gi;
  for (const m of text.matchAll(installRe)) {
    for (const tok of m[1].split(/[\s,]+/)) {
      if (!tok || tok.startsWith('-')) continue;
      add(tok);
    }
  }
  return declared;
}

/** コマンドセグメントの先頭コマンド語を返す（sudo / 環境代入 / $ プロンプトを剥がす）。 */
function firstCommandWord(seg) {
  let s = seg.trim();
  s = s.replace(/^[!$#>]\s*/, '');            // プロンプト記号 / Claude の !`…`
  s = s.replace(/^sudo\s+/, '');
  s = s.replace(/^(?:[A-Za-z_][\w]*=[^\s]*\s+)+/, ''); // FOO=bar cmd
  const m = s.match(/^([A-Za-z][\w.-]*)/);
  return m ? m[1].toLowerCase() : null;
}

/**
 * 行から `names` に載っている CLI の「呼び出し」を集める。コード文脈（fence行 or
 * backtickスパン中身）で、かつツール名の後ろに引数/サブコマンドがあるものだけを
 * 呼び出しとみなす。裸の言及（`codex` だけ等）は呼び出しではない＝誤検知しない。
 */
function cliInvocations(line, inFence, names) {
  const hits = new Set();
  const providers = names instanceof Set ? names : new Set(names);
  const segments = [];
  if (inFence) segments.push(line);
  for (const m of line.matchAll(/`([^`]+)`/g)) segments.push(m[1]);
  for (const seg of segments) {
    for (const sub of seg.split(/[\n;|&]+|\$\(/)) {
      const w = firstCommandWord(sub);
      if (!w || !providers.has(w)) continue;
      const rest = sub.trim()
        .replace(/^[!$#>]\s*/, '')
        .replace(/^sudo\s+/, '')
        .replace(/^(?:[A-Za-z_][\w]*=[^\s]*\s+)+/, '');
      const mm = new RegExp('^' + w + '\\b\\s+(\\S+)', 'i').exec(rest);
      if (!mm) continue;                                    // 裸の言及（引数なし）は呼び出しでない
      if (META_SUBCMD.has(mm[1].toLowerCase())) continue;   // mcp / --version / login 等は設定・確認＝依存でない
      hits.add(w);
    }
  }
  return hits;
}

/**
 * 本文を走査して可搬性エラーを返す（純粋関数・テスト可能）。
 * @param text  ファイル本文
 * @param opts  { rules, allow:Set|string[], modelIds:boolean }
 */
export function scan(text, opts = {}) {
  const rules = opts.rules || DEFAULT_RULES;
  const allow = opts.allow instanceof Set ? opts.allow
    : new Set((opts.allow || []).map((s) => String(s).toLowerCase()));
  const modelIds = !!opts.modelIds;
  const declared = declaredTools(text, rules);
  const modelRe = new RegExp('\\b(?:' + rules.modelIdPatterns.join('|') + ')\\b', 'gi');
  const envRe = new RegExp('\\b(?:' + rules.providerEnv.join('|') + ')\\b');
  const providerCliSet = new Set(rules.providerClis);
  const guiCliSet = new Set(rules.guiClis || []);
  const guiDirAlt = (rules.guiDirs || [])
    .map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]'))
    .join('|');
  const guiDirRe = guiDirAlt
    ? new RegExp(`${HOME_PREFIX}[\\\\/](?:${guiDirAlt})\\b`, 'gi')
    : null;
  const writeRes = (rules.writeSignals || []).map((s) => new RegExp(s, 'i'));
  const readbackRe = (rules.readbackSignals || []).length
    ? new RegExp((rules.readbackSignals || []).join('|'), 'i')
    : null;

  const findings = [];
  let firstWrite = null;
  const lines = String(text).split(/\r?\n/);

  // 無効化コメントの行集合を先に作る。
  const ignored = new Set();
  lines.forEach((line, i) => {
    if (/<!--\s*carry-ignore\s*-->/.test(line)) ignored.add(i + 1);
    if (/<!--\s*carry-ignore-next\s*-->/.test(line)) ignored.add(i + 2);
  });

  // 読み直しは行単位ではなく本文で1回だけ見る（節をまたいで書かれるのが普通で、
  // 行単位にすると「書いてあるのに拾えない」＝誤検知になる）。ただし carry-ignore した行は
  // 数えない——無効化した行が黙らせる側に回るのは、carry-ignore の意味として一貫しない。
  const sawReadback = !!readbackRe
    && lines.some((line, i) => !ignored.has(i + 1) && readbackRe.test(line));

  let inFence = false;
  lines.forEach((line, i) => {
    const ln = i + 1;

    // フェンス（``` / ~~~）開閉。マーカ行自体は走査しない。
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (ignored.has(ln)) return;

    // 1) マシン固有の絶対パス（ERROR）。$HOME/~ は可搬なので対象外・汎用ユーザー名の例示も除外（v0.1.1）。
    DRIVE_ABS.lastIndex = 0;
    for (const m of line.matchAll(DRIVE_ABS)) {
      push(findings, ln, 'abs-path', 'error', `machine-specific absolute path \`${m[0].trim()}\` — will not resolve on anyone else's machine (use a relative path or {baseDir})`);
    }
    UNIX_USER_ABS.lastIndex = 0;
    for (const m of line.matchAll(UNIX_USER_ABS)) {
      const raw = m[2] || '';
      const user = raw.toLowerCase();
      if (GENERIC_USER.has(user) || user.includes('*') || user.startsWith('$')) continue; // /home/user, /home/*/ 等の例示は除外
      // 大文字の「単語としての雛形」だけを除外する。`/home/YOUR_USER/…`
      // `/Users/USERNAME/…` は YOUR_API_KEY と同じ「置き換えてね」の文書慣習
      // （ClawHub 実データ監査・2026-08）。
      // 単なる全大文字では広すぎる: `/Users/CS/…` は実在の作者のホーム（2026-07監査で確認）。
      // アンダースコア区切り、または既知の雛形語だけを雛形と見なす。
      if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]*$/.test(raw) || PLACEHOLDER_USER.has(raw)) continue;
      if (/[<>{}\[\]]/.test(raw)) continue; // /home/<your-name>/ 形式の穴埋め
      push(findings, ln, 'abs-path', 'error', `author-specific absolute path \`${m[0].trim()}\` — \`${m[1]}/${m[2]}\` does not exist elsewhere (use a relative path or {baseDir})`);
    }

    // 2) GUI/デスクトップ前提の保存先（WARN）。~ や $HOME 自体は可搬なので abs-path は
    //    見逃すが、その下の Desktop/Downloads/Screenshots はヘッドレスのランナーに存在せず、
    //    XDG ではロケールで名前が変わる。壊れ方は abs-path と同じで、静かに落ちる。
    if (guiDirRe && !ILLUSTRATIVE.test(line)) {
      guiDirRe.lastIndex = 0;
      const seenGui = new Set();
      for (const m of line.matchAll(guiDirRe)) {
        if (seenGui.has(m[0])) continue;
        seenGui.add(m[0]);
        push(findings, ln, 'gui-path', 'warn', `\`${m[0]}\` assumes a desktop session — a headless runner has no such directory and XDG/localized setups name it differently (discover the directory, or take it as a parameter)`);
      }
    }

    // 3) 未解決プレースホルダ（ERROR）
    for (const re of PLACEHOLDER_ERROR) {
      const m = line.match(re);
      if (m) {
        push(findings, ln, 'placeholder', 'error', `unresolved placeholder \`${m[0].trim()}\` left in a shipped file`);
        break; // 1行1件に留める
      }
    }

    // 4) 外部/プロバイダCLIの呼び出し（宣言なし）。ホスト自身の設定/確認(mcp add 等)は除外済み。
    //    概念的に曖昧なので v0.1.1 で ERROR→WARN に降格（PRは落とさず注意喚起のみ）。
    for (const cli of cliInvocations(line, inFence, providerCliSet)) {
      if (allow.has(cli) || declared.has(cli)) continue;
      push(findings, ln, 'undeclared-cli', 'warn', `calls \`${cli}\` but never declares or installs it — it may not be present elsewhere`);
    }

    // 5) ディスプレイが要るキャプチャ系バイナリ（WARN）。undeclared-cli とは別物で、
    //    宣言しても install しても、画面が無い環境では動かない。
    //    --allow では黙らせない。あれは「そのコマンドは在ることにする」という宣言で、
    //    画面の有無とは無関係だから（黙らせるなら carry-ignore か rules.json の guiClis）。
    for (const cli of cliInvocations(line, inFence, guiCliSet)) {
      push(findings, ln, 'gui-cli', 'warn', `calls \`${cli}\`, which needs a display — declaring it does not make it run on a headless runner (accept a supplied image path, or make the capture step optional)`);
    }

    // 6) プロバイダ固有 env の生参照（WARN）
    {
      const m = line.match(envRe);
      if (m) push(findings, ln, 'provider-env', 'warn', `assumes \`${m[0]}\` is set — document it in .env.example and handle the unset case`);
    }

    // 7) 外部状態を書き換える手順（あとで本文全体の読み直しの有無と突き合わせる）。
    //    undeclared-cli と同じくコード文脈でだけ数える——散文の言及は手順ではない。
    if (!firstWrite && !PROHIBITION.test(line)) {
      const code = inFence ? line : Array.from(line.matchAll(/`([^`]+)`/g), (m) => m[1]).join(' ; ');
      if (code) {
        for (const re of writeRes) {
          const m = code.match(re);
          if (m) { firstWrite = { ln, text: m[0].trim() }; break; }
        }
      }
    }

    // 8) TODO/FIXME 残り（WARN）
    if (TODO_MARK.test(line)) {
      push(findings, ln, 'todo', 'warn', 'TODO/FIXME marker left in a shipped file');
    }

    // 9) モデルID直書き（opt-in）
    if (modelIds) {
      modelRe.lastIndex = 0;
      const seen = new Set();
      for (const m of line.matchAll(modelRe)) {
        if (seen.has(m[0])) continue;
        seen.add(m[0]);
        push(findings, ln, 'model-id', 'warn', `hardcoded model id \`${m[0]}\` — if pinning is deliberate, use --allow or carry-ignore`);
      }
    }
  });

  // 10) 書いたきり読み直していない（WARN・ファイル単位で1件）。静的解析に「その手順が
  //     実際は何もしなかった」は見えないので、見えるのは「読み直す場所がどこにも無い」
  //     という形だけ。1件も出さない方がマシなので、読み直しの語は広く取ってある。
  if (firstWrite && !sawReadback) {
    push(findings, firstWrite.ln, 'unverified-write', 'warn', `changes external state (\`${brief(firstWrite.text)}\`) but nothing in this file reads that state back — the step can fail and still be reported as done`);
  }

  findings.sort((a, b) => a.ln - b.ln);
  return findings;
}

// ---------------- ファイル探索 ----------------

const DEFAULT_NAMES = new Set(['SKILL.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
const DEFAULT_DIRS = [['.claude', 'commands'], ['.codex', 'prompts'], ['.cursor', 'rules'], ['.github', 'prompts']];

function isTargetName(name) {
  return DEFAULT_NAMES.has(name);
}

/** paths（ファイル/ディレクトリ）から対象ファイルを集める。 */
export function findFiles(paths) {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    const r = p.replace(/\\/g, '/');
    if (!seen.has(r)) { seen.add(r); out.push(r); }
  };
  const inCommandDir = (dir) => DEFAULT_DIRS.some((seg) => dir.replace(/\\/g, '/').includes(seg.join('/')));
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
        walk(join(dir, e.name), depth + 1);
      } else if (isTargetName(e.name) || (/\.(md|txt|mdc)$/i.test(e.name) && inCommandDir(dir))) {
        add(join(dir, e.name));
      }
    }
  };
  for (const p of paths) {
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, 0);
    else add(p);
  }
  return out;
}

// ---------------- CLI ----------------

/** argv から オプションを取り出し、残りをパスとして返す。 */
export function parseArgs(argv) {
  const paths = [];
  const unknown = [];
  const allow = new Set();
  let strict = process.env.CARRYLINT_STRICT === '1';
  let modelIds = process.env.CARRYLINT_MODEL_IDS === '1';
  let asJson = process.env.CARRYLINT_FORMAT === 'json';
  const addAllow = (s) =>
    (s || '').split(',').forEach((n) => {
      if (n.trim()) allow.add(n.trim().toLowerCase());
    });
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    else if (a === '--strict') strict = true;
    else if (a === '--model-ids') modelIds = true;
    else if (a === '--json') asJson = true;
    else if (a === '--format') { if (argv[i + 1] === 'json') asJson = true; i++; }
    else if (a.startsWith('--format=')) { if (a.slice(9) === 'json') asJson = true; }
    else if (a === '--allow') addAllow(argv[++i]);
    else if (a.startsWith('--allow=')) addAllow(a.slice(8));
    // A token starting with "-" is never a path. Letting one through as a path is how
    // a mistyped CI flag turned this linter off: it scanned a directory that did not
    // exist, found no target file, and exited 0 with the check still green.
    else if (a.startsWith('-')) unknown.push(a);
    else paths.push(a);
  }
  return { paths, unknown, allow, strict, modelIds, asJson };
}

/** rules.json をモジュール同梱位置から読む（無ければ既定）。 */
function loadRules() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(readFileSync(join(here, '..', 'rules.json'), 'utf8'));
    return { ...DEFAULT_RULES, ...raw };
  } catch {
    return DEFAULT_RULES;
  }
}

function defaultTargets() {
  return ['.'];
}

/** results（[{file, findings}]）を機械可読な JSON 形へ（純粋・テスト可能）。 */
export function toJson(results) {
  const findings = results.flatMap(({ file, findings }) =>
    findings.map((f) => ({ file, line: f.ln || 1, kind: f.kind, severity: f.severity, message: f.msg })),
  );
  const errors = findings.filter((f) => f.severity === 'error').length;
  return { ok: errors === 0, count: findings.length, errors, warnings: findings.length - errors, findings };
}

const HELP = `carrylint ${VERSION} — will this skill work on anybody else's machine?

  carrylint [path ...]      default: SKILL.md, AGENTS.md, CLAUDE.md, GEMINI.md,
                            .claude/commands/

  --strict                  warnings fail the run too
  --model-ids               flag pinned model identifiers
  --allow a,b               commands to treat as present
  --format json | --json    machine-readable output
  -h, --help  ·  -v, --version

  Inline: <!-- carry-ignore --> at end of line, <!-- carry-ignore-next --> on its own.

  exit 0 nothing to fix (or nothing to check) / 1 findings / 2 could not run
`;

export function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(VERSION + '\n');
    return 0;
  }
  const inActions = process.env.GITHUB_ACTIONS === 'true';
  const { paths, unknown, allow, strict, modelIds, asJson } = parseArgs(argv);
  if (unknown.length) {
    console.error(`carrylint: unknown option ${unknown.join(', ')}`);
    console.error('carrylint: run with --help to see what it takes');
    return 2;
  }
  const rules = loadRules();
  const files = findFiles(paths.length ? paths : defaultTargets());

  if (files.length === 0) {
    if (asJson) console.log(JSON.stringify({ ok: true, count: 0, errors: 0, warnings: 0, findings: [] }, null, 2));
    else console.log('carrylint: no target file found (SKILL.md / AGENTS.md / CLAUDE.md / GEMINI.md / .claude/commands …) — skipping.');
    return 0;
  }

  const results = [];
  for (const file of files) {
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch {
      if (asJson) { console.log(JSON.stringify({ ok: false, error: `cannot read ${file}` }, null, 2)); return 2; }
      console.error(`carrylint: cannot read ${file}`);
      return 2;
    }
    results.push({ file, findings: scan(text, { rules, allow, modelIds }) });
  }

  if (asJson) {
    const out = toJson(results);
    console.log(JSON.stringify(out, null, 2));
    return out.errors > 0 || (strict && out.count > 0) ? 1 : 0;
  }

  let errors = 0;
  let warnings = 0;
  for (const { file, findings } of results) {
    if (findings.length === 0) { console.log(`✓ ${file}`); continue; }
    const errs = findings.filter((f) => f.severity === 'error').length;
    console.error(`✗ ${file} — ${errs} error${errs === 1 ? '' : 's'} / ${findings.length - errs} warning${findings.length - errs === 1 ? '' : 's'}`);
    for (const f of findings) {
      const ln = f.ln || 1;
      console.error(`  ${f.severity === 'error' ? '✗' : '•'} ${file}:${ln}\t[${f.kind}] ${f.msg}`);
      if (inActions) {
        const level = f.severity === 'error' ? 'error' : 'warning';
        console.log(`::${level} file=${file},line=${ln}::[${f.kind}] ${f.msg.replace(/\r?\n/g, ' ')}`);
      }
      if (f.severity === 'error') errors++; else warnings++;
    }
  }

  if (errors > 0 || (strict && warnings > 0)) {
    console.error(`\ncarrylint: ${errors} error${errors === 1 ? '' : 's'} / ${warnings} warning${warnings === 1 ? '' : 's'}${strict ? ' (--strict: warnings fail too)' : ''}`);
    return 1;
  }
  if (warnings > 0) {
    console.error(`\ncarrylint: 0 errors / ${warnings} warning${warnings === 1 ? '' : 's'} (warnings exit 0 — use --strict to fail on them)`);
    return 0;
  }
  console.log(`carrylint: ${files.length} file${files.length === 1 ? '' : 's'}, all portable`);
  return 0;
}

// 直接実行された時だけ CLI として動く（import 時は関数だけ公開）。
//
// argv[1] は「どう呼ばれたか」のパス。`npm i -g` も `npx` もそこにシンボリックリンクを置くので、
// 解決済みの実パスである import.meta.url とは一致せず、install した版の CLI は何もせずに
// exit 0 で終わっていた。リンタにとってこれは最悪の壊れ方で、「問題を見つけなかった」と
// 「一度も動いていない」が区別できない。比較する前にリンクを解決する。
function runDirectly() {
  const arg = process.argv[1];
  if (!arg) return false;
  if (import.meta.url === pathToFileURL(arg).href) return true;
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
}

if (runDirectly()) {
  process.exit(main(process.argv.slice(2)));
}
