import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, parseArgs, toJson, findFiles } from '../src/check.mjs';

const kinds = (fs) => fs.map((f) => f.kind);
const has = (fs, kind) => fs.some((f) => f.kind === kind);
const sev = (fs, kind) => fs.find((f) => f.kind === kind)?.severity;

test('clean portable text → no findings', () => {
  const t = [
    'Run the build:',
    '```bash',
    'npm run build',
    '```',
    'Save output to `./out/img.png` (relative).',
  ].join('\n');
  assert.deepEqual(scan(t), []);
});

test('abs-path: Windows drive-letter path → error', () => {
  const fs = scan('Save to `C:\\Users\\atlan\\Downloads\\out.png`.');
  assert.ok(has(fs, 'abs-path'));
  assert.equal(sev(fs, 'abs-path'), 'error');
});

test('abs-path: /Users/<name>/ and /home/<name>/ → error, but URL path is ignored', () => {
  assert.ok(has(scan('open /Users/atlan/dev/x.md now'), 'abs-path'));
  assert.ok(has(scan('cd /home/alice/project'), 'abs-path'));
  // URL that merely contains /Users/ must NOT match
  assert.ok(!has(scan('see https://example.com/Users/guide'), 'abs-path'));
});

test('abs-path (v0.1.1): generic /home/<generic> is NOT flagged (illustrative)', () => {
  // /home/user, /home/ubuntu, /home/*/ are example/deploy paths, not a real personal path
  assert.ok(!has(scan('cd /home/user/project'), 'abs-path'));
  assert.ok(!has(scan('WorkingDirectory=/home/ubuntu'), 'abs-path'));
  assert.ok(!has(scan('ls /home/*/anaconda3/envs/*/bin'), 'abs-path'));
});

test('abs-path (v0.1.1): $HOME / ${HOME} / %USERPROFILE% / ~ are portable → NOT flagged', () => {
  // these resolve per-user, so they are the PORTABLE form — must not error
  assert.ok(!has(scan('cd $HOME/skills'), 'abs-path'));
  assert.ok(!has(scan('cd ${HOME}/skills'), 'abs-path'));
  assert.ok(!has(scan('cd %USERPROFILE%\\skills'), 'abs-path'));
  assert.deepEqual(scan('bash ~/.claude/skills/x/run.sh preview'), []);
});

test('placeholder (v0.1.1): only unfinished markers; API-doc conventions are NOT flagged', () => {
  assert.ok(has(scan('token: <FILL_ME>'), 'placeholder'));
  assert.ok(has(scan('set REPLACE_ME here'), 'placeholder'));
  assert.equal(sev(scan('token: <FILL_ME>'), 'placeholder'), 'error');
  // documentation conventions ("replace this at runtime") must NOT error
  assert.ok(!has(scan('  -H "Authorization: Bearer YOUR_API_KEY"'), 'placeholder'));
  assert.ok(!has(scan('cm reflect --workspace /path/to/project'), 'placeholder'));
  assert.ok(!has(scan('Hatcher-Agent-Name: <your-agent-name>/<version>'), 'placeholder'));
});

test('placeholder: generic <name> template is NOT flagged', () => {
  assert.ok(!has(scan('create `foo_<slug>.md` for the page'), 'placeholder'));
  assert.ok(!has(scan('the file `<name>.md`'), 'placeholder'));
});

test('undeclared-cli (v0.1.1): provider CLI invoked with no install/declare → warn', () => {
  const fs = scan('generate it: `codex exec "make an image"`');
  assert.ok(has(fs, 'undeclared-cli'));
  assert.equal(sev(fs, 'undeclared-cli'), 'warn'); // demoted from error in v0.1.1
});

test('undeclared-cli (v0.1.1): host setup subcommands (mcp/--version/login) are NOT flagged', () => {
  // real-world FP: `claude mcp add` / `codex mcp add` configure the HOST, not a dependency
  assert.ok(!has(scan('`claude mcp add --scope user foo -- npx -y foo`'), 'undeclared-cli'));
  assert.ok(!has(scan('`codex mcp add foo -- npx -y foo`'), 'undeclared-cli'));
  assert.ok(!has(scan('run `claude --version` to check'), 'undeclared-cli'));
});

test('undeclared-cli: suppressed when the CLI is installed in the body', () => {
  const t = [
    '## setup',
    '```bash',
    'npm i -g @openai/codex',
    '```',
    'then run `codex exec "make an image"`',
  ].join('\n');
  assert.ok(!has(scan(t), 'undeclared-cli'));
});

test('undeclared-cli: suppressed when declared in frontmatter requires', () => {
  const t = ['---', 'name: x', 'requires: codex', '---', 'run `codex exec y`'].join('\n');
  assert.ok(!has(scan(t), 'undeclared-cli'));
});

