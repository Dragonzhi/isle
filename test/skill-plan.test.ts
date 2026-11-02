import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../server/store.ts';
import { ADAPTERS } from '../server/adapters.ts';

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

async function fixture(t: import('node:test').TestContext) {
  const root = path.resolve('.qa');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'isle-plan-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), root);
    assert.ok(path.basename(directory).startsWith('isle-plan-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const store = new Store(path.join(directory, 'state'));
  await store.init();
  const project = path.join(directory, '项目 with spaces');
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'TASKS.md'), '# 项目\n\nstatus: 进行中\nnext: 继续\nupdated: 2026-11-02\n\n## 待办\n\n## 进行中\n\n## 已完成\n\n');
  return { store, project, directory };
}

async function tree(directory: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string, prefix: string) {
    for (const item of await fs.readdir(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await walk(path.join(current, item.name), relative);
      else found.push(relative);
    }
  }
  await walk(directory, '');
  return found.sort();
}

test('plan never writes to disk', async t => {
  const { store, project } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash, installSkill: false });
  const id = snapshot.projects[0].id;
  const before = await tree(project);

  const plan = await store.planProjectSkill(id);
  assert.equal(plan.counts.create, ADAPTERS.filter(item => item.kind !== 'marker').length);
  assert.equal(plan.counts.skip, ADAPTERS.filter(item => item.kind === 'marker').length);
  assert.deepEqual(await tree(project), before, '干跑不得产生任何文件');

  let writes = 0;
  const original = store.atomic.bind(store);
  (store as unknown as { atomic: typeof original }).atomic = async (...args: Parameters<typeof original>) => { writes += 1; return original(...args); };
  await store.planProjectSkill(id);
  assert.equal(writes, 0, '干跑不得调用写入');
});

test('plan reports conflict for user-edited files', async t => {
  const { store, project } = await fixture(t);
  const skillFile = path.join(project, '.agents/skills/isle/SKILL.md');
  await fs.mkdir(path.dirname(skillFile), { recursive: true });
  await fs.writeFile(skillFile, '我自己改过的规范\n');
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash, installSkill: false });

  const plan = await store.planProjectSkill(snapshot.projects[0].id);
  const entry = plan.entries.find(item => item.path === '.agents/skills/isle/SKILL.md')!;
  assert.equal(entry.action, 'conflict');
  assert.match(entry.reason, /不会覆盖/);
  assert.equal(await fs.readFile(skillFile, 'utf8'), '我自己改过的规范\n');
});

test('plan separates create, replace and skip', async t => {
  const { store, project } = await fixture(t);
  const older = Buffer.from('# 旧版通用规范\n');
  const file = path.join(project, '.agents/skills/isle/SKILL.md');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, older);

  const plan = await store.planSkill(project, { skill: [sha(older)] });
  const replaced = plan.entries.find(item => item.path === '.agents/skills/isle/SKILL.md')!;
  assert.equal(replaced.action, 'replace');
  assert.match(replaced.reason, /官方旧版/);

  const current = await fs.readFile(new URL('../skills/isle/SKILL.md', import.meta.url));
  await fs.writeFile(file, current);
  const skipped = await store.planSkill(project, { skill: [sha(older)] });
  assert.equal(skipped.entries.find(item => item.path === '.agents/skills/isle/SKILL.md')!.action, 'skip');
});

test('plan describes the marker block actions without touching the file', async t => {
  const { store, project } = await fixture(t);
  const rules = Buffer.from('# 我的规则\n\n- 别动。\n');
  const file = path.join(project, 'AGENTS.md');
  await fs.writeFile(file, rules);

  const before = await store.planSkill(project, undefined, { marker: true });
  const append = before.entries.find(item => item.path === 'AGENTS.md')!;
  assert.equal(append.action, 'append');
  assert.deepEqual(await fs.readFile(file), rules, '计划阶段不得写入规则文件');

  await store.ensureSkill(project, undefined, { marker: true });
  const after = await store.planSkill(project, undefined, { marker: true });
  assert.equal(after.entries.find(item => item.path === 'AGENTS.md')!.action, 'skip');
});

test('plan endpoint requires a registered project and the session', async t => {
  const { store, project } = await fixture(t);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash, installSkill: false });
  const id = snapshot.projects[0].id;
  const { createApplication } = await import('../server/main.ts');
  const app = await createApplication({ home: store.home });
  t.after(() => app.close());
  const launch = await app.listen(0);
  const origin = new URL(launch).origin;
  const login = await fetch(launch, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await fetch(`${origin}/api/projects/${id}/skill/plan`)).status, 401);
  const response = await fetch(`${origin}/api/projects/${id}/skill/plan`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.ok(Array.isArray((await response.json()).entries));
});
