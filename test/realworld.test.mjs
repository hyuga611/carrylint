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
