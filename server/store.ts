import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitHistory, Project, ProjectSkill, SkillFile, Snapshot } from '../shared/types.ts';
import { hash, parseTasks, template, updateRecord } from './tasks.ts';

const runGit = promisify(execFile);

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function code(error: unknown) { return (error as NodeJS.ErrnoException).code; }
function pathKey(value: string) { return process.platform === 'win32' ? value.toLowerCase() : value; }
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

async function skillTemplates() {
  const [skill, metadata] = await Promise.all([
    fs.readFile(new URL('../skills/isle/SKILL.md', import.meta.url)),
    fs.readFile(new URL('../skills/isle/agents/openai.yaml', import.meta.url)),
  ]);
  const entry = Buffer.from(`---\nname: isle\ndescription: 案屿开工、收工和项目交接入口；需要按案屿规范回写 TASKS.md 时使用。\n---\n\n# 案屿项目交接\n\n先完整读取并遵循[通用案屿规范](../../../.agents/skills/isle/SKILL.md)，再按用户要求执行开工或收工。\n规范文件位于项目根目录的 .agents/skills/isle/SKILL.md，任务文件为同一项目根目录的 TASKS.md，不在此入口目录下。\n如果通用规范缺失，提示用户在案屿中补齐项目 Skill，不自行编造规则。\n`);
  return [
    { path: '.agents/skills/isle/SKILL.md', data: skill },
    { path: '.agents/skills/isle/agents/openai.yaml', data: metadata },
    { path: '.claude/skills/isle/SKILL.md', data: entry },
    { path: '.trae/skills/isle/SKILL.md', data: entry },
  ];
}

function skillReport(files: SkillFile[]): ProjectSkill {
  const primary = files[0].state;
  const state = files.every(file => file.state === 'ready') ? 'ready'
    : primary === 'custom' || primary === 'error' ? primary
    : files.every(file => file.state === 'missing') ? 'missing' : 'partial';
  return { state, files };
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
  private pending: Promise<unknown> = Promise.resolve();
  constructor(home: string) {
    this.home = path.resolve(home);
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
    try {
      await validateDirectory(entry.path);
    } catch (error) {
      return { ...base, state: code(error) === 'EACCES' ? 'error' : 'offline', error: (error as Error).message };
    }
    try {
      const { data, info } = await readRegular(path.join(entry.path, 'TASKS.md'));
      const parsed = parseTasks(data, info.mtime);
      return { ...base, ...parsed, hash: hash(data), state: parsed.readable ? 'ok' : 'error',
        error: parsed.readable ? undefined : '文件可读，但未识别到标题、字段或任务。请在原文件中修正。' };
    } catch (error) {
      let message = error instanceof Error ? error.message : '无法读取文件。';
      if (code(error) === 'ENOENT') message = '项目中缺少 TASKS.md。请恢复文件，或重新指向这个目录以生成模板。';
      if (error instanceof TypeError) message = 'TASKS.md 不是有效的 UTF-8 文件，请在编辑器中另存为 UTF-8。';
      return { ...base, state: 'error', error: message };
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
  // a hard timeout, and gc disabled so nothing in .git is modified.
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
      const { stdout } = await runGit('git', ['-c', 'gc.auto=0', '--no-pager', '-C', directory, 'log', '-n', '40', '--date=short', '--pretty=format:%h%x1f%ad%x1f%s'], { timeout: 6000, maxBuffer: 1024 * 1024, windowsHide: true });
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

  async skillStatus(directory: string): Promise<ProjectSkill> {
    const files = await Promise.all((await skillTemplates()).map(async item => {
      try {
        const { data } = await readRegular(path.join(directory, item.path));
        return { path: item.path, state: data.equals(item.data) ? 'ready' : 'custom' } as SkillFile;
      } catch (error) {
        return { path: item.path, state: code(error) === 'ENOENT' ? 'missing' : 'error', message: code(error) === 'ENOENT' ? undefined : (error as Error).message } as SkillFile;
      }
    }));
    return skillReport(files);
  }

  async ensureSkill(directory: string): Promise<ProjectSkill> {
    const failures = new Map<string, string>();
    for (const [index, item] of (await skillTemplates()).entries()) {
      const file = path.join(directory, item.path);
      try {
        await noLinks(file);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await noLinks(file);
        await this.ensureFile(file, item.data, '项目 Skill');
        // Other entrypoints must not redirect agents into an unknown, user-owned skill.
        if (index === 0 && !(await readRegular(file)).data.equals(item.data)) break;
      } catch (error) {
        failures.set(item.path, (error as Error).message);
        if (index === 0) break;
      }
    }
    const result = await this.skillStatus(directory);
    return skillReport(result.files.map(file => failures.has(file.path) ? { ...file, state: 'error', message: failures.get(file.path) } : file));
  }

  async projectSkill(id: string) {
    const entry = (await this.registry()).entries.find(item => item.id === id);
    if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
    await validateDirectory(entry.path);
    return this.skillStatus(entry.path);
  }

  async installProjectSkill(id: string) {
    return this.write(async () => {
      const entry = (await this.registry()).entries.find(item => item.id === id);
      if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
      await validateDirectory(entry.path);
      return this.ensureSkill(entry.path);
    });
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
