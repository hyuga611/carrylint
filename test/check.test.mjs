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

test('abs-path: /Users/ and /home/ → error, but URL path is ignored', () => {
  assert.ok(has(scan('open /Users/atlan/dev/x.md now'), 'abs-path'));
  assert.ok(has(scan('cd /home/foo/project'), 'abs-path'));
  // URL that merely contains /Users/ must NOT match
  assert.ok(!has(scan('see https://example.com/Users/guide'), 'abs-path'));
});

test('abs-path: $HOME / ${HOME} / %USERPROFILE% → error', () => {
  assert.ok(has(scan('cd $HOME/skills'), 'abs-path'));
  assert.ok(has(scan('cd ${HOME}/skills'), 'abs-path'));
  assert.ok(has(scan('cd %USERPROFILE%\\skills'), 'abs-path'));
});

test('home-path: ~/ → warn (not error)', () => {
  const fs = scan('mv out.png ~/skills/assets/');
  assert.ok(has(fs, 'home-path'));
  assert.equal(sev(fs, 'home-path'), 'warn');
});

test('placeholder: <FILL_ME> / YOUR_API_KEY / path/to/your → error', () => {
  assert.ok(has(scan('token: <FILL_ME>'), 'placeholder'));
  assert.ok(has(scan('replace YOUR_API_KEY here'), 'placeholder'));
  assert.ok(has(scan('read the file at path/to/your/config'), 'placeholder'));
  assert.equal(sev(scan('token: <FILL_ME>'), 'placeholder'), 'error');
});

test('placeholder: generic <name> template is NOT flagged', () => {
  assert.ok(!has(scan('create `foo_<slug>.md` for the page'), 'placeholder'));
  assert.ok(!has(scan('the file `<name>.md`'), 'placeholder'));
});

test('undeclared-cli: provider CLI invoked with no install/declare → error', () => {
  const fs = scan('generate it: `codex exec "make an image"`');
  assert.ok(has(fs, 'undeclared-cli'));
  assert.equal(sev(fs, 'undeclared-cli'), 'error');
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
  // but with an argument it IS an invocation
  assert.ok(has(scan('run `codex login` first'), 'undeclared-cli'));
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
