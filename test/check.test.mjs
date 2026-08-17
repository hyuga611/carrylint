import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, parseArgs, toJson, findFiles } from '../src/check.mjs';

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
  const fs = scan('Save to `C:\\Users\\alice\\Downloads\\out.png`.');
  assert.ok(has(fs, 'abs-path'));
  assert.equal(sev(fs, 'abs-path'), 'error');
});

test('abs-path: /Users/<name>/ and /home/<name>/ → error, but URL path is ignored', () => {
  assert.ok(has(scan('open /Users/alice/dev/x.md now'), 'abs-path'));
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

// YAML で複数の依存を書けば普通はブロックリストになる。そこを読めていなかったので、
// 依存をきちんと宣言したスキルほど誤検知していた（v0.3.1 で修正）。
test('undeclared-cli: suppressed when declared as a YAML block list', () => {
  for (const key of ['requires', 'allowed-tools', 'dependencies']) {
    const t = ['---', 'name: x', `${key}:`, '  - codex', '  - gemini', '---',
      'run `codex exec y` then `gemini -p z`'].join('\n');
    assert.ok(!has(scan(t), 'undeclared-cli'), key);
  }
});

// ブロックリストは次のキーで終わる。終わらないと無関係なリスト項目まで宣言扱いになり、
// 今度は本物の undeclared-cli を見逃す。
test('undeclared-cli: a block list ends at the next frontmatter key', () => {
  const t = ['---', 'requires:', '  - gemini', 'tags:', '  - codex', '---',
    'run `codex exec y`'].join('\n');
  assert.ok(has(scan(t), 'undeclared-cli'));
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

// --- gui-path (0.4.0) ---
// 出どころ: dev.to のコメント。「~/Desktop に保存」はヘッドレスでも壊れるのに、
// ~ を可搬として除外した v0.1.1 以降は素通りしていた（可搬な接頭辞 + 無いかもしれない先）。

test('gui-path: home-relative desktop destinations → warn', () => {
  for (const t of [
    'take a screenshot and save it to `~/Desktop/shot.png`',
    'read every file in $HOME/Desktop/screenshots/',
    'move it to %USERPROFILE%\\Downloads\\out.png',
    'the capture lands in ~/Pictures/Screenshots/',
  ]) {
    const fs = scan(t);
    assert.ok(has(fs, 'gui-path'), `expected gui-path for: ${t}`);
    assert.equal(sev(fs, 'gui-path'), 'warn');
  }
});

test('gui-path: portable home paths and relative paths stay silent', () => {
  assert.ok(!has(scan('bash ~/.claude/skills/x/run.sh'), 'gui-path'));
  assert.ok(!has(scan('write to `./out/img.png`'), 'gui-path'));
  assert.ok(!has(scan('save to "$XDG_PICTURES_DIR/shot.png"'), 'gui-path'));
  // 「Desktop」の語そのものは対象でない。ホーム直下の保存先として書かれたときだけ。
  assert.ok(!has(scan('open the Desktop app and sign in'), 'gui-path'));
});

test('gui-path: an author-specific desktop path is reported once, as abs-path', () => {
  // C:\Users\alice\Desktop は既に error。同じ行を warn で二重に出さない。
  const fs = scan('save to C:\\Users\\alice\\Desktop\\out.png');
  assert.ok(has(fs, 'abs-path'));
  assert.ok(!has(fs, 'gui-path'));
});

// --- gui-cli (0.4.0) ---

test('gui-cli: capture binaries need a display → warn', () => {
  const fs = scan('run `screencapture -x out.png`');
  assert.ok(has(fs, 'gui-cli'));
  assert.equal(sev(fs, 'gui-cli'), 'warn');
  assert.ok(has(scan(['```bash', 'scrot shot.png', '```'].join('\n')), 'gui-cli'));
});

test('gui-cli: declaring or installing it does not silence the warning', () => {
  // undeclared-cli とは別物。入っていても画面が無ければ動かない。
  const t = ['---', 'requires:', '  - flameshot', '---',
    '```bash', 'brew install flameshot', 'flameshot gui --path ./out', '```'].join('\n');
  const fs = scan(t);
  assert.ok(has(fs, 'gui-cli'));
  assert.ok(!has(fs, 'undeclared-cli'));
});

test('gui-cli: bare mentions and version checks are not invocations', () => {
  assert.ok(!has(scan('we use `flameshot` on Linux'), 'gui-cli'));
  assert.ok(!has(scan('run `screencapture --version` first'), 'gui-cli'));
});

// --- unverified-write (0.4.0) ---
// 静的解析に「その手順が実際は何もしなかった」は見えない。見えるのは
// 「書き換えたのに読み直す場所がどこにも無い」という形だけ。

test('unverified-write: an external write with no read-back → warn, once per file', () => {
  const t = ['1. deploy:', '```bash', 'git push origin main', 'npm publish', '```'].join('\n');
  const fs = scan(t);
  assert.equal(fs.filter((f) => f.kind === 'unverified-write').length, 1);
  assert.equal(sev(fs, 'unverified-write'), 'warn');
  assert.equal(fs.find((f) => f.kind === 'unverified-write').ln, 3); // 最初の書き込み行
});

test('unverified-write: any read-back anywhere in the file silences it', () => {
  for (const tail of [
    'Then verify the tag is live.',
    'Re-fetch the release and compare.',
    '```sql\nSELECT count(*) FROM rows;\n```',
    '公開後に本番URLを再取得して実在を確認する。',
    'Check the published version afterwards.',
  ]) {
    const t = ['```bash', 'git push origin main', '```', tail].join('\n');
    assert.ok(!has(scan(t), 'unverified-write'), `should stay silent with: ${tail}`);
  }
});

test('unverified-write: SQL mutations count, local file work does not', () => {
  assert.ok(has(scan('run `INSERT INTO posts VALUES (1)`'), 'unverified-write'));
  assert.ok(has(scan('run `UPDATE posts SET title = "x"`'), 'unverified-write'));
  assert.ok(!has(scan('```bash\nmkdir -p ./out\nmv a.png ./out/\n```'), 'unverified-write'));
});

test('unverified-write: carry-ignore on the write line suppresses it', () => {
  const t = 'run `git push origin main` <!-- carry-ignore -->';
  assert.ok(!has(scan(t), 'unverified-write'));
});

// publish 直前のクロスレビュー（別モデル）で出た誤検知。禁止を明記した AGENTS.md ほど
// 警告される形で、0.3.1 の undeclared-cli（宣言した人ほど刺さる）と同型だった。
test('unverified-write: 「やるな」と書いてある行は手順ではない', () => {
  for (const t of [
    'Never run `git push --force` from this skill.',
    '- Do not `npm publish` unless explicitly asked.',
    'エージェントが勝手に `git push` してはいけない。',
  ]) {
    assert.ok(!has(scan(t), 'unverified-write'), `禁止の行を手順と数えた: ${t}`);
  }
});

// 禁止語を含まない「いつやってよいか」の方針文。0.4.0 では手順として数えていた。
// fence の中は実行するコマンドの並びなので、この除外は当てない（本物を落とさないため）。
test('unverified-write: 「〜のときだけ」の方針文は手順ではない', () => {
  for (const t of [
    '- `git push` は明示の指示があるときだけ。',
    '- `npm publish` はレビューの承認後のみ。',
    'Only run `git push` when the user asks.',
    '`npm publish` requires approval from a maintainer.',
  ]) {
    assert.ok(!has(scan(t), 'unverified-write'), `方針文を手順と数えた: ${t}`);
  }
  // 同じ語がコードブロックの中にあるだけなら、手順であることは変わらない
  assert.ok(has(scan('```bash\ngit push origin main   # main のみ\n```'), 'unverified-write'));
});

test('unverified-write: 散文の言及は手順ではない（コード文脈でだけ数える）', () => {
  assert.ok(!has(scan('After that we push to git and publish to npm.'), 'unverified-write'));
  assert.ok(has(scan('run `npm publish` last'), 'unverified-write'));
});

test('unverified-write: carry-ignore した行の読み直しは黙らせる側に回らない', () => {
  const fence = (l) => ['```bash', l, '```'].join('\n');
  const ignored = `${fence('git push origin main')}\nverify it landed. <!-- carry-ignore -->`;
  const normal = `${fence('git push origin main')}\nverify it landed.`;
  assert.ok(has(scan(ignored), 'unverified-write'), '無効化した行が黙らせる側に回っている');
  assert.ok(!has(scan(normal), 'unverified-write'));
});

test('gui-cli: --allow では黙らない（在ることにしても画面は生えない）', () => {
  const t = 'run `flameshot gui --path ./out`';
  assert.ok(has(scan(t, { allow: ['flameshot'] }), 'gui-cli'));
});

// リンタは他人の任意のファイルの全行に当たるので、1行が長いだけで固まってはいけない。
// scp/rsync の書き込み判定は当初 `[^\n]*\s\S+@\S+:` で、@ を多く含み : を含まない行に
// 対して総当たりになっていた（2万文字77ms → 4万文字312ms の二乗）。CI を止める形。
test('unverified-write: 長い1行でも総当たりにならない', () => {
  const pathological = `rsync ${'a@'.repeat(40000)}`; // 8万文字・一致しそうで一致しない
  const t = process.hrtime.bigint();
  scan(pathological);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 200, `1行の走査に ${ms.toFixed(0)}ms かかった（総当たりの疑い）`);
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
