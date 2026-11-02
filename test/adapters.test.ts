import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../server/store.ts';
import { ADAPTERS, ENTRY_TEMPLATE, migrateHistory, type Adapter } from '../server/adapters.ts';

async function fixture(t: import('node:test').TestContext) {
  const root = path.resolve('.qa');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'isle-adapters-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), root);
    assert.ok(path.basename(directory).startsWith('isle-adapters-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const store = new Store(path.join(directory, 'state'));
  await store.init();
  const project = path.join(directory, '项目 with spaces');
  await fs.mkdir(project);
  return { store, project };
}

// 临时往表里加一条探针适配器，用完必须移除：表是全局常量。
function probe(t: import('node:test').TestContext, adapter: Adapter) {
  ADAPTERS.push(adapter);
  t.after(() => {
    const index = ADAPTERS.indexOf(adapter);
    if (index >= 0) ADAPTERS.splice(index, 1);
  });
  return adapter;
}

test('adapters have unique keys and normalized project-relative paths', () => {
  assert.ok(ADAPTERS.length >= 4);
  const keys = ADAPTERS.map(adapter => adapter.key);
  assert.equal(new Set(keys).size, keys.length, 'keys must be unique');
  for (const adapter of ADAPTERS) {
    assert.match(adapter.key, /^[a-z0-9-]+$/, adapter.key + ' must be a lowercase slug');
    assert.ok(adapter.agent.trim(), adapter.key + ' must name its agent');
    for (const value of [adapter.path, adapter.detect].filter((item): item is string => Boolean(item))) {
      assert.ok(value.length > 0, adapter.key + ' path must not be empty');
      assert.ok(!value.startsWith('./'), adapter.key + ' path must not start with ./');
      assert.ok(!value.startsWith('/') && !/^[A-Za-z]:/.test(value), adapter.key + ' path must be project-relative');
      assert.ok(!value.includes('\\'), adapter.key + ' path must use forward slashes');
      assert.ok(!value.split('/').includes('..'), adapter.key + ' path must not escape the project');
      assert.equal(value.split('/').filter(Boolean).join('/'), value, adapter.key + ' path must not repeat separators');
      assert.equal(path.normalize(value).split(path.sep).join('/'), value, adapter.key + ' path must already be normalized');
    }
  }
});

test('unverified adapters are excluded from install unless enabled', async t => {
  const { store, project } = await fixture(t);
  const adapter = probe(t, {
    agent: 'Probe',
    key: 'probe-unverified',
    path: '.probe/skills/isle/SKILL.md',
    kind: 'entry',
    evidence: 'unverified',
    template: 'entry',
  });
  const file = path.join(project, adapter.path);

  const skipped = await store.ensureSkill(project);
  assert.equal(skipped.files.find(item => item.path === adapter.path)!.state, 'unverified');
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  // 未启用的候选落点不能把已装好的项目从「就绪」打成「部分」。
  const inactive = ADAPTERS.filter(item => !item.detect || item.kind !== 'marker');
  const ready = ADAPTERS.filter(item => item.kind !== 'marker' && item.evidence !== 'unverified').length;
  assert.equal(skipped.state, 'ready');
  assert.equal(skipped.counts.ready, ready);
  // 受管区块默认关，算 skipped；证据不足的那条算 unverified。
  assert.equal(skipped.counts.skipped, ADAPTERS.length - ready - 1);
  assert.equal(skipped.counts.unverified, 1);
  assert.ok(inactive.length > 0);

  const enabled = await store.ensureSkill(project, undefined, { enabled: [adapter.key] });
  assert.equal(enabled.files.find(item => item.path === adapter.path)!.state, 'ready');
  assert.deepEqual(await fs.readFile(file), ENTRY_TEMPLATE);
  assert.equal(enabled.state, 'ready');
});

test('marker adapters are registered but not written in v0.1', async t => {
  const { store, project } = await fixture(t);
  const adapter = probe(t, {
    agent: 'Probe',
    key: 'probe-marker',
    path: 'AGENTS.md',
    kind: 'marker',
    evidence: 'docs',
    template: 'marker',
    note: '受管区块',
  });
  await fs.writeFile(path.join(project, adapter.path), '用户自己的规则\n');
  // 开关默认关：只登记、不写入。
  const status = await store.ensureSkill(project);
  const file = status.files.find(item => item.path === adapter.path)!;
  assert.equal(file.state, 'skipped');
  assert.equal(file.kind, 'marker');
  assert.match(file.message ?? '', /未开启/);
  // 没打开开关时，连用户已有文件的一个字节都不碰。
  assert.equal(await fs.readFile(path.join(project, adapter.path), 'utf8'), '用户自己的规则\n');
});

test('history keys migrate from legacy names without downgrading ready projects', async t => {
  const { store, project } = await fixture(t);
  const crypto = await import('node:crypto');
  const sha = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');
  const current = await fs.readFile(new URL('../skills/isle/SKILL.md', import.meta.url));
  const older = Buffer.from('# 旧版通用规范\n\n按旧预算回写。\n');
  const legacy = { skill: [sha(older)], metadata: [], entry: [] };
  const file = path.join(project, '.agents/skills/isle/SKILL.md');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, older);

  // 旧键命中的文件是官方旧版，不是「用户自有」。
  assert.equal((await store.skillStatus(project, legacy)).state, 'outdated');
  assert.equal((await store.ensureSkill(project, legacy)).state, 'ready');
  assert.deepEqual(await fs.readFile(file), current);

  // 已经是当前模板的项目保持就绪，不因键改名被误判。
  assert.equal((await store.skillStatus(project, legacy)).state, 'ready');
  assert.equal((await store.skillStatus(project)).state, 'ready');
});

test('legacy entry hashes feed both entrypoints', () => {
  const entry = 'b'.repeat(64);
  const skill = 'a'.repeat(64);
  const migrated = migrateHistory({ entry: [entry], skill: [skill], metadata: [], 'trae-entry': ['c'.repeat(64)] });
  assert.deepEqual(migrated['claude-entry'], [entry]);
  // 旧 entry 键由两个入口共用，迁移后两边都要拿到；已是新键的条目不能被覆盖。
  assert.deepEqual(migrated['trae-entry'], ['c'.repeat(64), entry]);
  assert.deepEqual(migrated['agents-skill'], [skill]);
  assert.equal(migrated.entry, undefined);
  assert.equal(migrated.skill, undefined);
});
