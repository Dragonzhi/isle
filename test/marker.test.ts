import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../server/store.ts';
import { createApplication } from '../server/main.ts';
import { MARKER_BEGIN, MARKER_END, installMarker, markerBlock, removeMarker, scanMarker } from '../server/marker.ts';

const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');

async function fixture(t: import('node:test').TestContext) {
  const root = path.resolve('.qa');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'isle-marker-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), root);
    assert.ok(path.basename(directory).startsWith('isle-marker-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const store = new Store(path.join(directory, 'state'));
  await store.init();
  const project = path.join(directory, '项目 with spaces');
  await fs.mkdir(project);
  return { store, project, directory };
}

const rules = Buffer.from('# 我的规则\n\n1. 先读 README。\n2. 提交信息用中文。\n');

test('marker block is appended to an existing rules file without touching user content', async t => {
  const { store, project } = await fixture(t);
  const file = path.join(project, 'AGENTS.md');
  await fs.writeFile(file, rules);

  const status = await store.ensureSkill(project, undefined, { marker: true });
  assert.equal(status.state, 'ready');
  const marker = status.files.find(item => item.path === 'AGENTS.md')!;
  assert.equal(marker.state, 'ready');

  const after = await fs.readFile(file);
  assert.deepEqual(after.subarray(0, rules.length), rules, '块外字节必须原样保留');
  assert.equal(after.subarray(rules.length).toString('utf8'), '\n' + markerBlock('\n'));
  assert.equal(scanMarker(after).complete, 1);
});

test('marker block replaces only its own region on reinstall', async t => {
  const { store, project } = await fixture(t);
  const file = path.join(project, 'CLAUDE.md');
  const tail = Buffer.from('## 我的补充\n\n- 别动这一段。\n');
  await fs.writeFile(file, Buffer.concat([rules, tail]));

  await store.ensureSkill(project, undefined, { marker: true });
  const once = await fs.readFile(file);
  const user = Buffer.concat([rules, tail]);
  assert.ok(once.subarray(0, user.length).equals(user), '用户内容整体保留在块前');
  assert.deepEqual(once.subarray(user.length), Buffer.from('\n' + markerBlock('\n')));
  const before = await fs.stat(file);

  await store.ensureSkill(project, undefined, { marker: true });
  const twice = await fs.readFile(file);
  assert.deepEqual(twice, once, '重装必须幂等');
  assert.equal(scanMarker(twice).complete, 1);
  assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs, '块内没变时不该重写文件');

  // 用户在块后又写了一段：重装只能替换块内，块两侧都不动。
  const trailing = Buffer.from('## 块后补充\n\n- 这段也要留着。\n');
  await fs.writeFile(file, Buffer.concat([once, trailing]));
  await store.ensureSkill(project, undefined, { marker: true });
  const after = await fs.readFile(file);
  assert.equal(scanMarker(after).complete, 1);
  assert.ok(after.subarray(0, user.length).equals(user), '块前内容不变');
  assert.ok(after.subarray(after.length - trailing.length).equals(trailing), '块后内容不变');
  assert.equal(after.subarray(user.length, after.length - trailing.length).toString('utf8'), '\n' + markerBlock('\n'), '块内仍是固定内容');
});

test('incomplete markers block the write and report an error', async t => {
  const { store, project } = await fixture(t);
  const file = path.join(project, 'AGENTS.md');
  const broken = Buffer.from(`# 规则\n\n${MARKER_BEGIN}\n只有开头没有结尾\n`);
  await fs.writeFile(file, broken);

  const status = await store.ensureSkill(project, undefined, { marker: true });
  const marker = status.files.find(item => item.path === 'AGENTS.md')!;
  assert.equal(marker.state, 'error');
  assert.match(marker.message ?? '', /标记不完整/);
  assert.equal(status.state, 'error');
  assert.deepEqual(await fs.readFile(file), broken, '不完整时一个字都不能猜着改');

  // end 在 begin 之前同样算不完整。
  const reversed = Buffer.from(`${MARKER_END}\n${MARKER_BEGIN}\n`);
  assert.equal(scanMarker(reversed).broken, true);
  assert.ok('error' in installMarker(reversed));
});

test('duplicate marker blocks collapse to one with a warning', async t => {
  const { store, project } = await fixture(t);
  const file = path.join(project, 'AGENTS.md');
  const twice = Buffer.concat([rules, Buffer.from('\n'), Buffer.from(markerBlock()), Buffer.from('\n'), Buffer.from(markerBlock())]);
  await fs.writeFile(file, twice);

  const before = await store.skillStatus(project, undefined, { marker: true });
  assert.match(before.files.find(item => item.path === 'AGENTS.md')!.message ?? '', /收敛/);

  const result = installMarker(twice);
  assert.ok(!('error' in result) && result.warning);
  assert.match((result as { warning?: string }).warning ?? '', /收敛/);
  assert.equal(scanMarker((result as { data: Buffer }).data).complete, 1);

  await store.ensureSkill(project, undefined, { marker: true });
  const after = await fs.readFile(file);
  assert.equal(scanMarker(after).complete, 1);
  assert.deepEqual(after.subarray(0, rules.length), rules);
});

test('remove deletes only the managed block and the separator it added', async t => {
  const { store, project } = await fixture(t);
  const file = path.join(project, 'AGENTS.md');
  await fs.writeFile(file, rules);

  await store.ensureSkill(project, undefined, { marker: true });
  assert.equal(scanMarker(await fs.readFile(file)).complete, 1);

  const removed = removeMarker(await fs.readFile(file));
  assert.ok(!('error' in removed));
  assert.deepEqual((removed as { data: Buffer }).data, rules, '撤除后必须回到原文逐字节一致');
});

test('BOM and CRLF are preserved across install and remove', async t => {
  const { store, project } = await fixture(t);
  const file = path.join(project, 'AGENTS.md');
  const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# 规则\r\n\r\n内容\r\n')]);
  await fs.writeFile(file, original);

  await store.ensureSkill(project, undefined, { marker: true });
  const installed = await fs.readFile(file);
  assert.deepEqual(installed.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]), 'BOM 必须保留');
  assert.ok(!/(^|[^\r])\n/.test(installed.toString('utf8').replace(/\r\n/g, '')), '不能混入裸 LF');

  const removed = removeMarker(installed);
  assert.deepEqual((removed as { data: Buffer }).data, original, 'BOM 与 CRLF 撤除后仍逐字节一致');
});

