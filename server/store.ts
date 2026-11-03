import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { BranchList, GitHistory, Project, ProjectSkill, SkillAction, SkillFile, SkillPlan, SkillPlanEntry, SkillRemoval, SkillRemovalResult, SkillTargetResult, Snapshot, Workspace, Workspaces } from '../shared/types.ts';
import type { Adapter, SkillOptions, SkillTargets } from './adapters.ts';
import { ADAPTERS, adapterEnabled, loadedAdapters, markerTargets, migrateHistory, skillReport } from './adapters.ts';
import { installMarker, isBlank, removeMarker, scanMarker } from './marker.ts';
import { hash, parseTasks, template, updateRecord, updateTask } from './tasks.ts';

const runGit = promisify(execFile);

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function code(error: unknown) { return (error as NodeJS.ErrnoException).code; }
function pathKey(value: string) { return process.platform === 'win32' ? value.toLowerCase() : value; }

// Read-only: derive the worktree group from the project's .git entry. A .git directory marks
// a repo root (its own group); a .git file is a linked worktree pointing at
// <main>/.git/worktrees/<name>, so it groups under that main repo. Never runs git.
async function gitGroup(directory: string) {
  const entry = path.join(directory, '.git');
  let info;
  try { info = await fs.lstat(entry); } catch { return undefined; }
  if (info.isDirectory()) return { group: path.normalize(directory), role: 'main' as const };
  if (!info.isFile()) return undefined;
  if (info.size > 4096) return undefined;
  let text: string;
  try { text = await fs.readFile(entry, 'utf8'); } catch { return undefined; }
  const match = text.match(/^\s*gitdir:\s*(.+?)\s*$/mi);
  if (!match) return undefined;
  let target: string;
  try { target = path.isAbsolute(match[1]) ? match[1] : path.resolve(directory, match[1]); } catch { return undefined; }
  const parts = path.normalize(target).split(path.sep);
  const count = parts.length;
  // Anchor at the end: only <main>/.git/worktrees/<name> is a linked worktree. A submodule
  // inside a worktree points at .../worktrees/<wt>/modules/<name> and must not be grouped.
  if (count < 3 || parts[count - 2] !== 'worktrees' || parts[count - 3] !== '.git') return undefined;
  const main = parts.slice(0, count - 3).join(path.sep);
  if (!main) return undefined;
  let group = path.normalize(main);
  try { group = path.normalize(await fs.realpath(group)); } catch { /* main repo unreachable: keep derived path */ }
  return { group, role: 'worktree' as const };
}
function projectId(value: string) { return hash(pathKey(path.normalize(value))).slice(0, 24); }

export async function noLinks(target: string) {
  const resolved = path.resolve(target);
  let current = path.parse(resolved).root;
  for (const component of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const info = await fs.lstat(current);
      if (info.isSymbolicLink()) throw new AppError('路径包含符号链接或目录联接，已拒绝访问。', 403);
    } catch (error) {
      if (code(error) === 'ENOENT') return;
      throw error;
    }
  }
}

async function readRegular(file: string) {
  await noLinks(file);
  const info = await fs.lstat(file);
  if (!info.isFile() || info.nlink > 1) throw new AppError('目标必须是普通文件，不能是链接、目录或硬链接。', 403);
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (info.ino !== opened.ino || info.dev !== opened.dev) throw new AppError('读取时文件发生变化，请刷新。', 409);
    return { data: await handle.readFile(), info: opened };
  } finally { await handle.close(); }
}

// Opening a folder is navigation, not a project operation: the directory is already registered and
// validated, and no shell interprets it. Windows Explorer exits with code 1 even when the window
// opens, so success is measured by the process spawning, not by its exit code.
export function directoryInvocation(directory: string, platform: NodeJS.Platform = process.platform) {
  if (platform === 'win32') return { command: 'explorer.exe', args: [directory] };
  if (platform === 'darwin') return { command: 'open', args: [directory] };
  return { command: 'xdg-open', args: [directory] };
}

