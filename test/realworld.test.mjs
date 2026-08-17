// Regression tests distilled from a real-world audit of 160 public SKILL.md / AGENTS.md
// files (2026-07). v0.1.0 raised ~85% false positives on these; v0.1.1 was tuned against
// this data. Each line below is a representative snippet from a real repo.
//
//   mustFlag    — genuine portability bugs that MUST stay caught (regression guard)
//   mustNotFlag — real-world patterns v0.1.0 wrongly flagged; v0.1.1 must stay silent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../src/check.mjs';

const has = (fs, kind) => fs.some((f) => f.kind === kind);

// --- genuine bugs: a hardcoded personal absolute path (author-only) ---
const mustFlag = [
  ['op7418/guizang-ppt-skill', '原始参考是 `/Users/guohao/Documents/op7418/ppt/index.html`。', 'abs-path'],
  ['godavidgpg/game-design-analyzer', 'cd "C:/Users/vudrk/Desktop/AI Projects" && python x.py', 'abs-path'],
  ['crunchtools/deploy-mcp-server', '"--env-file", "/home/fatherlinux/.config/mcp-env/mcp-<name>.env",', 'abs-path'],
  ['thumbor/libthumbor', 'See [Makefile](/home/metal/work/libthumbor/Makefile); prefer them.', 'abs-path'],
  ['CSlawyer1985/contract-review-pro', '先读取 `/Users/CS/Documents/知识库/.claude/rules/x.md`。', 'abs-path'],
];

for (const [repo, text, kind] of mustFlag) {
  test(`mustFlag: ${repo} → ${kind}`, () => {
    const fs = scan(text);
    assert.ok(has(fs, kind), `expected a ${kind} finding for: ${text}`);
    assert.ok(fs.some((f) => f.kind === kind && f.severity === 'error'), 'should be an ERROR');
  });
}

// --- real-world patterns that v0.1.0 wrongly flagged; v0.1.1 must NOT ---
const mustNotFlag = [
  ['getcost: $HOME skill path (portable)', 'test -f "$HOME/.claude/skills/getcost/bin/getcost-calc.py"', 'abs-path'],
  ['openscad: ~ skill path (portable)', 'bash ~/.claude/skills/openscad/scripts/render.sh preview file.scad', 'abs-path'],
  ['AganFebro: /home/ubuntu deploy (generic)', 'WorkingDirectory=/home/ubuntu', 'abs-path'],
  ['Dicklesworthstone: /home/user example (generic)', '"source_path": "/home/user/.codex/sessions/session.jsonl"', 'abs-path'],
  ['daedalus/nanocode: YOUR_API_KEY doc convention', '  -H "Authorization: Bearer YOUR_API_KEY"', 'placeholder'],
  ['cass_memory_system: /path/to/project doc', 'cm reflect --workspace /path/to/project', 'placeholder'],
  ['Cheerhuan: /path/to/venv doc', '"command": "/path/to/venv/bin/python3 /path/to/eco_engine.py"', 'placeholder'],
  ['HatcherLabs: <your-agent-name> doc template', 'Hatcher-Agent-Name: <your-agent-name>/<version>', 'placeholder'],
  ['Goldentrii: claude mcp add (host setup)', '`claude mcp add --scope user agent-recall -- npx -y agent-recall-mcp`', 'undeclared-cli'],
  ['Goldentrii: codex mcp add (host setup)', '`codex mcp add agent-recall -- npx -y agent-recall-mcp`', 'undeclared-cli'],
  ['reprompter: claude --version (host check)', 'run `claude --version` and expect 2.1+', 'undeclared-cli'],
];

for (const [label, text, kind] of mustNotFlag) {
  test(`mustNotFlag: ${label} → no ${kind}`, () => {
    assert.ok(!has(scan(text), kind), `v0.1.1 should NOT raise ${kind} for: ${text}`);
  });
}

// --- 0.4.0 の実データ監査（ClawHub 586スキル・2026-08）で見つけた誤検知と真陽性 ---
// gui-path / unverified-write は、この監査に当てて絞り込んでから出した。

