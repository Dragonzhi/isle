import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../server/store.ts';
import { createApplication } from '../server/main.ts';
import { skillTransfer } from '../shared/types.ts';

async function fixture(t: import('node:test').TestContext) {
  const root = path.resolve('.qa');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'isle-skill-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), root);
    assert.ok(path.basename(directory).startsWith('isle-skill-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const store = new Store(path.join(directory, 'state'));
  await store.init();
  const project = path.join(directory, '项目 with spaces');
  await fs.mkdir(project);
  return { store, project, directory, file: path.join(project, 'TASKS.md') };
}

test('import installs project skill and native entrypoints without changing existing project records or rules', async t => {
  const { store, project, file } = await fixture(t);
  const original = Buffer.from('\uFEFF# 项目\r\nnext: 继续\r\n## 待办\r\n- [ ] 保留\r\n');
  await fs.writeFile(file, original);
  await fs.writeFile(path.join(project, 'AGENTS.md'), '原有规则\n');
  await fs.writeFile(path.join(project, 'CLAUDE.md'), '其他团队约定\n');
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const status = await store.projectSkill(snapshot.projects[0].id);
  assert.equal(status.state, 'ready');
  assert.equal(status.files.length, 4);
  assert.deepEqual(await fs.readFile(file), original);
  assert.equal(await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8'), '原有规则\n');
  assert.equal(await fs.readFile(path.join(project, 'CLAUDE.md'), 'utf8'), '其他团队约定\n');
  const canonical = await fs.readFile(path.join(project, status.files[0].path));
  assert.deepEqual(canonical, await fs.readFile(new URL('../skills/isle/SKILL.md', import.meta.url)));
  for (const item of status.files.filter(item => item.path.startsWith('.claude/') || item.path.startsWith('.trae/'))) {
    const entry = await fs.readFile(path.join(project, item.path), 'utf8');
    const link = entry.match(/\]\(([^)]+)\)/)![1];
    assert.equal(path.resolve(path.dirname(path.join(project, item.path)), link), path.join(project, status.files[0].path));
  }
  const before = await Promise.all(status.files.map(async item => (await fs.stat(path.join(project, item.path))).mtimeMs));
  assert.equal((await store.installProjectSkill(snapshot.projects[0].id)).state, 'ready');
  assert.deepEqual(await Promise.all(status.files.map(async item => (await fs.stat(path.join(project, item.path))).mtimeMs)), before);
});

test('opt-out keeps import read-only for skill paths; existing projects can fill missing entries without overwriting edits', async t => {
  const { store, project, file } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash, installSkill: false });
  const id = snapshot.projects[0].id;
  const original = await fs.readFile(file);
  assert.equal((await store.projectSkill(id)).state, 'missing');
  await assert.rejects(fs.stat(path.join(project, '.agents')), { code: 'ENOENT' });
  const installed = await store.installProjectSkill(id);
  assert.equal(installed.state, 'ready');
  const claude = path.join(project, '.claude/skills/isle/SKILL.md');
  await fs.writeFile(claude, '手工定制入口\n');
  const trae = path.join(project, '.trae/skills/isle/SKILL.md');
  await fs.unlink(trae);
  const filled = await store.installProjectSkill(id);
  assert.equal(filled.state, 'partial');
  assert.equal(filled.files.find(file => file.path.startsWith('.claude/'))!.state, 'custom');
  assert.equal(await fs.readFile(claude, 'utf8'), '手工定制入口\n');
  assert.ok((await fs.readFile(trae, 'utf8')).includes('../../../.agents/skills/isle/SKILL.md'));
  assert.deepEqual(await fs.readFile(file), original);
  await assert.rejects(store.installProjectSkill('a'.repeat(24)), /不在清单/);
});

test('a custom canonical skill is preserved and not adopted by new entrypoints', async t => {
  const { store, project } = await fixture(t);
  const skillFile = path.join(project, '.agents/skills/isle/SKILL.md');
  await fs.mkdir(path.dirname(skillFile), { recursive: true });
  await fs.writeFile(skillFile, '用户自己的同名 Skill\r\n');
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  assert.equal(snapshot.projects[0].state, 'ok');
  assert.ok(snapshot.warnings.some(warning => warning.includes('Skill')));
  assert.equal((await store.projectSkill(snapshot.projects[0].id)).state, 'custom');
  assert.equal(await fs.readFile(skillFile, 'utf8'), '用户自己的同名 Skill\r\n');
  await assert.rejects(fs.stat(path.join(project, '.claude')), { code: 'ENOENT' });
});

test('skill installation rejects linked paths and does not write outside the project', async t => {
  const { store, project, directory } = await fixture(t);
  const outside = path.join(directory, 'outside');
  await fs.mkdir(outside);
  if (process.platform === 'win32') {
    await fs.symlink(outside, path.join(project, '.agents'), 'junction');
  } else {
    await fs.symlink(outside, path.join(project, '.agents'), 'dir');
  }
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  assert.equal(snapshot.projects[0].state, 'ok');
  const status = await store.projectSkill(snapshot.projects[0].id);
  assert.equal(status.state, 'error');
  assert.deepEqual(await fs.readdir(outside), []);
  const plain = path.join(directory, 'plain');
  const skillFile = path.join(plain, '.agents/skills/isle/SKILL.md');
  await fs.mkdir(path.dirname(skillFile), { recursive: true });
  const other = path.join(directory, 'other-skill.md');
  await fs.writeFile(other, '不可覆盖');
  await fs.link(other, skillFile);
  const second = await store.register({ path: plain, registryHash: snapshot.registryHash });
  assert.equal((await store.projectSkill(second.projects.find(item => item.path === plain)!.id)).state, 'error');
  assert.equal(await fs.readFile(other, 'utf8'), '不可覆盖');
});

test('skill API requires a registered project, authentication, origin and JSON', async t => {
  const { store, project, file } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash, installSkill: false });
  const id = snapshot.projects[0].id;
  const original = await fs.readFile(file);
  const app = await createApplication({ home: store.home });
  t.after(() => app.close());
  const launch = await app.listen(0);
  const origin = new URL(launch).origin;
  const login = await fetch(launch, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const url = origin + `/api/projects/${id}/skill`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
  assert.equal((await (await fetch(url, { headers })).json()).state, 'missing');
  assert.equal((await (await fetch(url, { method: 'POST', headers, body: '{}' })).json()).state, 'ready');
  assert.equal((await fetch(origin + '/api/projects/' + 'a'.repeat(24) + '/skill', { method: 'POST', headers, body: '{}' })).status, 404);
  assert.deepEqual(await fs.readFile(file), original);
});

test('short instructions carry scope and caller choices, without embedding the writeback protocol', () => {
  const project = { name: '案屿', path: 'D:\\项目 with spaces', next: '旧提示', summary: '不应复制的长摘要' };
  const close = skillTransfer(project, 'close', 'Codex');
  assert.ok(close.length < 400 && close.includes(project.path));
  assert.ok(close.includes('署名：Codex') && close.includes('.agents/skills/isle/SKILL.md'));
  assert.ok(close.includes('不新增实现、补跑验证或提交代码'));
  assert.ok(!close.includes(project.summary) && !close.includes('## 已完成'));
  const start = skillTransfer(project, 'start', 'OpenCode', '只读核对', '检查交接是否一致');
  assert.ok(start.includes('检查交接是否一致') && start.includes('只读核对') && start.includes('署名：OpenCode'));
  assert.ok(skillTransfer(project, 'close').includes('先向我确认'));
});
