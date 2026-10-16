import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { Store, decodeBackup } from '../server/store.ts';
import { hash, parseTasks, today, updateNext } from '../server/tasks.ts';
import { createApplication } from '../server/main.ts';
import { handoff } from '../shared/types.ts';

async function fixture(t: import('node:test').TestContext) {
  const testRoot = path.resolve('.qa');
  await fs.mkdir(testRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(testRoot, 'isle-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), testRoot);
    assert.ok(path.basename(directory).startsWith('isle-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const store = new Store(path.join(directory, 'state'));
  await store.init();
  const project = path.join(directory, 'project');
  await fs.mkdir(project);
  return { directory, store, project, file: path.join(project, 'TASKS.md') };
}

test('dirty Markdown stays visible and task status follows checkboxes', () => {
  const samples = [
    '# 项目\nnext: 待验证', '# 全角\nstatus：暂停\nnext：材料已交；等待回复',
    '# CRLF\r\nnext: 继续\r\n', '\uFEFF# BOM\nnext: 继续\n',
    '## 随便一节\n- [ ] 标题 @codex', '## 进行中\n- 没有复选框', '',
    '纯垃圾文本', '# 只有标题', '# 日期\nupdated: 十月十五日',
  ];
  samples.forEach(text => assert.doesNotThrow(() => parseTasks(Buffer.from(text))));
  assert.equal(parseTasks(Buffer.from('纯垃圾文本')).readable, false);
  assert.equal(parseTasks(Buffer.from('')).readable, true);
  assert.equal(parseTasks(Buffer.from(samples[1])).status, '暂停');
  const result = parseTasks(Buffer.from('# A\n## 待办\n- [x] 已经做完 @codex @trae\n## 已完成\n- [ ] 尚未完成\n## 进行中\n- 联系 a@b.com 再说\n```md\n- [x] 代码例子不算\n```\n'));
  assert.equal(result.tasks.length, 3);
  assert.equal(result.tasks[0].state, '已完成');
  assert.deepEqual(result.tasks[0].tags, ['@codex', '@trae']);
  assert.equal(result.tasks[1].state, '待办');
  assert.equal(result.tasks[2].title, '联系 a@b.com 再说');
  assert.equal(result.tasks[2].state, '进行中');
  assert.ok(result.tasks[0].conflict && result.tasks[1].conflict);
  assert.equal(parseTasks(Buffer.from('# 日期\nupdated: 2026-02-30')).estimated, true);
});

test('next edits preserve BOM, CRLF, unknown content and no-op bytes', () => {
  const original = Buffer.from('\uFEFF# 项目\r\n\r\nstatus：进行中\r\nnext：旧提示\r\nupdated: 2020-01-01\r\nextra: 不改\r\n\r\n## 待办\r\n- [x] 外部修改，不整理  @codex\r\n');
  const expected = Buffer.from(original.toString().replace('next：旧提示', 'next：已改未测；下一步验证').replace('updated: 2020-01-01', `updated: ${today()}`));
  assert.deepEqual(updateNext(original, '已改未测；下一步验证'), expected);
  assert.deepEqual(updateNext(original, '旧提示'), original);
  assert.throws(() => updateNext(original, '不准\n注入: 字段'));
  assert.throws(() => updateNext(Buffer.from('next: A\nnext: B'), 'C'), /重复/);
  const missing = updateNext(Buffer.from('# 项目\n\n## 待办\n- [ ] 保留\n'), '继续');
  assert.equal(parseTasks(missing).next, '继续');
  assert.ok(missing.toString().endsWith('## 待办\n- [ ] 保留\n'));
});

test('adding existing files is byte-preserving; invalid registry lines do not hide other entries', async t => {
  const { store, project, file } = await fixture(t);
  const original = Buffer.from('\uFEFF# 已存在\r\nnext：原样保留\r\n');
  await fs.writeFile(file, original);
  let snapshot = await store.snapshot();
  snapshot = await store.register({ path: project, name: '真实项目', registryHash: snapshot.registryHash });
  assert.equal(snapshot.projects.length, 1);
  assert.deepEqual(await fs.readFile(file), original);
  await assert.rejects(store.register({ path: project, registryHash: snapshot.registryHash }), /已经/);
  await fs.appendFile(store.registryFile, '乱码\n# 注释\n');
  snapshot = await store.snapshot();
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.warnings.length, 1);
  await fs.rename(project, project + '-moved');
  snapshot = await store.snapshot();
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].state, 'offline');
  snapshot = await store.register({ path: project + '-moved', replaceId: snapshot.projects[0].id, registryHash: snapshot.registryHash });
  assert.equal(snapshot.projects[0].state, 'ok');
  assert.deepEqual(await fs.readFile(path.join(project + '-moved', 'TASKS.md')), original);
});

test('ten dirty files and a non-UTF8 file all remain on the board', async t => {
  const { directory, store } = await fixture(t);
  const samples = ['# 标题', 'next: 下一步', '# 全角\nnext：继续', '# CRLF\r\n', '\uFEFF# BOM', '## 其他\n- [ ] 活', '## 进行中\n- 活', '', '纯垃圾', 'updated: 中文日期', Buffer.from([0xff, 0xfe, 0xff])];
  let snapshot = await store.snapshot();
  for (let i = 0; i < samples.length; i++) {
    const dir = path.join(directory, `dirty-${i}`);
    await fs.mkdir(dir); await fs.writeFile(path.join(dir, 'TASKS.md'), samples[i]);
    snapshot = await store.register({ path: dir, registryHash: snapshot.registryHash });
  }
  assert.equal(snapshot.projects.length, samples.length);
  assert.equal(snapshot.projects.filter(project => project.state === 'error').length, 2);
});

test('safe writes back up the previous bytes, detect conflicts, and leave unrelated files untouched', async t => {
  const { store, project, file } = await fixture(t);
  let snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const original = await fs.readFile(file);
  await fs.writeFile(path.join(project, 'README.md'), 'do not touch');
  const id = snapshot.projects[0].id;
  snapshot = await store.editNext(id, '定位完成；下一步验证', snapshot.projects[0].hash);
  assert.deepEqual(decodeBackup(await fs.readFile(file + '.bak'), file), original);
  const firstEdit = await fs.readFile(file);
  snapshot = await store.editNext(id, '验证通过；下一步提交', snapshot.projects[0].hash);
  assert.deepEqual(decodeBackup(await fs.readFile(file + '.bak'), file), firstEdit);
  const current = await fs.readFile(file);
  const backup = await fs.readFile(file + '.bak');
  snapshot = await store.editNext(id, snapshot.projects[0].next, snapshot.projects[0].hash);
  assert.deepEqual(await fs.readFile(file), current);
  assert.deepEqual(await fs.readFile(file + '.bak'), backup);
  await fs.appendFile(file, '\n外部新增\n');
  const external = await fs.readFile(file);
  await assert.rejects(store.editNext(id, '不应覆盖', snapshot.projects[0].hash), /其他程序修改/);
  assert.deepEqual(await fs.readFile(file), external);
  assert.equal(await fs.readFile(path.join(project, 'README.md'), 'utf8'), 'do not touch');
  assert.ok(!(await fs.readdir(project)).some(file => file.endsWith('.tmp')));
});

test('an unknown backup or a change during save prevents replacement', async t => {
  const { store, project, file } = await fixture(t);
  let snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const original = await fs.readFile(file);
  await fs.writeFile(file + '.bak', '用户自己的备份');
  await assert.rejects(store.editNext(snapshot.projects[0].id, '下一步', snapshot.projects[0].hash), /无法确认为/);
  assert.deepEqual(await fs.readFile(file), original);
  await fs.unlink(file + '.bak');
  const atomic = store.atomic.bind(store);
  store.atomic = async (target, content, check) => {
    if (target === file) await fs.appendFile(file, '\n并发变更\n');
    return atomic(target, content, check);
  };
  await assert.rejects(store.editNext(snapshot.projects[0].id, '下一步', snapshot.projects[0].hash), /保存期间/);
  assert.ok((await fs.readFile(file, 'utf8')).endsWith('并发变更\n'));
  assert.ok(!(await fs.readdir(project)).some(name => name.endsWith('.tmp')));
});

test('links and hardlinks are rejected rather than followed', async t => {
  const { store, project, directory, file } = await fixture(t);
  const outside = path.join(directory, 'other.md');
  await fs.writeFile(outside, '# Outside\nnext: 不许改\n');
  await fs.link(outside, file);
  let snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  assert.equal(snapshot.projects[0].state, 'error');
  await assert.rejects(store.editNext(snapshot.projects[0].id, '不许改', hash(await fs.readFile(outside))));
  await fs.unlink(file);
  if (process.platform === 'win32') {
    const junction = path.join(directory, 'linked-project');
    await fs.symlink(project, junction, 'junction');
    await assert.rejects(store.register({ path: junction, registryHash: snapshot.registryHash }), /符号链接|联接/);
  }
  try { await fs.symlink(outside, file, 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { t.diagnostic('Windows 未授予文件符号链接权限；硬链接防护已验证。'); return; } throw error; }
  snapshot = await store.snapshot();
  assert.equal(snapshot.projects[0].state, 'error');
  assert.equal(await fs.readFile(outside, 'utf8'), '# Outside\nnext: 不许改\n');
});

test('HTTP requires authentication, exact origin/host and JSON; only registered projects may be edited', async t => {
  const fixtureData = await fixture(t);
  const app = await createApplication({ home: fixtureData.store.home });
  t.after(() => app.close());
  const launch = await app.listen(0);
  const origin = new URL(launch).origin;
  const login = await fetch(launch, { redirect: 'manual' });
  assert.equal(login.status, 303);
  assert.ok(login.headers.get('set-cookie')?.includes('HttpOnly; SameSite=Strict'));
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await fetch(origin + '/api/projects')).status, 401);
  assert.equal((await fetch(origin + '/api/projects', { headers: { Cookie: cookie, Origin: 'https://evil.example' } })).status, 403);
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
  assert.equal((await fetch(origin + '/api/projects', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(origin + '/api/projects', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const invalidHost = await new Promise<number>(resolve => {
    const req = http.get(origin + '/api/projects', { headers: { Host: 'evil.example', Cookie: cookie } }, res => { resolve(res.statusCode!); res.resume(); }); req.on('error', () => resolve(0));
  });
  assert.equal(invalidHost, 403);
  assert.equal((await fetch(origin + '/_instance')).status, 403);
  const snapshot = await (await fetch(origin + '/api/projects', { headers: { Cookie: cookie } })).json();
  const added = await fetch(origin + '/api/projects', { method: 'POST', headers, body: JSON.stringify({ path: fixtureData.project, registryHash: snapshot.registryHash }) });
  assert.equal(added.status, 201);
  const board = await added.json();
  assert.equal((await fetch(origin + '/api/projects/' + 'a'.repeat(24), { method: 'PATCH', headers, body: JSON.stringify({ next: 'x', hash: '' }) })).status, 404);
  const saved = await fetch(origin + '/api/projects/' + board.projects[0].id, { method: 'PATCH', headers, body: JSON.stringify({ next: '已接通；下一步测试', hash: board.projects[0].hash }) });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).projects[0].next, '已接通；下一步测试');
  const repeated = await new Promise<string>((resolve, reject) => {
    execFile(process.execPath, ['server/main.ts'], {
      cwd: path.resolve('.'), timeout: 5000,
      env: { ...process.env, ISLE_HOME: fixtureData.store.home, ISLE_PORT: new URL(origin).port },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  assert.ok(repeated.includes('案屿已在运行'));
  assert.ok(repeated.includes(launch));
});

test('handoff does not assume completion or embed a stale date', () => {
  const text = handoff({ name: '岛', path: 'D:\\work\\isle', next: '修改未测；下一步验证' });
  assert.ok(text.includes('D:\\work\\isle\\TASKS.md'));
  assert.ok(text.includes('部分完成、阻塞或验证失败'));
  assert.ok(text.includes('回写当天'));
  assert.ok(!text.includes(today()));
});
