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
//   ・undeclared-cli : 外部/プロバイダCLIを宣言なしで叩く。ホストの mcp add/--version 等は除外  [WARN]
//   ・provider-env   : プロバイダ固有の API キー env の生参照                                    [WARN]
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

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const DRIVE_ABS = /(?<![\w.])[A-Za-z]:\\[^\s`"')<>|]+/g;                       // C:\Users\atlan\…（Windows絶対=非可搬）
// /Users/<name>/ ・ /home/<name>/ の <name> を捕捉（汎用名/glob は後段で除外）。
const UNIX_USER_ABS = /(?<![\w.\-\/])\/(Users|home)\/([^\s/`"')<>|]+)([^\s`"')<>|]*)/g;
const TODO_MARK = /(?:\b(?:TODO|FIXME|HACK|XXX)\b\s*[:：]|<!--\s*(?:TODO|FIXME)\b)/;

// v0.1.1: $HOME / ${HOME} / %USERPROFILE% / ~ は各ユーザーで解決＝可搬。エラーにしない
// （実データ監査で「これらは可搬な書き方」だと確認）。実在の個人パスは /Users/<実名>/ のみ。
const GENERIC_USER = new Set([
  'user', 'users', 'you', 'me', 'example', 'name', 'username', 'ubuntu', 'root',
  'admin', 'foo', 'bar', 'home', 'someone', 'yourname', 'test', 'ec2-user',
]);
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

  // frontmatter の allowed-tools / requires
  const fm = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^\s*(?:allowed-tools|requires|tools|dependencies)\s*:\s*(.+)$/i);
      if (m) m[1].replace(/[\[\]"']/g, '').split(/[,\s]+/).forEach(add);
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
 * 行から providerCLI の「呼び出し」を集める。コード文脈（fence行 or backtickスパン中身）で、
 * かつツール名の後ろに引数/サブコマンドがあるものだけを呼び出しとみなす。
 * 裸の言及（`codex` だけ等）は呼び出しではない＝誤検知しない。
 */
function cliInvocations(line, inFence, rules) {
  const hits = new Set();
  const providers = new Set(rules.providerClis);
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

  const findings = [];
  const lines = String(text).split(/\r?\n/);

  // 無効化コメントの行集合を先に作る。
  const ignored = new Set();
  lines.forEach((line, i) => {
    if (/<!--\s*carry-ignore\s*-->/.test(line)) ignored.add(i + 1);
    if (/<!--\s*carry-ignore-next\s*-->/.test(line)) ignored.add(i + 2);
  });

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
      push(findings, ln, 'abs-path', 'error', `マシン固有の絶対パス \`${m[0].trim()}\` — 他人の環境で解決しません（相対パスや {baseDir} に）`);
    }
    UNIX_USER_ABS.lastIndex = 0;
    for (const m of line.matchAll(UNIX_USER_ABS)) {
      const user = (m[2] || '').toLowerCase();
      if (GENERIC_USER.has(user) || user.includes('*') || user.startsWith('$')) continue; // /home/user, /home/*/ 等の例示は除外
      push(findings, ln, 'abs-path', 'error', `作者環境前提の絶対パス \`${m[0].trim()}\` — 他人の環境に \`${m[1]}/${m[2]}\` は存在しません（相対パスや {baseDir} に）`);
    }

    // 2) 未解決プレースホルダ（ERROR）
    for (const re of PLACEHOLDER_ERROR) {
      const m = line.match(re);
      if (m) {
        push(findings, ln, 'placeholder', 'error', `未解決のプレースホルダ \`${m[0].trim()}\` が配布物に残っています`);
        break; // 1行1件に留める
      }
    }

    // 3) 外部/プロバイダCLIの呼び出し（宣言なし）。ホスト自身の設定/確認(mcp add 等)は除外済み。
    //    概念的に曖昧なので v0.1.1 で ERROR→WARN に降格（PRは落とさず注意喚起のみ）。
    for (const cli of cliInvocations(line, inFence, rules)) {
      if (allow.has(cli) || declared.has(cli)) continue;
      push(findings, ln, 'undeclared-cli', 'warn', `\`${cli}\` を呼んでいますが、インストール手順も宣言もありません — 他環境では未導入かもしれません`);
    }

    // 4) プロバイダ固有 env の生参照（WARN）
    {
      const m = line.match(envRe);
      if (m) push(findings, ln, 'provider-env', 'warn', `\`${m[0]}\` を前提にしています — .env.example に記載し未設定時の案内を`);
    }

    // 5) TODO/FIXME 残り（WARN）
    if (TODO_MARK.test(line)) {
      push(findings, ln, 'todo', 'warn', '配布物に TODO/FIXME マーカーが残っています');
    }

    // 6) モデルID直書き（opt-in）
    if (modelIds) {
      modelRe.lastIndex = 0;
      const seen = new Set();
      for (const m of line.matchAll(modelRe)) {
        if (seen.has(m[0])) continue;
        seen.add(m[0]);
        push(findings, ln, 'model-id', 'warn', `モデルID \`${m[0]}\` を直書きしています — 固定は意図的なら --allow / carry-ignore を`);
      }
    }
  });

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
  const allow = new Set();
  let strict = process.env.CARRYLINT_STRICT === '1';
  let modelIds = process.env.CARRYLINT_MODEL_IDS === '1';
  let asJson = process.env.CARRYLINT_FORMAT === 'json';
  const addAllow = (s) => (s || '').split(',').forEach((n) => n.trim() && allow.add(n.trim().toLowerCase()));
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
    else paths.push(a);
  }
  return { paths, allow, strict, modelIds, asJson };
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