test('undeclared-cli: suppressed via --allow', () => {
  const t = 'run `codex exec y`';
  assert.ok(has(scan(t), 'undeclared-cli'));
  assert.ok(!has(scan(t, { allow: ['codex'] }), 'undeclared-cli'));
});

test('undeclared-cli: prose mention of a provider word is NOT an invocation', () => {
  // "codex" not at a command position → no false positive
  assert.ok(!has(scan('This skill is inspired by the codex approach.'), 'undeclared-cli'));
});

test('undeclared-cli: bare `codex`/`gemini` in backticks is a mention, not an invocation', () => {
  // regression: dogfooding our own AGENTS.md flagged bare provider names listed in prose
  assert.ok(!has(scan('treats `codex` / `gemini` / `claude` / `ollama` equally'), 'undeclared-cli'));
  // but a real work invocation (with a non-meta subcommand) IS flagged
  assert.ok(has(scan('run `codex exec build` first'), 'undeclared-cli'));
});

test('provider-env: raw API-key env → warn', () => {
  const fs = scan('reads OPENAI_API_KEY from the environment');
  assert.ok(has(fs, 'provider-env'));
  assert.equal(sev(fs, 'provider-env'), 'warn');
});

test('todo: TODO:/FIXME: leftover → warn (bare "todo list" is not)', () => {
  assert.ok(has(scan('TODO: fix the output path'), 'todo'));
  assert.ok(has(scan('FIXME: broken'), 'todo'));
  assert.ok(!has(scan('create a todo list for the user'), 'todo'));
});

test('model-id: off by default, on with modelIds → warn', () => {
  const t = 'use `gpt-image-2` and `claude-opus-4-8`';
  assert.ok(!has(scan(t), 'model-id'));
  const fs = scan(t, { modelIds: true });
  assert.ok(has(fs, 'model-id'));
  assert.equal(sev(fs, 'model-id'), 'warn');
});

test('carry-ignore: comment on the line suppresses its findings', () => {
  const withPath = scan('use `C:\\Users\\me\\x` here');
  assert.ok(has(withPath, 'abs-path'));
  const ignored = scan('use `C:\\Users\\me\\x` here <!-- carry-ignore -->');
  assert.ok(!has(ignored, 'abs-path'));
});

test('carry-ignore-next: suppresses the following line', () => {
  const t = ['<!-- carry-ignore-next -->', 'use `C:\\Users\\me\\x`'].join('\n');
  assert.ok(!has(scan(t), 'abs-path'));
});

test('toJson: shape with ok/errors/warnings', () => {
  const results = [{ file: 'a.md', findings: scan('token: <FILL_ME> and ~/x and OPENAI_API_KEY') }];
  const j = toJson(results);
  assert.equal(j.ok, false); // has an error (placeholder)
  assert.ok(j.errors >= 1);
  assert.ok(j.warnings >= 1);
  assert.equal(j.count, j.errors + j.warnings);
  assert.equal(j.findings[0].file, 'a.md');
  assert.ok('severity' in j.findings[0]);
});

test('parseArgs: flags and paths', () => {
  const a = parseArgs(['--strict', '--model-ids', '--allow', 'codex,gemini', 'a.md', 'b/']);
  assert.equal(a.strict, true);
  assert.equal(a.modelIds, true);
  assert.ok(a.allow.has('codex') && a.allow.has('gemini'));
  assert.deepEqual(a.paths, ['a.md', 'b/']);
});

test('parseArgs: --format json and --json', () => {
  assert.equal(parseArgs(['--format', 'json']).asJson, true);
  assert.equal(parseArgs(['--json']).asJson, true);
  assert.equal(parseArgs(['--format=json']).asJson, true);
});

test('findFiles: discovers example SKILL.md files', () => {
  const files = findFiles(['examples']);
  assert.ok(files.some((f) => f.endsWith('good/portable-image-gen/SKILL.md')));
  assert.ok(files.some((f) => f.endsWith('bad/leaky-image-gen/SKILL.md')));
});

test('end-to-end: good example is clean, bad example has errors', () => {
  const good = findFiles(['examples/good']).map((f) => scan(readSafe(f))).flat();
  assert.deepEqual(good, [], 'good example must be fully portable');

  const badFile = findFiles(['examples/bad'])[0];
  const bad = scan(readSafe(badFile));
  assert.ok(bad.filter((f) => f.severity === 'error').length >= 3, 'bad example must raise multiple errors');
  assert.ok(has(bad, 'abs-path') && has(bad, 'undeclared-cli') && has(bad, 'placeholder'));
});

import { readFileSync } from 'node:fs';
function readSafe(f) {
  return readFileSync(f, 'utf8');
}
