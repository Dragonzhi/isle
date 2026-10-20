import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SummaryMarkdown } from '../src/SummaryMarkdown.ts';
import { Store, decodeBackup } from '../server/store.ts';
import { hash, parseTasks, today, updateNext, updateRecord } from '../server/tasks.ts';
import { createApplication } from '../server/main.ts';
import { closeout, focusTask, handoff } from '../shared/types.ts';

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
  assert.equal((await fetch(origin + '/api/agents', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(origin + '/api/agents', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const agentsSaved = await fetch(origin + '/api/agents', { method: 'PATCH', headers, body: JSON.stringify({ agents: ['Codex', '自定义 Agent'], settingsHash: snapshot.settingsHash }) });
  assert.equal(agentsSaved.status, 200);
  assert.deepEqual((await agentsSaved.json()).agents, ['Codex', '自定义 Agent']);
  assert.equal((await fetch(origin + '/api/agents', { method: 'PATCH', headers, body: JSON.stringify({ agents: ['旧名单'], settingsHash: snapshot.settingsHash }) })).status, 409);
  const added = await fetch(origin + '/api/projects', { method: 'POST', headers, body: JSON.stringify({ path: fixtureData.project, registryHash: snapshot.registryHash }) });
  assert.equal(added.status, 201);
  const board = await added.json();
  assert.equal((await fetch(origin + '/api/projects/' + 'a'.repeat(24), { method: 'PATCH', headers, body: JSON.stringify({ next: 'x', hash: '' }) })).status, 404);
  const saved = await fetch(origin + '/api/projects/' + board.projects[0].id, { method: 'PATCH', headers, body: JSON.stringify({ next: '已接通；下一步测试', hash: board.projects[0].hash }) });
  assert.equal(saved.status, 200);
  const nextSnapshot = await saved.json();
  assert.equal(nextSnapshot.projects[0].next, '已接通；下一步测试');
  const summarySaved = await fetch(origin + '/api/projects/' + board.projects[0].id, {
    method: 'PATCH', headers, body: JSON.stringify({ summary: '已确认：接口可用\n验证：已测试', hash: nextSnapshot.projects[0].hash }),
  });
  assert.equal(summarySaved.status, 200);
  const summarySnapshot = await summarySaved.json();
  assert.equal(summarySnapshot.projects[0].summary, '已确认：接口可用\n验证：已测试');
  assert.equal(summarySnapshot.projects[0].next, '已接通；下一步测试');
  const badSummary = await fetch(origin + '/api/projects/' + board.projects[0].id, {
    method: 'PATCH', headers, body: JSON.stringify({ summary: null, hash: summarySnapshot.projects[0].hash }),
  });
  assert.equal(badSummary.status, 422);
  const repeated = await new Promise<string>((resolve, reject) => {
    execFile(process.execPath, ['server/main.ts'], {
      cwd: path.resolve('.'), timeout: 5000,
      env: { ...process.env, ISLE_HOME: fixtureData.store.home, ISLE_PORT: new URL(origin).port },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  assert.ok(repeated.includes('案屿已在运行'));
  assert.ok(repeated.includes(launch));
});

test('focusTask resolves in-progress before todo, and handoff references it', () => {
  const tasks = [
    { title: '已做完', tags: [], state: '已完成' as const, line: 1, conflict: false },
    { title: '待办任务', tags: ['@trae'], state: '待办' as const, line: 2, conflict: false },
    { title: '进行中任务', tags: ['@codex'], state: '进行中' as const, line: 3, conflict: false },
  ];
  // 优先取进行中任务
  assert.equal(focusTask(tasks)?.title, '进行中任务');
  // 无进行中任务时取待办首项
  assert.equal(focusTask([tasks[0], tasks[1]])?.title, '待办任务');
  // 仅有已完成时返回 undefined
  assert.equal(focusTask([tasks[0]]), undefined);

  // handoff 带上当前任务
  const withTask = handoff({ name: '岛', path: 'D:\\work\\isle', next: '修改未测；下一步验证', tasks });
  assert.ok(withTask.includes('当前任务：进行中任务 @codex'));
  assert.ok(withTask.includes('续接提示：修改未测；下一步验证'));

  // 无聚焦任务时省略当前任务行
  const withoutTask = handoff({ name: '岛', path: 'D:\\work\\isle', next: '修改未测；下一步验证', tasks: [tasks[0]] });
  assert.ok(!withoutTask.includes('当前任务：'));
  assert.ok(withoutTask.includes('续接提示：修改未测；下一步验证'));
});

test('handoff does not assume completion or embed a stale date', () => {
  const text = handoff({ name: '岛', path: 'D:\\work\\isle', next: '修改未测；下一步验证' });
  assert.ok(text.includes('D:\\work\\isle\\TASKS.md'));
  assert.ok(text.includes('部分完成、阻塞或验证失败'));
  assert.ok(text.includes('回写当天'));
  assert.ok(!text.includes(today()));
});

test('handover prose, nested headings and fenced examples never become tasks', () => {
  const summary = '- 已确认：改动位于 src/render.ts\n- [x] 这是交接说明 @codex\n### 验证\n````md\n## 已完成\n```\n- [x] 这是示例\n````';
  const file = Buffer.from(`# 项目\nnext: 修改未测；先验证\nupdated: ${today()}\n\n## 交接摘要\n\n${summary}\n\n## 待办\n- [ ] 真实任务 @trae\n`);
  const parsed = parseTasks(file);
  assert.equal(parsed.summary, summary);
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].title, '真实任务');
  assert.ok(!parsed.warnings.some(warning => warning.includes('分节')));
  assert.equal(parseTasks(Buffer.from('## 交接摘要\n只读记录')).readable, true);
  const duplicate = Buffer.from('# 项目\n## 交接摘要\nA\n## 交接摘要\nB\n');
  assert.equal(parseTasks(duplicate).summary, 'A\n\nB');
  assert.throws(() => updateRecord(duplicate, { summary: 'C' }), /重复/);
});

test('summary edits preserve BOM, CRLF, next and task bytes; malformed boundaries are refused', () => {
  const original = Buffer.from('\uFEFF# 项目\r\nstatus: 暂停\r\nnext：等待验证  \r\nupdated: 2020-01-01\r\n\r\n## 交接摘要\r\n\r\n旧摘要\r\n\r\n## 进行中\r\n- [ ] 原任务  @codex\r\n');
  const summary = '已确认：定位完成\n### 验证\n未验证；下一步跑样例';
  const saved = updateRecord(original, { summary });
  const expected = original.toString().replace('updated: 2020-01-01', `updated: ${today()}`).replace('旧摘要', summary.replace(/\n/g, '\r\n'));
  assert.deepEqual(saved, Buffer.from(expected));
  assert.equal(parseTasks(saved).summary, summary);
  assert.deepEqual(updateRecord(saved, { summary }), saved);
  assert.ok(updateNext(saved, '后续行动').toString().includes(summary.replace(/\n/g, '\r\n')));
  assert.throws(() => updateRecord(original, { summary: '## 已完成\n- [x] 注入' }), /二级分节/);
  assert.throws(() => updateRecord(original, { summary: '```sh\nnpm test' }), /闭合/);
  assert.doesNotThrow(() => updateRecord(original, { summary: '```sh\n# 注释\nnpm test\n```' }));
  const legacy = Buffer.from('# 旧项目\nnext: 保留\n\n## 待办\n- [ ] 任务\n');
  assert.equal(parseTasks(updateRecord(legacy, { summary: '未验证：等待确认' })).tasks.length, 1);
  assert.equal(parseTasks(updateRecord(legacy, { summary: '未验证：等待确认' })).next, '保留');
  const ambiguous = Buffer.from('# 项目\n## 交接摘要\n```\n## 待办\n- [ ] 不可被覆盖\n');
  assert.throws(() => updateRecord(ambiguous, { summary: '替换' }), /未闭合/);
});

test('handover writeback uses the same backup and conflict protection as next edits', async t => {
  const { store, project, file } = await fixture(t);
  let snapshot = await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  const original = await fs.readFile(file);
  const id = snapshot.projects[0].id;
  snapshot = await store.editRecord(id, { summary: '已确认：定位完成\n验证：未验证' }, snapshot.projects[0].hash);
  assert.equal(snapshot.projects[0].summary, '已确认：定位完成\n验证：未验证');
  assert.equal(snapshot.projects[0].next, '');
  assert.deepEqual(decodeBackup(await fs.readFile(file + '.bak'), file), original);
  const recorded = await fs.readFile(file);
  await fs.appendFile(file, '\n外部记录\n');
  const external = await fs.readFile(file);
  await assert.rejects(store.editRecord(id, { summary: '我的草稿' }, hash(recorded)), /其他程序/);
  assert.deepEqual(await fs.readFile(file), external);
});

test('closeout requests explicit writeback and incoming prompt carries facts and the selected goal', () => {
  const project = { name: '棱镜', path: 'D:\\work\\prism', next: '实现已改；下一步验证', summary: '已改 src/render.ts；npm test 未运行' };
  const outgoing = closeout(project);
  assert.ok(outgoing.includes('停止新增工作'));
  assert.ok(outgoing.includes('## 交接摘要'));
  assert.ok(outgoing.includes('没有验证的明确写“未验证”'));
  assert.ok(outgoing.includes('如果无法写文件'));
  const incoming = handoff(project, '样例通过', '只验证现有修改');
  assert.ok(incoming.includes(project.summary));
  assert.ok(incoming.includes('本次目标：只验证现有修改'));
  assert.ok(incoming.includes('完成标准：样例通过'));
  assert.ok(incoming.includes('先读取 D:\\work\\prism\\TASKS.md'));
  assert.ok(incoming.includes('以刚读到的文件为准'));
  assert.ok(!outgoing.includes(today()));
});

test('summary Markdown renders headings, GFM tables, task lists and code without active HTML or image requests', () => {
  const text = [
    '### 验证 **结果**', '', '- [x] 逻辑测试通过', '- [ ] 界面未验证', '',
    '| 项目 | 结果 |', '| --- | --- |', '| 渲染器 | 待验证 |', '',
    '```sh', 'npm test', '```', '', '`src/render.ts` 与 ~~旧结论~~', '',
    '[资料](https://example.com/docs)', '[坏链接](javascript:alert(1))',
    '![示意图](https://example.com/tracker.png)', '<script>alert(1)</script>', '<img src="https://example.com/raw.png" onerror="alert(1)">',
  ].join('\n');
  const html = renderToStaticMarkup(createElement(SummaryMarkdown, { text }));
  assert.ok(html.includes('<h3>验证 <strong>结果</strong></h3>'));
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('type="checkbox"') && html.includes('disabled=""'));
  assert.ok(html.includes('<pre><code class="language-sh">npm test'));
  assert.ok(html.includes('<code>src/render.ts</code>'));
  assert.ok(html.includes('<del>旧结论</del>'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(!html.includes('<script') && !html.includes('javascript:') && !html.includes('onerror'));
  assert.ok(!html.includes('<img') && !html.includes('tracker.png') && !html.includes('raw.png'));
  assert.ok(html.includes('[图片：示意图]'));
});

test('both transfer prompts require task-list maintenance before summary and do not invent tasks', () => {
  const project = { name: '项目', path: 'D:\\work\\project', next: '先验证' };
  for (const prompt of [closeout(project), handoff(project)]) {
    const tasks = prompt.indexOf('一、先维护 ## 待办、## 进行中、## 已完成');
    const summary = prompt.indexOf('二、再在 ## 交接摘要');
    const history = prompt.indexOf('三、在 ## 工作留痕');
    const metadata = prompt.indexOf('四、将 next 更新');
    assert.ok(tasks >= 0 && tasks < summary && summary < history && history < metadata);
    assert.ok(prompt.includes('交接摘要不能替代任务清单'));
    assert.ok(prompt.includes('原来没有任务条目，应按实际结果补入对应分节'));
    assert.ok(prompt.includes('明确留下的下一个行动项也应列入待办'));
    assert.ok(prompt.includes('已有相同任务则更新原条目，不重复新增'));
    assert.ok(prompt.includes('纯讨论且没有新增行动项时可以保持任务清单不变'));
    assert.ok(prompt.includes('不能只更新摘要就宣告收工回写完成'));
    assert.ok(prompt.includes('本次署名尚未指定，请向用户确认'));
    assert.ok(prompt.includes('部分推进也记录'));
    assert.ok(prompt.includes('不能作为实际作者依据'));
    assert.ok(prompt.includes('相同一轮收工不要重复追加'));
    assert.ok(prompt.includes('不要给标题追加日期、署名或其他说明'));
    assert.ok(prompt.includes('继续维护原分节，不另建同名分节'));
  }
  assert.ok(closeout(project, 'OpenCode').includes('本次署名使用“OpenCode”'));
  assert.ok(handoff(project, '', '', 'Trae').includes('本次署名使用“Trae”'));
});

test('contribution history is context, not tasks, and survives unrelated edits byte for byte', () => {
  const history = '- 2026-10-16 · Codex：部分修改；未验证。\r\n- 2026-10-17 · Trae：完成渲染修复；界面验证通过。\r\n### 备注\r\n````md\r\n## 已完成\r\n```\r\n- [x] 示例\r\n````\r\n';
  const original = Buffer.from(`\uFEFF# 项目\r\nnext: 原提示\r\nupdated: 2020-01-01\r\n## 交接摘要\r\n原摘要\r\n## 工作留痕\r\n${history}## 进行中\r\n- [ ] 真实任务 @codex\r\n`);
  const parsed = parseTasks(original);
  assert.equal(parsed.history, history.replace(/\r\n/g, '\n').trimEnd());
  assert.deepEqual(parsed.tasks.map(task => task.title), ['真实任务']);
  assert.ok(!parsed.warnings.some(warning => warning.includes('分节')));
  const saved = updateRecord(original, { next: '新提示', summary: '最新摘要' });
  assert.ok(saved.toString().includes(`## 工作留痕\r\n${history}## 进行中`));
  assert.equal(parseTasks(saved).history, parsed.history);
  assert.equal(parseTasks(Buffer.from('# 旧项目\n## 待办\n- [ ] 保留')).history, '');
  const duplicate = parseTasks(Buffer.from('## 工作留痕\nA\n## 工作留痕\nB\n'));
  assert.equal(duplicate.history, 'A\n\nB');
  assert.ok(duplicate.warnings.some(warning => warning.includes('工作留痕分节重复')));
});

test('agent settings preserve unrelated values, do not expose secrets, and reject stale or invalid writes', async t => {
  const { store } = await fixture(t);
  let snapshot = await store.snapshot();
  assert.deepEqual(snapshot.agents, ['Codex', 'OpenCode', 'Trae']);
  await fs.writeFile(store.settingsFile, JSON.stringify({ key: 'test-secret', model: 'existing', other: { enabled: true } }));
  await assert.rejects(store.saveAgents(['Agent'], snapshot.settingsHash), /设置已变化/);
  snapshot = await store.snapshot();
  assert.ok(!JSON.stringify(snapshot).includes('test-secret'));
  const saved = await store.saveAgents([' Codex ', '自定义 Agent'], snapshot.settingsHash);
  assert.deepEqual(saved.agents, ['Codex', '自定义 Agent']);
  assert.deepEqual(JSON.parse(await fs.readFile(store.settingsFile, 'utf8')), { key: 'test-secret', model: 'existing', other: { enabled: true }, agents: ['Codex', '自定义 Agent'] });
  const bytes = await fs.readFile(store.settingsFile);
  for (const names of [['Codex', 'codex'], ['换行\n名字'], [''], ['格式：不合法'], ['x'.repeat(61)], null]) {
    await assert.rejects(store.saveAgents(names, saved.settingsHash));
    assert.deepEqual(await fs.readFile(store.settingsFile), bytes);
  }
  await store.saveAgents([], saved.settingsHash);
  assert.deepEqual((await store.snapshot()).agents, []);
});

test('bad settings do not hide projects or overwrite the existing file', async t => {
  const { store, project } = await fixture(t);
  await store.register({ path: project, registryHash: (await store.snapshot()).registryHash });
  await fs.writeFile(store.settingsFile, '{broken settings');
  const snapshot = await store.snapshot();
  assert.equal(snapshot.projects[0].state, 'ok');
  assert.equal(snapshot.settingsHash, null);
  assert.ok(snapshot.warnings.some(warning => warning.includes('Agent 名单无法读取')));
  await assert.rejects(store.saveAgents(['Codex'], snapshot.settingsHash), /格式无效/);
  assert.equal(await fs.readFile(store.settingsFile, 'utf8'), '{broken settings');
  await fs.writeFile(store.settingsFile, '');
  await assert.rejects(store.saveAgents(['Codex'], hash('')), /格式无效/);
  assert.equal((await store.snapshot()).settingsHash, null);
});

test('dated context headings are recognized conservatively and never become tasks', () => {
  for (const suffix of ['（2026-10-17）', '(2026-10-17)', ' （ 2026-10-17 ）', ' ( 2026-10-17 ) ##']) {
    const file = Buffer.from(`# 项目\nnext: 保留\nupdated: 2026-10-16\n## 交接摘要${suffix}\n- [x] 摘要里的说明\n\n## 工作留痕${suffix}\n- 2026-10-17 · Codex：部分推进；未验证。\n\n## 进行中\n- [ ] 实际任务 @codex\n`);
    const parsed = parseTasks(file);
    assert.equal(parsed.summary, '- [x] 摘要里的说明');
    assert.equal(parsed.history, '- 2026-10-17 · Codex：部分推进；未验证。');
    assert.deepEqual(parsed.tasks.map(task => task.title), ['实际任务']);
    assert.equal(parsed.updated, '2026-10-16'); // Heading dates do not replace metadata.
    assert.ok(!parsed.warnings.some(warning => warning.includes('分节')));
  }
  for (const title of ['交接摘要说明', '交接摘要（草稿）', '交接摘要（2026-10-17)', '交接摘要 (2026-10-17) 备份']) {
    const parsed = parseTasks(Buffer.from(`## ${title}\n- [ ] 不应被吞掉的任务\n`));
    assert.equal(parsed.summary, '');
    assert.equal(parsed.tasks.length, 1);
    assert.ok(parsed.warnings.some(warning => warning.includes('无法识别')));
  }
});

test('editing a dated summary preserves its heading and rejects duplicate aliases', () => {
  const original = Buffer.from('\uFEFF# 项目\r\nnext: 保留\r\nupdated: 2020-01-01\r\n## 交接摘要（2026-10-17）\r\n\r\n旧摘要\r\n\r\n## 工作留痕 (2026-10-16)\r\n- 保留原始记录\r\n## 待办\r\n- [ ] 保留任务  @trae\r\n');
  assert.deepEqual(updateRecord(original, { summary: '旧摘要' }), original);
  const saved = updateRecord(original, { summary: '新摘要' });
  assert.deepEqual(saved, Buffer.from(original.toString().replace('旧摘要', '新摘要').replace('2020-01-01', today())));
  const duplicate = Buffer.from('## 交接摘要\nA\n## 交接摘要（2026-10-17）\nB\n');
  assert.equal(parseTasks(duplicate).summary, 'A\n\nB');
  assert.ok(parseTasks(duplicate).warnings.some(warning => warning.includes('重复')));
  assert.throws(() => updateRecord(duplicate, { summary: '不可覆盖' }), /重复/);
  const twoDates = Buffer.from('## 交接摘要 (2026-10-16)\nA\n## 交接摘要（2026-10-17）\nB\n');
  assert.throws(() => updateRecord(twoDates, { summary: '不可猜测取最新' }), /重复/);
  const fenced = parseTasks(Buffer.from('## 交接摘要（2026-10-17）\n```md\n## 交接摘要 (2026-10-16)\n- [ ] 示例\n```\n## 待办\n- [ ] 真任务\n'));
  assert.equal(fenced.tasks.length, 1);
  assert.ok(!fenced.warnings.some(warning => warning.includes('重复')));
});


function gitRunner(cwd: string) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', HOME: cwd, USERPROFILE: cwd };
  return (args: string[]) => new Promise<void>((resolve, reject) => execFile('git', ['-c', 'user.name=isle', '-c', 'user.email=isle@test', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env }, (error, _out, stderr) => error ? reject(new Error(String(stderr) || error.message)) : resolve()));
}

test('git history is read-only: a repo lists entries, a non-repo degrades, unknown id 404s', async t => {
  const { directory, store } = await fixture(t);
  const repo = path.join(directory, 'repo');
  await fs.mkdir(repo);
  const git = gitRunner(repo);
  await git(['init']);
  await fs.writeFile(path.join(repo, 'a.txt'), 'one\n');
  await git(['add', '.']);
  await git(['commit', '-m', '首次提交']);
  await fs.writeFile(path.join(repo, 'a.txt'), 'two\n');
  await git(['commit', '-am', '第二次提交']);

  let snapshot = await store.register({ path: repo, registryHash: (await store.snapshot()).registryHash });
  const id = snapshot.projects[0].id;
  const history = await store.gitHistory(id);
  assert.equal(history.available, true);
  assert.ok(history.entries.length >= 2);
  assert.match(history.entries[0].message, /第二次提交/);
  assert.match(history.entries[0].hash, /^[0-9a-f]{7,}$/);
  assert.match(history.entries[0].date, /^\d{4}-\d{2}-\d{2}$/);

  await assert.rejects(store.gitHistory('a'.repeat(24)), /不在清单|刷新/);

  const plain = path.join(directory, 'plain');
  await fs.mkdir(plain);
  snapshot = await store.register({ path: plain, registryHash: snapshot.registryHash });
  const plainHistory = await store.gitHistory(snapshot.projects.find(project => project.path === plain)!.id);
  assert.equal(plainHistory.available, false);
  assert.equal(plainHistory.entries.length, 0);
  assert.ok(plainHistory.reason);
});

test('git history endpoint is a read-only GET behind the same auth', async t => {
  const fixtureData = await fixture(t);
  const app = await createApplication({ home: fixtureData.store.home });
  t.after(() => app.close());
  const launch = await app.listen(0);
  const origin = new URL(launch).origin;
  const login = await fetch(launch, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const repo = fixtureData.project;
  const git = gitRunner(repo);
  await git(['init']);
  await fs.writeFile(path.join(repo, 'TASKS.md'), '# t\nnext: x\n');
  await git(['add', '.']);
  await git(['commit', '-m', 'init']);
  const snapshot = await (await fetch(origin + '/api/projects', { headers: { Cookie: cookie } })).json();
  const added = await fetch(origin + '/api/projects', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: repo, registryHash: snapshot.registryHash }) });
  const board = await added.json();
  const id = board.projects[0].id;
  assert.equal((await fetch(origin + '/api/projects/' + id + '/git')).status, 401);
  assert.equal((await fetch(origin + '/api/projects/' + id + '/git', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  const response = await fetch(origin + '/api/projects/' + id + '/git', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.available, true);
  assert.ok(Array.isArray(body.entries) && body.entries.length >= 1);
  assert.match(body.entries[0].message, /init/);
});

test('worktree grouping derives the main repo and role read-only, degrading when absent', async t => {
  const { directory, store } = await fixture(t);
  const main = path.join(directory, 'QQ-Agent');
  await fs.mkdir(main);
  const git = gitRunner(main);
  await git(['init']);
  await fs.writeFile(path.join(main, 'a.txt'), 'x\n');
  await git(['add', '.']);
  await git(['commit', '-m', 'init']);
  await git(['branch', 'feature/minecraft']);
  const worktree = path.join(directory, 'QQ-Agent-minecraft');
  await git(['worktree', 'add', worktree, 'feature/minecraft']);
  const plain = path.join(directory, 'plain');
  await fs.mkdir(plain);

  let snapshot = await store.snapshot();
  for (const dir of [main, worktree, plain]) snapshot = await store.register({ path: dir, registryHash: snapshot.registryHash });
  const byName = (name: string) => snapshot.projects.find(project => path.basename(project.path) === name)!;
  const mainProject = byName('QQ-Agent'), worktreeProject = byName('QQ-Agent-minecraft'), plainProject = byName('plain');
  assert.equal(mainProject.role, 'main');
  assert.equal(worktreeProject.role, 'worktree');
  assert.equal(typeof mainProject.group, 'string');
  assert.equal(mainProject.group, worktreeProject.group);
  assert.equal(path.basename(mainProject.group!), 'QQ-Agent');
  assert.equal(plainProject.group, undefined);
  assert.equal(plainProject.role, undefined);

  // main repo not registered: the worktree still resolves to the same main repo name
  const other = new Store(path.join(directory, 'state2'));
  await other.init();
  let solo = await other.snapshot();
  solo = await other.register({ path: worktree, registryHash: solo.registryHash });
  assert.equal(solo.projects[0].role, 'worktree');
  assert.equal(path.basename(solo.projects[0].group!), 'QQ-Agent');

  // a .git file that is not a linked-worktree pointer (e.g. submodule) must not group
  const sub = path.join(directory, 'submodule');
  await fs.mkdir(sub);
  await fs.writeFile(path.join(sub, '.git'), 'gitdir: ../.git/modules/submodule\n');
  solo = await other.register({ path: sub, registryHash: solo.registryHash });
  const subProject = solo.projects.find(project => path.basename(project.path) === 'submodule')!;
  assert.equal(subProject.group, undefined);
  assert.equal(subProject.role, undefined);
});

test('worktree grouping rejects submodules inside a linked worktree', async t => {
  const { directory, store } = await fixture(t);
  const main = path.join(directory, 'SubParent');
  const child = path.join(directory, 'sub-child-repo');
  await fs.mkdir(main);
  await fs.mkdir(child);
  const mainGit = gitRunner(main), childGit = gitRunner(child);
  await mainGit(['init']);
  await fs.writeFile(path.join(main, 'a.txt'), 'a\n');
  await mainGit(['add', '.']);
  await mainGit(['commit', '-m', 'init']);
  await mainGit(['branch', 'line']);
  const worktree = path.join(directory, 'SubParent-line');
  await mainGit(['worktree', 'add', worktree, 'line']);
  await childGit(['init']);
  await fs.writeFile(path.join(child, 'c.txt'), 'c\n');
  await childGit(['add', '.']);
  await childGit(['commit', '-m', 'child']);
  const worktreeGit = gitRunner(worktree);
  await worktreeGit(['-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'sub']);
  const submodule = path.join(worktree, 'sub');
  assert.match(await fs.readFile(path.join(submodule, '.git'), 'utf8'), /worktrees[\\/]SubParent-line[\\/]modules[\\/]sub/);

  let snapshot = await store.snapshot();
  snapshot = await store.register({ path: worktree, registryHash: snapshot.registryHash });
  snapshot = await store.register({ path: submodule, registryHash: snapshot.registryHash });
  const subProject = snapshot.projects.find(project => path.basename(project.path) === 'sub')!;
  assert.equal(subProject.role, undefined);
  assert.equal(subProject.group, undefined);
});

test('worktree grouping resolves relative gitdir pointers and win32 case variants', async t => {
  const { directory, store } = await fixture(t);
  const main = path.join(directory, 'RelativeMain');
  await fs.mkdir(main);
  const git = gitRunner(main);
  await git(['init']);
  await fs.writeFile(path.join(main, 'a.txt'), 'a\n');
  await git(['add', '.']);
  await git(['commit', '-m', 'init']);
  const child = path.join(directory, 'relative-child');
  await fs.mkdir(child);
  await fs.writeFile(path.join(child, '.git'), 'gitdir: ../RelativeMain/.git/worktrees/relative-child\n');

  let snapshot = await store.snapshot();
  snapshot = await store.register({ path: main, registryHash: snapshot.registryHash });
  snapshot = await store.register({ path: child, registryHash: snapshot.registryHash });
  const mainProject = snapshot.projects.find(project => path.basename(project.path) === 'RelativeMain')!;
  const childProject = snapshot.projects.find(project => path.basename(project.path) === 'relative-child')!;
  assert.equal(childProject.role, 'worktree');
  assert.equal(childProject.group, mainProject.group);

  if (process.platform === 'win32') {
    const caseChild = path.join(directory, 'case-child');
    await fs.mkdir(caseChild);
    await fs.writeFile(path.join(caseChild, '.git'), 'gitdir: ' + main.toLowerCase() + '/.git/worktrees/case-child\n');
    snapshot = await store.register({ path: caseChild, registryHash: snapshot.registryHash });
    const caseProject = snapshot.projects.find(project => path.basename(project.path) === 'case-child')!;
    assert.equal(caseProject.group, mainProject.group);
  }
});