export function main(argv) {
  const inActions = process.env.GITHUB_ACTIONS === 'true';
  const { paths, allow, strict, modelIds, asJson } = parseArgs(argv);
  const rules = loadRules();
  const files = findFiles(paths.length ? paths : defaultTargets());

  if (files.length === 0) {
    if (asJson) console.log(JSON.stringify({ ok: true, count: 0, errors: 0, warnings: 0, findings: [] }, null, 2));
    else console.log('carrylint: 対象ファイルなし（SKILL.md / AGENTS.md / CLAUDE.md / GEMINI.md / .claude/commands 等）。スキップ。');
    return 0;
  }

  const results = [];
  for (const file of files) {
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch {
      if (asJson) { console.log(JSON.stringify({ ok: false, error: `cannot read ${file}` }, null, 2)); return 2; }
      console.error(`carrylint: ${file} を読めません`);
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
    console.error(`✗ ${file} — error ${errs} / warn ${findings.length - errs}`);
    for (const f of findings) {
      const ln = f.ln || 1;
      const tag = f.severity === 'error' ? 'ERROR' : 'warn ';
      console.error(`  ${f.severity === 'error' ? '✗' : '•'} ${file}:${ln}\t[${f.kind}] ${f.msg}`);
      if (inActions) {
        const level = f.severity === 'error' ? 'error' : 'warning';
        console.log(`::${level} file=${file},line=${ln}::[${f.kind}] ${f.msg.replace(/\r?\n/g, ' ')}`);
      }
      if (f.severity === 'error') errors++; else warnings++;
    }
  }

  if (errors > 0 || (strict && warnings > 0)) {
    console.error(`\ncarrylint: error ${errors} / warn ${warnings}${strict ? '（--strict: warn も失敗）' : ''}`);
    return 1;
  }
  if (warnings > 0) {
    console.error(`\ncarrylint: error 0 / warn ${warnings}（warn は exit 0。--strict で失敗させられます）`);
    return 0;
  }
  console.log(`carrylint: ${files.length} ファイル、すべて可搬OK`);
  return 0;
}

// 直接実行された時だけ CLI として動く（import 時は関数だけ公開）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
