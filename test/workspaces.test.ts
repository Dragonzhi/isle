import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../server/store.ts';
import { createApplication } from '../server/main.ts';

async function setup(t: import('node:test').TestContext) {
  const root = path.resolve('.qa');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'workspace-import-'));
  t.after(async () => { assert.equal(path.dirname(directory), root); await fs.rm(directory, { recursive: true, force: true }); });
  const main = path.join(directory, '项目 with spaces');
  await fs.mkdir(main);
  const git = (args: string[]) => execFileSync('git', ['-c', 'user.name=isle', '-c', 'user.email=isle@test', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-C', main, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init']);
  await fs.writeFile(path.join(main, 'TASKS.md'), '\uFEFF# 项目\r\nnext: 保留\r\n');
  git(['add', 'TASKS.md']); git(['commit', '-m', 'base']);
  const child = path.join(directory, '方向 一');
  const detached = path.join(directory, 'detached');
  git(['worktree', 'add', '-b', 'feat/方向', child]);
  git(['worktree', 'add', '--detach', detached]);
  const store = new Store(path.join(directory, 'state'));
  await store.init();
  const board = await store.register({ path: main, name: '项目', installSkill: false, registryHash: (await store.snapshot()).registryHash });
  return { directory, main, child, detached, store, board, id: board.projects[0].id, git };
}

test('listing workspaces is read-only and preserves Unicode paths, detached heads and registration state', async t => {
  const { main, child, detached, store, board, id } = await setup(t);
  const bytes = await fs.readFile(path.join(child, 'TASKS.md'));
  const listed = await store.workspaces(id);
  assert.equal(listed.available, true);
  assert.equal(listed.entries.length, 3);
  assert.equal(listed.entries.find(entry => entry.path === main)?.registered, true);
  assert.equal(listed.entries.find(entry => entry.path === child)?.branch, 'feat/方向');
  assert.equal(listed.entries.find(entry => entry.path === detached)?.branch, '');
  assert.equal((await store.snapshot()).registryHash, board.registryHash);
  await assert.rejects(fs.stat(path.join(child, '.agents')), { code: 'ENOENT' });
  const added = await store.addWorkspace(id, { path: child, registryHash: board.registryHash });
  assert.equal(added.projects.length, 2);
  assert.equal(added.projects.find(project => project.path === child)?.name, '项目 · feat/方向');
  assert.equal(added.projects[0].group, added.projects[1].group);
  assert.deepEqual(await fs.readFile(path.join(child, 'TASKS.md')), bytes);
  assert.equal((await store.skillStatus(child)).state, 'ready');
  await assert.rejects(store.addWorkspace(id, { path: child, registryHash: added.registryHash }), /已经加入/);
});

test('branch listing is read-only and reports the checked-out branch', async t => {
  const { main, child, store, board, id } = await setup(t);
  const listed = await store.branches(id);
  assert.equal(listed.available, true);
  assert.equal(listed.current, 'main');
  assert.deepEqual([...listed.branches].sort(), ['feat/方向', 'main']);
  const bytes = await fs.readFile(path.join(main, 'TASKS.md'));
  const added = await store.addWorkspace(id, { path: child, registryHash: board.registryHash });
  assert.deepEqual(await fs.readFile(path.join(main, 'TASKS.md')), bytes);
  const childId = added.projects.find(project => project.path === child)!.id;
  const childList = await store.branches(childId);
  assert.equal(childList.available, true);
  assert.equal(childList.current, 'feat/方向');
  assert.deepEqual([...childList.branches].sort(), ['feat/方向', 'main']);
  assert.deepEqual(await fs.readFile(path.join(child, 'TASKS.md')), bytes);
  await assert.rejects(store.branches('0'.repeat(24)), /不在清单/);
});

test('branch listing degrades for non-repositories instead of failing', async t => {
  const { directory, store, board } = await setup(t);
  const plain = path.join(directory, 'plain'); await fs.mkdir(plain);
  const added = await store.register({ path: plain, installSkill: false, registryHash: board.registryHash });
  const listed = await store.branches(added.projects.find(project => project.path === plain)!.id);
  assert.equal(listed.available, false);
  assert.equal(listed.current, '');
  assert.deepEqual(listed.branches, []);
  assert.match(listed.reason!, /不是 Git 仓库/);
});

test('workspace import rejects foreign, stale and missing selections; non-repositories degrade', async t => {
  const { directory, child, detached, store, board, id, git } = await setup(t);
  await assert.rejects(store.addWorkspace(id, { path: directory, registryHash: board.registryHash }), /不是该项目/);
  await assert.rejects(store.addWorkspace(id, { path: child, registryHash: 'stale' }), /清单已变化/);
  await assert.rejects(fs.stat(path.join(child, '.agents')), { code: 'ENOENT' });
  git(['worktree', 'lock', child]); // A locked worktree remains usable and selectable.
  assert.equal((await store.workspaces(id)).entries.find(entry => entry.path === child)?.reason, undefined);
  const moved = path.join(directory, 'detached-moved');
  await fs.rename(detached, moved);
  const missing = (await store.workspaces(id)).entries.find(entry => entry.path === detached)!;
  assert.ok(missing.reason);
  await assert.rejects(store.addWorkspace(id, { path: detached, registryHash: board.registryHash }), /不是该项目/);
  const plain = path.join(directory, 'plain'); await fs.mkdir(plain);
  const added = await store.register({ path: plain, installSkill: false, registryHash: board.registryHash });
  assert.equal((await store.workspaces(added.projects.find(project => project.path === plain)!.id)).available, false);
  await assert.rejects(store.workspaces('0'.repeat(24)), /不在清单/);
});

test('workspace endpoints enforce auth, Origin, JSON and current repository membership', async t => {
  const { store, child, id, board, directory } = await setup(t);
  const app = await createApplication({ home: store.home }); t.after(() => app.close());
  const launch = await app.listen(0);
  const origin = new URL(launch).origin;
  const login = await fetch(launch, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const url = origin + `/api/projects/${id}/workspaces`;
  const branchUrl = origin + `/api/projects/${id}/branches`;
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(branchUrl)).status, 401);
  const branches = await (await fetch(branchUrl, { headers: { Cookie: cookie } })).json();
  assert.equal(branches.available, true);
  assert.equal(branches.current, 'main');
  assert.equal((await fetch(url, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await (await fetch(url, { headers })).json()).entries.length, 3);
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ path: directory, registryHash: board.registryHash }) })).status, 409);
  const added = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ path: child, name: '项目 · 方向', installSkill: false, registryHash: board.registryHash }) });
  assert.equal(added.status, 201);
  assert.equal((await added.json()).projects.length, 2);
  await assert.rejects(fs.stat(path.join(child, '.agents')), { code: 'ENOENT' });
});