const v04MustFlag = [
  ['nature-reader: 出力先が ~/Downloads 固定', '4. **Export** — save as `~/Downloads/[paper-title]-reader.md`', 'gui-path'],
  ['personal-toutiao-pub: スクショの保存先が ~/Desktop', '- **成功截图**：`~/Desktop/toutiao_publish_success.png`', 'gui-path'],
  ['skill-scaffold: npm publish して読み直さない', '5. Publish: `clawdhub publish .` or `npm publish`', 'unverified-write'],
  // 実ファイルではコードブロックの中にある。0.4.0 は散文の言及を数えないので、
  // 抜き出すときも fence ごと持ってこないと本物を再現したことにならない。
  ['openclaw-router: git push して読み直さない', '```bash\ngit push origin feature/your-feature\n```', 'unverified-write'],
];

for (const [label, text, kind] of v04MustFlag) {
  test(`mustFlag (0.4.0): ${label} → ${kind}`, () => {
    assert.ok(has(scan(text), kind), `expected a ${kind} finding for: ${text}`);
  });
}

const v04MustNotFlag = [
  // 「例えばこういうパス」を挙げているだけの行。YOUR_API_KEY と同じ文書慣習。
  ['nature-reader: e.g. の例示パス', '1. **PDF file path** — e.g., `~/Downloads/paper.pdf`', 'gui-path'],
  ['caravo: (e.g., ...) を含む説明行', 'File upload tip: pass a local path (e.g., `~/Downloads/a.png`) instead of a URL', 'gui-path'],
  // POST は「問い合わせ」にも使われる。実データでは当たりの半分が MCP/検索/生成への
  // 呼び出しで、外部状態を書き換えていなかった。
  ['bohrium-wiki: POST は検索の問い合わせ', 'curl -s -X POST "$BASE/search_index_name" -d \'{"q":"x"}\'', 'unverified-write'],
  ['pipeworx-translate: MCP エンドポイントへの POST', 'curl -X POST https://gateway.pipeworx.io/translate/mcp', 'unverified-write'],
];

for (const [label, text, kind] of v04MustNotFlag) {
  test(`mustNotFlag (0.4.0): ${label} → no ${kind}`, () => {
    assert.ok(!has(scan(text), kind), `0.4.0 should NOT raise ${kind} for: ${text}`);
  });
}

// --- ClawHub registry audit (2026-08) ------------------------------------------------
// An uppercase word template in the user segment is the same "replace this" documentation
// convention as YOUR_API_KEY. A real author home must still be caught — `/Users/CS/` is a
// person's initials, confirmed genuine in the 2026-07 audit above.
const upperUserTemplates = [
  ['nest-devices: /home/YOUR_USER cloudflared doc', 'credentials-file: /home/YOUR_USER/.cloudflared/TUNNEL_ID.json'],
  ['/Users/USERNAME doc template', 'Place the repo at `/Users/USERNAME/projects/app`.'],
  ['/home/<your-name> angle-bracket template', 'Install to `/home/<your-name>/bin`.'],
  ['/Users/MY_NAME underscore template', 'Set root to `/Users/MY_NAME/workspace`.'],
];
for (const [label, text] of upperUserTemplates) {
  test(`mustNotFlag: ${label} → no abs-path`, () => {
    assert.ok(!has(scan(text), 'abs-path'), `should not raise abs-path for: ${text}`);
  });
}

const realAuthorHomes = [
  ['CSlawyer1985: initials are a real user, not a template', '先读取 `/Users/CS/Documents/x.md`。'],
  ['chinese-chess: /Users/root009', 'Board state lives in `/Users/root009/projects/demos/g1/game2`.'],
  ['openclaw-live-updater: maintainer home in a shipped first-party skill', 'Keep `/Users/steipete/openclaw` a read-only mirror.'],
];
for (const [label, text] of realAuthorHomes) {
  test(`mustFlag: ${label} → abs-path`, () => {
    assert.ok(has(scan(text), 'abs-path'), `expected abs-path for: ${text}`);
  });
}