function openDirectory(directory: string) {
  return new Promise<void>((resolve, reject) => {
    const { command, args } = directoryInvocation(directory);
    // Never pass windowsHide here: on Windows it reaches the GUI process as SW_HIDE, so Explorer
    // opens the folder window invisible and the user sees nothing. Explorer has no console to hide.
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', () => reject(new AppError('无法调用系统文件管理器，请手动打开这个目录。', 500)));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

export async function validateDirectory(input: unknown) {
  if (typeof input !== 'string' || !input.trim() || /[\r\n\t\0]/.test(input)) throw new AppError('请填写有效的本机绝对目录路径。');
  input = input.trim();
  if (!path.isAbsolute(input as string) || /^[/\\]{2}/.test(input as string)) throw new AppError('只支持本机绝对路径，不支持相对路径或网络共享。');
  const resolved = path.resolve(input as string);
  await noLinks(resolved);
  const info = await fs.stat(resolved).catch(() => { throw new AppError('目录不存在或无法读取，请检查路径。'); });
  if (!info.isDirectory()) throw new AppError('这个路径是文件，请填写项目目录。');
  const real = await fs.realpath(resolved);
  if (pathKey(path.normalize(real)) !== pathKey(path.normalize(resolved))) throw new AppError('路径重定向到了其他位置，已拒绝访问。', 403);
  return real;
}

type Entry = { id: string; path: string; name: string; line: number };
type Registry = { data: Buffer; entries: Entry[]; lines: string[]; warnings: string[] };
const backupFormat = 'isle-task-backup-v1';

const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');

// Published template hashes. A file whose bytes match a published version is an official
// older copy and may be upgraded; anything else is treated as user-owned and left alone.
async function skillHistory(): Promise<Record<string, string[]>> {
  try {
    const raw = JSON.parse((await fs.readFile(new URL('../skills/isle/history.json', import.meta.url))).toString('utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      result[key] = value.filter((item): item is string => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item));
    }
    return migrateHistory(result);
  } catch { return {}; }
}

export function decodeBackup(data: Buffer, target: string) {
  try {
    const saved = JSON.parse(data.toString('utf8'));
    if (saved.format !== backupFormat || pathKey(saved.target) !== pathKey(target) || typeof saved.content !== 'string') throw 0;
    const content = Buffer.from(saved.content, 'base64');
    if (hash(content) !== saved.sha256) throw 0;
    return content;
  } catch { throw new AppError('已有 TASKS.md.bak 无法确认为案屿备份。请先将它另存，再重试；原文件未修改。', 409); }
}

export class Store {
  home: string;
  registryFile: string;
  settingsFile: string;
  private readonly revealDirectory: (directory: string) => Promise<void>;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(home: string, revealDirectory: (directory: string) => Promise<void> = openDirectory) {
    this.home = path.resolve(home);
    this.revealDirectory = revealDirectory;
    this.registryFile = path.join(this.home, 'projects.txt');
    this.settingsFile = path.join(this.home, 'settings.json');
  }

  // ponytail: one write queue is sufficient for a local single-user board; split only if measured contention appears.
  write<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action, action);
    this.pending = result.catch(() => {});
    return result;
  }

  async init() {
    await noLinks(this.home);
    await fs.mkdir(this.home, { recursive: true });
    await noLinks(this.home);
  }

  async registry(): Promise<Registry> {
    let data = Buffer.alloc(0);
    try { data = (await readRegular(this.registryFile)).data; }
    catch (error) { if (code(error) !== 'ENOENT') throw error; }
    const lines = data.toString('utf8').split(/\r?\n/);
    const entries: Entry[] = [], warnings: string[] = [], seen = new Set<string>();
    lines.forEach((raw, line) => {
      const text = raw.replace(/^\uFEFF/, '');
      if (!text.trim() || text.trimStart().startsWith('#')) return;
      const parts = text.split('\t');
      const directory = parts[0].trim();
      if (parts.length > 2 || !path.isAbsolute(directory) || /^[/\\]{2}/.test(directory) || /[\0\r\uFFFD]/.test(text)) {
        warnings.push(`清单第 ${line + 1} 行格式无效，已跳过；其他项目照常显示。`); return;
      }
      const normalized = path.resolve(directory);
      const key = pathKey(normalized);
      if (seen.has(key)) { warnings.push(`清单第 ${line + 1} 行路径重复，已跳过。`); return; }
      seen.add(key);
      entries.push({ id: projectId(normalized), path: normalized, name: parts[1]?.trim() || path.basename(normalized) || normalized, line });
    });
    return { data, entries, lines, warnings };
  }

  async project(entry: Entry): Promise<Project> {
    const base: Project = { ...entry, state: 'ok', status: '进行中', next: '', summary: '', history: '', updated: '', estimated: false, age: 0, hash: '', tasks: [], warnings: [] };
    let directory: string;
    try {
      directory = await validateDirectory(entry.path);
    } catch (error) {
      return { ...base, state: code(error) === 'EACCES' ? 'error' : 'offline', error: (error as Error).message };
    }
    const git = await gitGroup(directory);
    const head: Project = git ? { ...base, ...git } : base;
    try {
      const { data, info } = await readRegular(path.join(entry.path, 'TASKS.md'));
      const parsed = parseTasks(data, info.mtime);
      return { ...head, ...parsed, hash: hash(data), state: parsed.readable ? 'ok' : 'error',
        error: parsed.readable ? undefined : '文件可读，但未识别到标题、字段或任务。请在原文件中修正。' };
    } catch (error) {
      let message = error instanceof Error ? error.message : '无法读取文件。';
      if (code(error) === 'ENOENT') message = '项目中缺少 TASKS.md。请恢复文件，或重新指向这个目录以生成模板。';
      if (error instanceof TypeError) message = 'TASKS.md 不是有效的 UTF-8 文件，请在编辑器中另存为 UTF-8。';
      return { ...head, state: 'error', error: message };
    }
  }

  async snapshot(): Promise<Snapshot> {
    const registry = await this.registry();
    const projects = await Promise.all(registry.entries.map(entry => this.project(entry)));
    projects.sort((a, b) => Number(a.status === '已完成') - Number(b.status === '已完成') || b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name, 'zh-CN'));
    let agents: string[] = [], settingsHash: string | null = null;
    try {
      const settings = await this.settings();
      agents = this.agentNames(settings.value.agents ?? ['Codex', 'OpenCode', 'Trae']);
      settingsHash = hash(settings.data);
    } catch {
      registry.warnings.push('Agent 名单无法读取，请检查 settings.json 的格式和访问权限；项目记录仍可使用。');
    }
    return { projects, warnings: registry.warnings, registryHash: hash(registry.data), agents, settingsHash };
  }

  // Read-only git history for the detail page. Never writes to the project; runs git with an args array (no shell),
  // a hard timeout, and gc disabled so nothing in .git is modified. Merge commits are skipped: the trace in
  // TASKS.md already carries the workflow/PR narrative, so this list stays a compact check of real changes.
  async gitHistory(id: string): Promise<GitHistory> {
    const entry = (await this.registry()).entries.find(item => item.id === id);
    if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
    let directory: string;
    try { directory = await validateDirectory(entry.path); }
    catch (error) { return { available: false, reason: (error as Error).message, entries: [] }; }
    // Treat the directory as a repo only if it is itself a repo root/worktree (has its own .git); never walk up to an unrelated parent repo.
    let ownsGit = false;
    try { await fs.lstat(path.join(directory, '.git')); ownsGit = true; }
    catch (error) { if (code(error) !== 'ENOENT') return { available: false, reason: '无法读取该目录。', entries: [] }; }
    if (!ownsGit) return { available: false, reason: '这个目录自身不是 Git 仓库（找不到 .git）。', entries: [] };
    try {
      const { stdout } = await runGit('git', ['-c', 'gc.auto=0', '--no-pager', '-C', directory, 'log', '--no-merges', '-n', '40', '--date=short', '--pretty=format:%h%x1f%ad%x1f%s'], { timeout: 6000, maxBuffer: 1024 * 1024, windowsHide: true });
      const entries = String(stdout).split('\n').map(line => line.replace(/\r$/, '')).filter(Boolean).map(line => {
        const [hash, date, ...rest] = line.split('\x1f');
        return { hash, date, message: rest.join('\x1f') };
      });
      return { available: true, entries };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: string | Buffer; killed?: boolean };
      if (failure.code === 'ENOENT') return { available: false, reason: '未找到 git，请先安装并加入 PATH。', entries: [] };
      if (failure.killed) return { available: false, reason: '读取 git 历史超时。', entries: [] };
      const stderr = String(failure.stderr ?? '');
      if (/not a git repository/i.test(stderr)) return { available: false, reason: '这个目录自身不是 Git 仓库（找不到 .git）。', entries: [] };
      if (/does not have any commits yet/i.test(stderr)) return { available: true, reason: '仓库还没有任何提交。', entries: [] };
      return { available: false, reason: stderr.split('\n')[0] || '无法读取 git 历史。', entries: [] };
    }
  }

  // Read-only local branch list for the "create workspace" prompt's base-branch selector.
  // Runs git on demand only (same boundary as workspaces), never writes, and degrades to a
  // freely editable value when the directory is not a repo or git is unavailable.
  async branches(id: string): Promise<BranchList> {
    const entry = (await this.registry()).entries.find(item => item.id === id);
    if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
    let directory: string;
    try { directory = await validateDirectory(entry.path); }
    catch (error) { return { available: false, reason: (error as Error).message, current: '', branches: [] }; }
    try { await fs.lstat(path.join(directory, '.git')); }
    catch (error) {
      const reason = code(error) === 'ENOENT' ? '这个目录自身不是 Git 仓库（找不到 .git）。' : '无法读取该目录。';
      return { available: false, reason, current: '', branches: [] };
    }
    try {
      const { stdout } = await runGit('git', ['-c', 'gc.auto=0', '--no-optional-locks', '--no-pager', '-C', directory, 'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%1f%(HEAD)', 'refs/heads'], { timeout: 6000, maxBuffer: 1024 * 1024, windowsHide: true });
      const rows = String(stdout).split('\n').map(line => line.replace(/\r$/, '')).filter(Boolean).map(line => {
        const [name, head] = line.split('\x1f');
        return { name, current: (head ?? '').trim() === '*' };
      }).filter(row => row.name);
      return { available: true, current: rows.find(row => row.current)?.name ?? '', branches: rows.map(row => row.name) };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: string | Buffer; killed?: boolean };
      if (failure.code === 'ENOENT') return { available: false, reason: '未找到 git，请先安装并加入 PATH。', current: '', branches: [] };
      if (failure.killed) return { available: false, reason: '读取分支超时。', current: '', branches: [] };
      if (/not a git repository/i.test(String(failure.stderr ?? ''))) return { available: false, reason: '这个目录自身不是 Git 仓库（找不到 .git）。', current: '', branches: [] };
      return { available: false, reason: '无法读取分支列表，请检查 Git 版本或目录权限。', current: '', branches: [] };
    }
  }

  async workspaces(id: string): Promise<Workspaces> {
    const registry = await this.registry();
    const source = registry.entries.find(entry => entry.id === id);
    if (!source) throw new AppError('项目不在清单中，请刷新。', 404);
    const directory = await validateDirectory(source.path);
    try { await fs.lstat(path.join(directory, '.git')); }
    catch { return { available: false, reason: '这个目录自身不是 Git 仓库。', entries: [] }; }
    try {
      const { stdout } = await runGit('git', ['-c', 'gc.auto=0', '--no-optional-locks', '-C', directory, 'worktree', 'list', '--porcelain', '-z'], { timeout: 6000, maxBuffer: 1024 * 1024, windowsHide: true });
      const entries: Workspace[] = [];
      const group = await gitGroup(directory);
      const rootName = registry.entries.find(entry => pathKey(entry.path) === pathKey(group?.group ?? directory))?.name ?? path.basename(group?.group ?? directory);
      for (const record of String(stdout).split('\0\0').filter(Boolean)) {
        const fields = record.split('\0');
        const value = (key: string) => fields.find(field => field.startsWith(key + ' '))?.slice(key.length + 1) ?? '';
        const location = value('worktree');
        if (!location) continue;
        const target = path.normalize(location);
        const branch = value('branch').replace(/^refs\/heads\//, '');
        const registered = registry.entries.find(entry => pathKey(entry.path) === pathKey(target));
        let reason = fields.some(field => field === 'bare') ? '裸仓库没有工作目录' : fields.some(field => field === 'prunable' || field.startsWith('prunable ')) ? '工作区已失效，请先在 Git 中处理' : undefined;
        if (!reason) {
          try { await validateDirectory(target); }
          catch (error) { reason = (error as Error).message; }
        }
        entries.push({ path: target, branch, head: value('HEAD'), registered: Boolean(registered), name: registered?.name ?? `${rootName} · ${branch || path.basename(target)}`, reason });
      }
      return { available: true, entries };
    } catch (error) {
      return { available: false, reason: code(error) === 'ENOENT' ? '未找到 Git，请先安装并加入 PATH。' : '无法读取工作区列表，请检查 Git 版本、目录权限或失效记录。', entries: [] };
    }
  }

  async addWorkspace(id: string, input: { path: unknown; name?: unknown; registryHash?: unknown; installSkill?: unknown }) {
    if (typeof input.path !== 'string') throw new AppError('请先选择一个工作区。');
    const listed = await this.workspaces(id);
    const selected = listed.entries.find(entry => pathKey(entry.path) === pathKey(path.normalize(input.path as string)));
    if (!listed.available || !selected || selected.reason) throw new AppError('所选目录不是该项目当前可用的工作区，请重新读取列表。', 409);
    if (selected.registered) throw new AppError('这个工作区已经加入看板。', 409);
    return this.register({ ...input, path: selected.path, name: input.name ?? selected.name });
  }

  async settings() {
    let data = Buffer.alloc(0);
    let exists = true;
    try { data = (await readRegular(this.settingsFile)).data; }
    catch (error) { if (code(error) !== 'ENOENT') throw error; exists = false; }
    try {
      const value = exists ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) : {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw 0;
      return { data, value: value as Record<string, unknown> };
    } catch { throw new AppError('settings.json 格式无效，请先在原文件中修正；不会覆盖原设置。', 422); }
  }

  agentNames(input: unknown): string[] {
    if (!Array.isArray(input) || input.length > 50 || input.some(name => typeof name !== 'string')) throw new AppError('Agent 名单须为不超过 50 个名称的列表。', 422);
    const names = (input as string[]).map(name => name.trim());
    if (names.some(name => !name || name.length > 60 || /[\p{Cc}\p{Cf}·：:]/u.test(name))) throw new AppError('每个名称须为 1–60 个字符，不能包含控制字符、冒号或“·”。', 422);
    if (new Set(names.map(name => name.toLocaleLowerCase())).size !== names.length) throw new AppError('Agent 名称不能重复（不区分大小写）。', 422);
    return names;
  }

  async saveAgents(input: unknown, expectedHash: unknown) {
    return this.write(async () => {
      const agents = this.agentNames(input);
      const settings = await this.settings();
      if (expectedHash !== hash(settings.data)) throw new AppError('设置已变化，请重新打开 Agent 名单后再编辑；你的输入仍保留。', 409);
      // Preserve other settings and never expose their values through the API.
      const saved = { ...settings.value, agents };
      await this.atomic(this.settingsFile, Buffer.from(JSON.stringify(saved, null, 2) + '\n'), async () => {
        if (hash((await this.settings()).data) !== expectedHash) throw new AppError('保存期间设置被外部修改，请重新打开名单后核对。', 409);
      });
      return this.snapshot();
    });
  }

  async atomic(file: string, data: Buffer, beforeRename?: () => Promise<void>) {
    await noLinks(file);
    const temp = path.join(path.dirname(file), `TASKS.md.isle-${randomUUID()}.tmp`);
    let created = false;
    try {
      const handle = await fs.open(temp, 'wx', 0o600);
      created = true;
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      await noLinks(file);
      if (beforeRename) await beforeRename();
      await fs.rename(temp, file);
      created = false;
    } finally { if (created) await fs.unlink(temp).catch(() => {}); }
  }

  async ensureFile(file: string, data: Buffer, label = '模板') {
    await noLinks(file);
    try { await fs.lstat(file); return; } catch (error) { if (code(error) !== 'ENOENT') throw error; }
    const temp = path.join(path.dirname(file), `TASKS.md.isle-${randomUUID()}.tmp`);
    let created = false;
    try {
      const handle = await fs.open(temp, 'wx', 0o600);
      created = true;
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      await noLinks(file);
      // A hard link publishes the fully written file atomically and fails if the destination now exists.
      try { await fs.link(temp, file); }
      catch (error) {
        if (['EPERM', 'ENOTSUP', 'EXDEV'].includes(code(error) ?? '')) throw new AppError(`此目录不支持安全创建${label}。请手动创建文件后重试；已有文件不会被覆盖。`);
        throw error;
      }
    } catch (error) {
      if (code(error) !== 'EEXIST') throw error;
    } finally { if (created) await fs.unlink(temp).catch(() => {}); }
  }

  async ensureTasks(directory: string, name: string) {
    await this.ensureFile(path.join(directory, 'TASKS.md'), Buffer.from(template(name)));
  }

  async skillStatus(directory: string, history?: Record<string, string[]>, options: SkillOptions = {}): Promise<ProjectSkill> {
    const published = history ? migrateHistory(history) : await skillHistory();
    const targets = options.targets ?? {};
    const templates = new Map((await loadedAdapters()).map(item => [item.adapter.key, item.data]));
    const files = await Promise.all(ADAPTERS.map(async adapter => {
      const file: SkillFile = { key: adapter.key, agent: adapter.agent, path: adapter.path, kind: adapter.kind, evidence: adapter.evidence, note: adapter.note, enabled: adapterEnabled(adapter, targets), required: adapter.required === true, state: 'missing' };
      const data = templates.get(adapter.key) ?? null;
      // 没添加的落点只报状态：不读不写，也不算进就绪判定，更不会在项目里留下目录。
      if (!file.enabled) return { ...file, state: adapter.evidence === 'unverified' ? 'unverified' : 'disabled', message: '未添加' } as SkillFile;
      if (adapter.kind === 'marker') return this.markerStatus(directory, adapter, file);
      if (!data) return { ...file, state: 'unverified', message: '证据不足，默认不安装' } as SkillFile;
      try {
        const existing = await readRegular(path.join(directory, adapter.path));
        const state = existing.data.equals(data) ? 'ready' : (published[adapter.key] ?? []).includes(digest(existing.data)) ? 'outdated' : 'custom';
        return { ...file, state } as SkillFile;
      } catch (error) {
        const missing = code(error) === 'ENOENT';
        return { ...file, state: missing ? 'missing' : 'error', message: missing ? undefined : (error as Error).message } as SkillFile;
      }
    }));
    return skillReport(files);
  }

  // 受管区块的状态只看块本身：块外内容归用户，不比对哈希，也不因为文件被改过就判 custom。
  private async markerStatus(directory: string, adapter: Adapter, file: SkillFile): Promise<SkillFile> {
    try {
      const existing = await readRegular(path.join(directory, adapter.path));
      const scan = scanMarker(existing.data);
      if (scan.broken) return { ...file, state: 'error', message: '标记不完整，请手动检查后再试' };
      if (!scan.complete) return { ...file, state: 'missing', message: '尚未写入受管区块' } as SkillFile;
      return { ...file, state: 'ready', message: scan.complete > 1 ? `有 ${scan.complete} 个受管区块，补齐时会收敛为一份` : undefined };
    } catch (error) {
      if (code(error) === 'ENOENT') return { ...file, state: 'skipped', message: '规则文件不存在，不替你新建' };
      return { ...file, state: 'error', message: (error as Error).message };
    }
  }

  // 写前再读一次并比对摘要：用户很可能正开着编辑器改 AGENTS.md。
  async publishGuarded(file: string, data: Buffer, expected: string) {
    await this.atomic(file, data, async () => {
      if (digest((await readRegular(file)).data) !== expected) throw new AppError('文件在写入期间被外部修改，已停止写入，请刷新后核对。', 409);
    });
  }

  async ensureSkill(directory: string, history?: Record<string, string[]>, options: SkillOptions = {}): Promise<ProjectSkill> {
    const failures = new Map<string, string>();
    const published = history ? migrateHistory(history) : await skillHistory();
    const targets = options.targets ?? {};
    for (const { adapter, data } of await loadedAdapters()) {
      // 没添加的落点一律不写；受管区块也走同一个选择器，不再有独立的总开关。
      if (!adapterEnabled(adapter, targets)) continue;
      if (adapter.kind === 'marker') {
        await this.installMarkerFile(directory, adapter, failures);
        continue;
      }
      if (!data) continue;
      const file = path.join(directory, adapter.path);
      try {
        await noLinks(file);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await noLinks(file);
        const existing = await readRegular(file).catch(error => { if (code(error) === 'ENOENT') return null; throw error; });
        if (!existing) await this.ensureFile(file, data, '项目 Skill');
        // Only byte-identical copies of a published version are replaced; anything else is user-owned.
        else if (!existing.data.equals(data) && (published[adapter.key] ?? []).includes(digest(existing.data))) await this.atomic(file, data);
        // Entrypoints must not redirect agents into an unknown, user-owned canonical skill.
        if (adapter.template === 'skill' && !(await readRegular(file)).data.equals(data)) break;
      } catch (error) {
        failures.set(adapter.path, (error as Error).message);
        if (adapter.template === 'skill') break;
      }
    }
    const result = await this.skillStatus(directory, published, options);
    return skillReport(result.files.map(file => failures.has(file.path) ? { ...file, state: 'error', message: failures.get(file.path) } : file));
  }

  // 规则文件不存在就不写：不替用户在没有约定的项目里凭空建 AGENTS.md / CLAUDE.md。
  private async installMarkerFile(directory: string, adapter: Adapter, failures: Map<string, string>) {
    const file = path.join(directory, adapter.path);
    try {
      await noLinks(file);
      const existing = await readRegular(file).catch(error => { if (code(error) === 'ENOENT') return null; throw error; });
      if (!existing) return;
      const result = installMarker(existing.data);
      if ('error' in result) throw new AppError(result.error, 422);
      if (result.data.equals(existing.data)) return;
      await this.publishGuarded(file, result.data, digest(existing.data));
    } catch (error) {
      failures.set(adapter.path, (error as Error).message);
    }
  }

  // 已添加的落点存在 settings.json 的 skillTargets 里，按项目 id 保存；缺省就是没添加。
  // 旧版只有一个受管区块总开关（skillMarkers），读时按「两条都添加」等价折算。
  async targetsFor(id: string): Promise<SkillTargets> {
    const settings = await this.settings().catch(() => null);
    const targets: SkillTargets = {};
    if (Array.isArray(settings?.value.skillMarkers) && (settings.value.skillMarkers as unknown[]).includes(id)) Object.assign(targets, markerTargets());
    const saved = Store.savedTargets(settings?.value ?? {})[id];
    return saved ? { ...targets, ...saved } : targets;
  }

  // settings 里的落点开关可能被手改坏：只留认识的 key 与布尔值，其余丢弃。
  private static savedTargets(value: Record<string, unknown>): Record<string, SkillTargets> {
    const saved: Record<string, SkillTargets> = {};
    const raw = value.skillTargets;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return saved;
    for (const [projectId, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const targets: SkillTargets = {};
      for (const adapter of ADAPTERS) {
        const item = (entry as Record<string, unknown>)[adapter.key];
        if (typeof item === 'boolean') targets[adapter.key] = item;
      }
      if (Object.keys(targets).length) saved[projectId] = targets;
    }
    return saved;
  }

  // 选择器添加、行尾删除：添加立即写入这一条；删除只清案屿写进去的字节（官方版本整文件、
  // 受管区块块内），你改过的同名文件保留，变空的目录顺手收回。
  async setProjectTarget(id: string, input: { key?: unknown; enabled?: unknown }): Promise<SkillTargetResult> {
    const adapter = ADAPTERS.find(item => item.key === input.key);
    if (!adapter) throw new AppError('未知的落点，请刷新后重试。');
    if (typeof input.enabled !== 'boolean') throw new AppError('落点开关须为布尔值。');
    if (adapter.required && !input.enabled) throw new AppError('基础包是各入口共用的规范正文与元数据，不能删除。', 422);
    const enabled: boolean = input.enabled;
    return this.write(async () => {
      const entry = (await this.registry()).entries.find(item => item.id === id);
      if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
      await validateDirectory(entry.path);
      const settings = await this.settings();
      const published = await skillHistory();
      const templates = new Map((await loadedAdapters()).map(item => [item.adapter.key, item.data]));
      const targets: SkillTargets = { ...(await this.targetsFor(id)) };
      if (enabled) targets[adapter.key] = true; else delete targets[adapter.key];
      const saved = { ...Store.savedTargets(settings.value) };
      if (Object.keys(targets).length) saved[id] = targets; else delete saved[id];
      const next: Record<string, unknown> = { ...settings.value, skillTargets: saved };
      // 顺手把这一项的旧开关迁到新形状，别让两套真源并存。
      if (Array.isArray(settings.value.skillMarkers)) {
        const rest = (settings.value.skillMarkers as unknown[]).filter(item => typeof item === 'string' && item !== id);
        if (rest.length) next.skillMarkers = rest; else delete next.skillMarkers;
      }
      await this.atomic(this.settingsFile, Buffer.from(JSON.stringify(next, null, 2) + '\n'), async () => {
        if (hash((await this.settings()).data) !== hash(settings.data)) throw new AppError('设置已变化，请重新打开后再试。', 409);
      });
      if (enabled) {
        const skill = await this.ensureSkill(entry.path, published, { targets });
        const file = skill.files.find(item => item.key === adapter.key)!;
        const action = file.state === 'ready' ? 'added' : file.state === 'custom' ? 'kept' : 'skipped';
        const reason = file.state === 'ready' ? '已写入项目' : file.message ?? '没能写入，请查看这一行的状态';
        return { skill, key: adapter.key, enabled, action, reason } as SkillTargetResult;
      }
      const removal = await this.removeAdapter(entry.path, adapter, templates, published);
      const skill = await this.skillStatus(entry.path, published, { targets });
      return { skill, key: adapter.key, enabled, action: removal.action, reason: removal.reason } as SkillTargetResult;
    });
  }

  async projectSkill(id: string) {
    const entry = (await this.registry()).entries.find(item => item.id === id);
    if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
    await validateDirectory(entry.path);
    return this.skillStatus(entry.path, undefined, { targets: await this.targetsFor(id) });
  }

  async planProjectSkill(id: string) {
    const entry = (await this.registry()).entries.find(item => item.id === id);
    if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
    await validateDirectory(entry.path);
    return this.planSkill(entry.path, undefined, { targets: await this.targetsFor(id) });
  }

  // 干跑：只读文件、算出会发生的动作，任何一条都不写盘。
  async planSkill(directory: string, history?: Record<string, string[]>, options: SkillOptions = {}): Promise<SkillPlan> {
    const published = history ? migrateHistory(history) : await skillHistory();
    const targets = options.targets ?? {};
    const templates = new Map((await loadedAdapters()).map(item => [item.adapter.key, item.data]));
    const entries: SkillPlanEntry[] = [];
    const push = (adapter: Adapter, action: SkillAction, reason: string) => entries.push({ agent: adapter.agent, key: adapter.key, path: adapter.path, kind: adapter.kind, action, reason });
    for (const adapter of ADAPTERS) {
      const file = path.join(directory, adapter.path);
      // 没添加的落点不会写，计划里如实说明。
      if (!adapterEnabled(adapter, targets)) {
        push(adapter, 'skip', adapter.evidence === 'unverified' ? '证据不足，默认不启用' : '未添加');
        continue;
      }
      if (adapter.kind === 'marker') {
        try {
          const existing = await readRegular(file).catch(error => { if (code(error) === 'ENOENT') return null; throw error; });
          if (!existing) { push(adapter, 'skip', '规则文件不存在，不会新建'); continue; }
          const scan = scanMarker(existing.data);
          if (scan.broken) { push(adapter, 'error', '标记不完整，请手动检查'); continue; }
          const planned = installMarker(existing.data);
          if ('error' in planned) { push(adapter, 'error', planned.error); continue; }
          if (planned.data.equals(existing.data)) { push(adapter, 'skip', '受管区块已是最新'); continue; }
          if (!scan.complete) { push(adapter, 'append', '在文件末尾追加案屿受管区块'); continue; }
          push(adapter, 'replace', scan.complete > 1 ? `把 ${scan.complete} 个受管区块收敛为一份` : '只替换 begin 到 end 之间的内容');
        } catch (error) {
          push(adapter, 'error', (error as Error).message);
        }
        continue;
      }
      const data = templates.get(adapter.key);
      if (!data) { push(adapter, 'skip', '证据不足，默认不安装'); continue; }
      try {
        const existing = await readRegular(file).catch(error => { if (code(error) === 'ENOENT') return null; throw error; });
        if (!existing) { push(adapter, 'create', '将新建该文件'); continue; }
        if (existing.data.equals(data)) { push(adapter, 'skip', '已是当前版本'); continue; }
        if ((published[adapter.key] ?? []).includes(digest(existing.data))) { push(adapter, 'replace', '官方旧版，将升级到当前版本'); continue; }
        push(adapter, 'conflict', '内容与官方版本不同，视为用户自有，不会覆盖');
      } catch (error) {
        push(adapter, 'error', (error as Error).message);
      }
    }
    const counts: Record<SkillAction, number> = { create: 0, append: 0, replace: 0, remove: 0, skip: 0, conflict: 0, error: 0 };
    for (const entry of entries) counts[entry.action] += 1;
    return { entries, counts };
  }

  async removeProjectSkill(id: string) {
    return this.write(async () => {
      const entry = (await this.registry()).entries.find(item => item.id === id);
      if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
      await validateDirectory(entry.path);
      return this.removeSkill(entry.path);
    });
  }

  // 只撤案屿自己写进去的字节：整文件按版本判定删，受管区块只删块；因案屿变空的目录顺手收回。
  // 撤除不看落点是否添加过——以前的残留也得能从这里清掉。
  async removeSkill(directory: string, history?: Record<string, string[]>): Promise<SkillRemovalResult> {
    const published = history ? migrateHistory(history) : await skillHistory();
    const templates = new Map((await loadedAdapters()).map(item => [item.adapter.key, item.data]));
    const entries: SkillRemoval[] = [];
    for (const adapter of ADAPTERS) {
      const result = await this.removeAdapter(directory, adapter, templates, published);
      entries.push({ agent: adapter.agent, key: adapter.key, path: adapter.path, action: result.action, reason: result.reason });
    }
    const counts = { removed: 0, kept: 0, skipped: 0 };
    for (const entry of entries) counts[entry.action] += 1;
    return { entries, counts };
  }

  // 单条落点的删除：整文件只删官方版本，受管区块只删块内，其余一律留住并说明原因。
  private async removeAdapter(directory: string, adapter: Adapter, templates: Map<string, Buffer | null>, published: Record<string, string[]>): Promise<{ action: SkillRemoval['action']; reason: string }> {
    const file = path.join(directory, adapter.path);
    if (adapter.kind === 'marker') {
      try {
        const existing = await readRegular(file).catch(error => { if (code(error) === 'ENOENT') return null; throw error; });
        if (!existing) return { action: 'skipped', reason: '规则文件不存在' };
        const scan = scanMarker(existing.data);
        if (scan.broken) return { action: 'kept', reason: '标记不完整，未改动，请手动检查' };
        if (!scan.complete) return { action: 'skipped', reason: '文件里没有案屿的受管区块' };
        const result = removeMarker(existing.data);
        if ('error' in result) return { action: 'kept', reason: result.error };
        if (result.data.equals(existing.data)) return { action: 'skipped', reason: '没有可删除的受管区块' };
        // 删完只剩空白就保留文件，不替用户决定删除。
        if (isBlank(result.data)) return { action: 'skipped', reason: '撤除后文件只剩空白，已保留文件' };
        await this.publishGuarded(file, result.data, digest(existing.data));
        return { action: 'removed', reason: '已删除受管区块，文件与其他内容保留' };
      } catch (error) {
        return { action: 'kept', reason: (error as Error).message };
      }
    }
    try {
      const existing = await readRegular(file).catch(error => { if (code(error) === 'ENOENT') return null; throw error; });
      if (!existing) return { action: 'skipped', reason: '文件不存在' };
      const data = templates.get(adapter.key) ?? null;
      const official = data !== null && (existing.data.equals(data) || (published[adapter.key] ?? []).includes(digest(existing.data)));
      if (!official) return { action: 'kept', reason: '用户已修改，未删除' };
      await fs.unlink(file);
      await this.pruneEmptyDirectories(directory, path.dirname(file));
      return { action: 'removed', reason: '官方版本，已删除；变空的目录一并收回' };
    } catch (error) {
      return { action: 'kept', reason: (error as Error).message };
    }
  }

  // 只收回因案屿变空的目录：非空目录（用户自己的 Skill）一律不动，项目根永远不动。
  private async pruneEmptyDirectories(root: string, from: string) {
    const stop = path.resolve(root);
    let current = path.resolve(from);
    while (current !== stop && current.startsWith(stop + path.sep)) {
      try { await fs.rmdir(current); } catch { return; }
      current = path.dirname(current);
    }
  }

  async installProjectSkill(id: string) {
    return this.write(async () => {
      const entry = (await this.registry()).entries.find(item => item.id === id);
      if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
      await validateDirectory(entry.path);
      return this.ensureSkill(entry.path, undefined, { targets: await this.targetsFor(id) });
    });
  }

  async openProjectDirectory(id: string) {
    const entry = (await this.registry()).entries.find(item => item.id === id);
    if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
    await this.revealDirectory(await validateDirectory(entry.path));
    return { opened: true };
  }

  async saveRegistry(registry: Registry, text: string) {
    await this.atomic(this.registryFile, Buffer.from(text), async () => {
      if (hash((await this.registry()).data) !== hash(registry.data)) throw new AppError('项目清单已被外部修改，请刷新后重试。', 409);
    });
  }

  async register(input: { path: unknown; name?: unknown; registryHash?: unknown; replaceId?: string; installSkill?: unknown }) {
    return this.write(async () => {
      const registry = await this.registry();
      if (input.registryHash !== hash(registry.data)) throw new AppError('项目清单已变化，请刷新后重试。', 409);
      if (input.installSkill !== undefined && typeof input.installSkill !== 'boolean') throw new AppError('安装 Skill 选项须为布尔值。');
      const directory = await validateDirectory(input.path);
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (/[\t\r\n\0]/.test(name) || name.length > 120) throw new AppError('项目名不能包含换行或制表符，且不超过 120 个字符。');
      if (registry.entries.some(entry => pathKey(entry.path) === pathKey(directory) && entry.id !== input.replaceId)) throw new AppError('这个项目路径已经在看板中。', 409);
      const old = input.replaceId ? registry.entries.find(entry => entry.id === input.replaceId) : undefined;
      if (input.replaceId && !old) throw new AppError('项目不在清单中，请刷新。', 404);
      await this.ensureTasks(directory, name || old?.name || path.basename(directory));
      const skill = input.installSkill === false ? undefined : await this.ensureSkill(directory);
      if (old) {
        registry.lines[old.line] = directory + ((name || old.name) ? `\t${name || old.name}` : '');
        await this.saveRegistry(registry, registry.lines.join(registry.data.includes(Buffer.from('\r\n')) ? '\r\n' : '\n'));
      } else {
        const text = registry.data.toString('utf8');
        const newline = text.includes('\r\n') ? '\r\n' : '\n';
        await this.saveRegistry(registry, text + (text && !text.endsWith('\n') ? newline : '') + directory + (name ? `\t${name}` : '') + newline);
      }
      const snapshot = await this.snapshot();
      if (skill && skill.state !== 'ready') snapshot.warnings.push('项目已添加；案屿 Skill 尚未全部就绪。请在项目页检查，已有同名文件未覆盖。');
      return snapshot;
    });
  }

  async editNext(id: string, next: unknown, expectedHash: unknown) {
    return this.editRecord(id, { next }, expectedHash);
  }

  async editRecord(id: string, changes: { next?: unknown; summary?: unknown }, expectedHash: unknown) {
    return this.write(async () => {
      const entry = (await this.registry()).entries.find(entry => entry.id === id);
      if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
      await validateDirectory(entry.path);
      const file = path.join(entry.path, 'TASKS.md');
      const { data } = await readRegular(file);
      if (expectedHash !== hash(data)) throw new AppError('TASKS.md 已被其他程序修改。你的输入仍保留，请先刷新核对后再编辑。', 409);
      if (!parseTasks(data).readable) throw new AppError('文件内容无法识别，请先在原文件中修正。', 422);
      let updated: Buffer;
      try { updated = updateRecord(data, changes); }
      catch (error) { throw new AppError((error as Error).message, 422); }
      if (updated.equals(data)) return this.snapshot();
      const backupFile = file + '.bak';
      let previous: Buffer | undefined;
      try { previous = (await readRegular(backupFile)).data; decodeBackup(previous, file); }
      catch (error) { if (code(error) !== 'ENOENT') throw error; }
      const backup = Buffer.from(JSON.stringify({ format: backupFormat, target: file, sha256: hash(data), content: data.toString('base64') }) + '\n');
      await this.atomic(backupFile, backup, async () => {
        try {
          const current = (await readRegular(backupFile)).data;
          if (!previous || !previous.equals(current)) throw new AppError('备份文件在写入期间发生变化，请重试。', 409);
        } catch (error) { if (code(error) !== 'ENOENT' || previous) throw error; }
      });
      await this.atomic(file, updated, async () => {
        await validateDirectory(entry.path);
        if (hash((await readRegular(file)).data) !== expectedHash) throw new AppError('保存期间文件被外部修改，已停止写入，请刷新后核对。', 409);
      });
      return this.snapshot();
    });
  }

  async editTask(id: string, line: unknown, action: unknown, expectedHash: unknown, title?: unknown) {
    return this.write(async () => {
      const entry = (await this.registry()).entries.find(entry => entry.id === id);
      if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
      await validateDirectory(entry.path);
      const file = path.join(entry.path, 'TASKS.md');
      const { data } = await readRegular(file);
      if (expectedHash !== hash(data)) throw new AppError('TASKS.md 已被其他程序修改，请刷新后重试。', 409);
      if (!parseTasks(data).readable) throw new AppError('文件内容无法识别，请先在原文件中修正。', 422);
      let updated: Buffer;
      try { updated = updateTask(data, line, action, title); }
      catch (error) { throw new AppError((error as Error).message, 422); }
      if (updated.equals(data)) return this.snapshot();
      const backupFile = file + '.bak';
      let previous: Buffer | undefined;
      try { previous = (await readRegular(backupFile)).data; decodeBackup(previous, file); }
      catch (error) { if (code(error) !== 'ENOENT') throw error; }
      const backup = Buffer.from(JSON.stringify({ format: backupFormat, target: file, sha256: hash(data), content: data.toString('base64') }) + '\n');
      await this.atomic(backupFile, backup, async () => {
        try {
          const current = (await readRegular(backupFile)).data;
          if (!previous || !previous.equals(current)) throw new AppError('备份文件在写入期间发生变化，请重试。', 409);
        } catch (error) { if (code(error) !== 'ENOENT' || previous) throw error; }
      });
      await this.atomic(file, updated, async () => {
        await validateDirectory(entry.path);
        if (hash((await readRegular(file)).data) !== expectedHash) throw new AppError('保存期间文件被外部修改，已停止写入，请刷新后核对。', 409);
      });
      return this.snapshot();
    });
  }

  async remove(id: string, expectedHash: unknown) {
    return this.write(async () => {
      const registry = await this.registry();
      if (expectedHash !== hash(registry.data)) throw new AppError('清单已变化，请刷新重试。', 409);
      const entry = registry.entries.find(item => item.id === id);
      if (!entry) throw new AppError('项目不在清单中。', 404);
      registry.lines.splice(entry.line, 1);
      await this.saveRegistry(registry, registry.lines.join(registry.data.includes(Buffer.from('\r\n')) ? '\r\n' : '\n'));
      return this.snapshot();
    });
  }
}
