import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../server/store.ts';
import { ADAPTERS, ENTRY_TEMPLATE } from '../server/adapters.ts';

async function fixture(t: import('node:test').TestContext) {
  const root = path.resolve('.qa');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'isle-targets-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), root);
    assert.ok(path.basename(directory).startsWith('isle-targets-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const store = new Store(path.join(directory, 'state'));
  await store.init();
  const project = path.join(directory, '项目 with spaces');
  await fs.mkdir(project);
  return { store, project, directory };
}

const baseKeys = ADAPTERS.filter(adapter => adapter.required).map(adapter => adapter.key);

test('a new project only gets the base package, without spreading .xxx directories', async t => {
  const { store, project } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;

  const status = await store.projectSkill(id);
  assert.equal(status.state, 'ready');
  assert.deepEqual(status.files.filter(file => file.enabled).map(file => file.key), baseKeys);
  assert.equal(status.counts.ready, baseKeys.length);
  assert.equal(status.counts.disabled, ADAPTERS.length - baseKeys.length);
  for (const name of ['.claude', '.trae', '.zcode']) {
    await assert.rejects(fs.stat(path.join(project, name)), { code: 'ENOENT' }, name + ' 不该被提前创建');
  }
  await fs.stat(path.join(project, '.agents/skills/isle/SKILL.md'));

  const plan = await store.planProjectSkill(id);
  const added = plan.entries.filter(entry => baseKeys.includes(entry.key));
  assert.ok(added.every(entry => entry.action === 'skip'), '基础包已是最新');
  const rest = plan.entries.filter(entry => !baseKeys.includes(entry.key));
  assert.ok(rest.every(entry => entry.action === 'skip' && /未添加|默认不启用/.test(entry.reason)));
});

test('adding a target writes it, removing it cleans up and prunes the empty directory', async t => {
  const { store, project } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;

  const added = await store.setProjectTarget(id, { key: 'zcode-entry', enabled: true });
  assert.equal(added.action, 'added');
  assert.equal(added.skill.files.find(file => file.key === 'zcode-entry')!.state, 'ready');
  assert.deepEqual(await fs.readFile(path.join(project, '.zcode/skills/isle/SKILL.md')), ENTRY_TEMPLATE);

  const removed = await store.setProjectTarget(id, { key: 'zcode-entry', enabled: false });
  assert.equal(removed.action, 'removed');
  assert.match(removed.reason, /官方版本/);
  assert.equal(removed.skill.files.find(file => file.key === 'zcode-entry')!.state, 'disabled');
  await assert.rejects(fs.stat(path.join(project, '.zcode')), { code: 'ENOENT' }, '变空的目录要一并收回');
  assert.equal(removed.skill.state, 'ready');
});

test('removing keeps a user-edited entry and says so', async t => {
  const { store, project } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;
  const entry = path.join(project, '.claude/skills/isle/SKILL.md');
  await store.setProjectTarget(id, { key: 'claude-entry', enabled: true });
  await fs.writeFile(entry, '我自己的入口\n');

  const removed = await store.setProjectTarget(id, { key: 'claude-entry', enabled: false });
  assert.equal(removed.action, 'kept');
  assert.match(removed.reason, /用户已修改/);
  assert.equal(await fs.readFile(entry, 'utf8'), '我自己的入口\n');
  assert.ok((await fs.stat(path.join(project, '.claude'))).isDirectory(), '有用户内容的目录不能删');
});

test('the base package cannot be removed and unknown keys are rejected', async t => {
  const { store, project } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;

  for (const key of baseKeys) await assert.rejects(store.setProjectTarget(id, { key, enabled: false }), { status: 422 });
  await assert.rejects(store.setProjectTarget(id, { key: 'does-not-exist', enabled: true }), { status: 400 });
  await assert.rejects(store.setProjectTarget(id, { key: 'zcode-entry', enabled: 'yes' }), { status: 400 });
  const status = await store.projectSkill(id);
  assert.ok(status.files.filter(file => baseKeys.includes(file.key)).every(file => file.enabled && file.required));
  assert.equal(status.state, 'ready');
});

test('legacy skillMarkers enable both rules files and migrate on the first change', async t => {
  const { store, project, directory } = await fixture(t);
  await fs.writeFile(path.join(project, 'AGENTS.md'), '# 我的规则\n');
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash, installSkill: false });
  const id = snapshot.projects[0].id;
  const settingsFile = path.join(directory, 'state', 'settings.json');
  await fs.writeFile(settingsFile, JSON.stringify({ agents: ['Codex'], model: 'keep-me', skillMarkers: [id] }));

  const status = await store.projectSkill(id);
  assert.equal(status.files.find(file => file.key === 'agents-md')!.enabled, true);
  const claude = status.files.find(file => file.key === 'claude-md')!;
  assert.equal(claude.enabled, true);
  assert.equal(claude.state, 'skipped', '规则文件不存在时不新建');

  const added = await store.setProjectTarget(id, { key: 'zcode-entry', enabled: true });
  assert.equal(added.action, 'added');
  const settings = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
  assert.equal(settings.skillMarkers, undefined, '旧开关迁移后不再保留');
  assert.deepEqual(settings.skillTargets[id], { 'agents-md': true, 'claude-md': true, 'zcode-entry': true });
  assert.deepEqual(settings.agents, ['Codex']);
  assert.equal(settings.model, 'keep-me');
});
