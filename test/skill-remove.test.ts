import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../server/store.ts';
import { ADAPTERS } from '../server/adapters.ts';
import { scanMarker } from '../server/marker.ts';

async function fixture(t: import('node:test').TestContext) {
  const root = path.resolve('.qa');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'isle-remove-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), root);
    assert.ok(path.basename(directory).startsWith('isle-remove-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const store = new Store(path.join(directory, 'state'));
  await store.init();
  const project = path.join(directory, '项目 with spaces');
  await fs.mkdir(project);
  return { store, project };
}

test('remove deletes official files and keeps user-edited ones', async t => {
  const { store, project } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;
  const edited = path.join(project, '.claude/skills/isle/SKILL.md');
  await fs.writeFile(edited, '我自己的入口\n');

  const result = await store.removeProjectSkill(id);
  const kept = result.entries.find(item => item.path === '.claude/skills/isle/SKILL.md')!;
  assert.equal(kept.action, 'kept');
  assert.match(kept.reason, /用户已修改/);
  assert.equal(await fs.readFile(edited, 'utf8'), '我自己的入口\n');

  const removed = result.entries.filter(item => item.action === 'removed').map(item => item.path);
  assert.ok(removed.includes('.agents/skills/isle/SKILL.md'));
  assert.ok(removed.includes('.trae/skills/isle/SKILL.md'));
  await assert.rejects(fs.stat(path.join(project, '.agents/skills/isle/SKILL.md')), { code: 'ENOENT' });
});

test('remove never deletes parent directories', async t => {
  const { store, project } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;
  // 父目录里放进用户自己的东西，撤除后必须还在。
  const userSkill = path.join(project, '.claude/skills/我的技能/SKILL.md');
  await fs.mkdir(path.dirname(userSkill), { recursive: true });
  await fs.writeFile(userSkill, '用户自己的 Skill\n');

  await store.removeProjectSkill(id);
  assert.equal(await fs.readFile(userSkill, 'utf8'), '用户自己的 Skill\n');
  for (const directory of ['.agents', '.agents/skills', '.claude', '.claude/skills', '.trae', '.trae/skills', '.zcode', '.zcode/skills']) {
    assert.ok((await fs.stat(path.join(project, directory))).isDirectory(), directory + ' 必须保留');
  }
});

test('remove is idempotent', async t => {
  const { store, project } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;
  const first = await store.removeProjectSkill(id);
  assert.ok(first.counts.removed > 0);
  const second = await store.removeProjectSkill(id);
  assert.equal(second.counts.removed, 0);
  assert.equal(second.counts.skipped + second.counts.kept, ADAPTERS.length);
});

test('plan reports create for everything after a clean remove', async t => {
  const { store, project } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;
  await store.removeProjectSkill(id);

  const plan = await store.planProjectSkill(id);
  for (const entry of plan.entries.filter(item => item.kind !== 'marker')) assert.equal(entry.action, 'create', entry.path);
});

test('remove deletes only the managed block and keeps the rules file', async t => {
  const { store, project } = await fixture(t);
  const rules = Buffer.from('# 我的规则\n\n- 别动。\n');
  const file = path.join(project, 'AGENTS.md');
  await fs.writeFile(file, rules);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;
  await store.setProjectMarker(id, true);
  assert.equal(scanMarker(await fs.readFile(file)).complete, 1);

  const result = await store.removeProjectSkill(id);
  const entry = result.entries.find(item => item.path === 'AGENTS.md')!;
  assert.equal(entry.action, 'removed');
  assert.deepEqual(await fs.readFile(file), rules, '块外必须回到原文');
  assert.equal(scanMarker(await fs.readFile(file)).complete, 0);
});

test('remove keeps a rules file that would be left blank', async t => {
  const { store, project } = await fixture(t);
  const file = path.join(project, 'AGENTS.md');
  await fs.writeFile(file, '临时规则\n');
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;
  await store.setProjectMarker(id, true);

  // 用户把块外的内容删掉了，撤除后只剩空白：保留文件，不替用户删除。
  await fs.writeFile(file, scanMarker(await fs.readFile(file)).complete ? (await fs.readFile(file)).subarray((await fs.readFile(file)).indexOf(Buffer.from('<!-- isle:begin -->'))) : Buffer.alloc(0));
  const result = await store.removeProjectSkill(id);
  const entry = result.entries.find(item => item.path === 'AGENTS.md')!;
  assert.equal(entry.action, 'skipped');
  assert.match(entry.reason, /空白/);
  assert.ok((await fs.stat(file)).isFile(), '文件必须保留');
});

test('remove endpoint returns per-file explanations', async t => {
  const { store, project } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;
  const { createApplication } = await import('../server/main.ts');
  const app = await createApplication({ home: store.home });
  t.after(() => app.close());
  const launch = await app.listen(0);
  const origin = new URL(launch).origin;
  const login = await fetch(launch, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const url = `${origin}/api/projects/${id}/skill`;
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 401);
  assert.equal((await fetch(url, { method: 'DELETE', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const response = await fetch(url, { method: 'DELETE', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.entries) && body.entries.every((item: { reason?: string }) => item.reason));
});