test('foreign marker blocks such as recap:begin coexist untouched', async t => {
  const { store, project } = await fixture(t);
  const file = path.join(project, 'AGENTS.md');
  const foreign = '<!-- recap:begin -->\n## 收尾规则\n- 每轮两行状态。\n<!-- recap:end -->\n';
  const original = Buffer.from(`# 规则\n\n${foreign}`);
  await fs.writeFile(file, original);

  await store.ensureSkill(project, undefined, { marker: true });
  const installed = await fs.readFile(file);
  assert.ok(installed.includes(Buffer.from(foreign)), '别的工具的受管区块必须原样保留');
  assert.equal(scanMarker(installed).complete, 1);

  const removed = removeMarker(installed);
  assert.deepEqual((removed as { data: Buffer }).data, original);
});

test('concurrent edit during install is rejected with 409', async t => {
  const { store, project } = await fixture(t);
  const file = path.join(project, 'AGENTS.md');
  await fs.writeFile(file, rules);
  const expected = digest(await fs.readFile(file));
  const patched = installMarker(await fs.readFile(file)) as { data: Buffer };

  // 用户在这中间用编辑器改了文件：写回必须停手，不能覆盖。
  const edited = Buffer.from('# 用户刚改过的规则\n');
  await fs.writeFile(file, edited);
  await assert.rejects(store.publishGuarded(file, patched.data, expected), { status: 409 });
  assert.deepEqual(await fs.readFile(file), edited);
});

test('missing rules file is skipped instead of created', async t => {
  const { store, project } = await fixture(t);
  const status = await store.ensureSkill(project, undefined, { marker: true });
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const marker = status.files.find(item => item.path === name)!;
    assert.equal(marker.state, 'skipped');
    assert.match(marker.message ?? '', /不存在/);
    await assert.rejects(fs.stat(path.join(project, name)), { code: 'ENOENT' });
  }
});

test('the switch is off by default, persists in settings.json and never deletes on close', async t => {
  const { store, project, directory } = await fixture(t);
  const file = path.join(project, 'AGENTS.md');
  await fs.writeFile(file, rules);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;

  assert.equal((await store.projectSkill(id)).marker, false);
  assert.equal(scanMarker(await fs.readFile(file)).complete, 0);

  const enabled = await store.setProjectMarker(id, true);
  assert.equal(enabled.marker, true);
  assert.equal(scanMarker(await fs.readFile(file)).complete, 1);
  const settings = JSON.parse(await fs.readFile(path.join(directory, 'state', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.skillMarkers, [id]);

  const disabled = await store.setProjectMarker(id, false);
  assert.equal(disabled.marker, false);
  assert.equal(scanMarker(await fs.readFile(file)).complete, 1, '关闭开关不删用户文件里的区块');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'state', 'settings.json'), 'utf8')).skillMarkers, []);
});

test('marker switch endpoint enforces auth, origin and JSON like install', async t => {
  const { store, project } = await fixture(t);
  await fs.writeFile(path.join(project, 'AGENTS.md'), rules);
  const snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;
  const app = await createApplication({ home: store.home });
  t.after(() => app.close());
  const launch = await app.listen(0);
  const origin = new URL(launch).origin;
  const login = await fetch(launch, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const url = origin + `/api/projects/${id}/skill`;
  assert.equal((await fetch(url, { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"marker":true}' })).status, 403);
  assert.equal((await fetch(url, { method: 'PATCH', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'text/plain' }, body: '{"marker":true}' })).status, 415);
  assert.equal((await fetch(url, { method: 'PATCH', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{"marker":"yes"}' })).status, 400);
  const response = await fetch(url, { method: 'PATCH', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{"marker":true}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).marker, true);
});
