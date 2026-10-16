import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, Snapshot } from '../shared/types.ts';
import { hash, parseTasks, template, updateNext } from './tasks.ts';

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
  private pending: Promise<unknown> = Promise.resolve();
  constructor(home: string) { this.home = path.resolve(home); this.registryFile = path.join(this.home, 'projects.txt'); }

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
    const base: Project = { ...entry, state: 'ok', status: '进行中', next: '', updated: '', estimated: false, age: 0, hash: '', tasks: [], warnings: [] };
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
    return { projects, warnings: registry.warnings, registryHash: hash(registry.data) };
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

  async ensureTasks(directory: string, name: string) {
    const file = path.join(directory, 'TASKS.md');
    await noLinks(file);
    try { await fs.lstat(file); return; } catch (error) { if (code(error) !== 'ENOENT') throw error; }
    const temp = path.join(directory, `TASKS.md.isle-${randomUUID()}.tmp`);
    let created = false;
    try {
      const handle = await fs.open(temp, 'wx', 0o600);
      created = true;
      try { await handle.writeFile(template(name)); await handle.sync(); } finally { await handle.close(); }
      await noLinks(file);
      // A hard link publishes the fully written file atomically and fails if the destination now exists.
      try { await fs.link(temp, file); }
      catch (error) {
        if (['EPERM', 'ENOTSUP', 'EXDEV'].includes(code(error) ?? '')) throw new AppError('此目录不支持安全创建模板。请手动新建 UTF-8 的 TASKS.md 后重新添加；已有文件不会被覆盖。');
        throw error;
      }
    } catch (error) {
      if (code(error) !== 'EEXIST') throw error;
    } finally { if (created) await fs.unlink(temp).catch(() => {}); }
  }

  async saveRegistry(registry: Registry, text: string) {
    await this.atomic(this.registryFile, Buffer.from(text), async () => {
      if (hash((await this.registry()).data) !== hash(registry.data)) throw new AppError('项目清单已被外部修改，请刷新后重试。', 409);
    });
  }

  async register(input: { path: unknown; name?: unknown; registryHash?: unknown; replaceId?: string }) {
    return this.write(async () => {
      const registry = await this.registry();
      if (input.registryHash !== hash(registry.data)) throw new AppError('项目清单已变化，请刷新后重试。', 409);
      const directory = await validateDirectory(input.path);
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (/[\t\r\n\0]/.test(name) || name.length > 120) throw new AppError('项目名不能包含换行或制表符，且不超过 120 个字符。');
      if (registry.entries.some(entry => pathKey(entry.path) === pathKey(directory) && entry.id !== input.replaceId)) throw new AppError('这个项目路径已经在看板中。', 409);
      const old = input.replaceId ? registry.entries.find(entry => entry.id === input.replaceId) : undefined;
      if (input.replaceId && !old) throw new AppError('项目不在清单中，请刷新。', 404);
      await this.ensureTasks(directory, name || old?.name || path.basename(directory));
      if (old) {
        registry.lines[old.line] = directory + ((name || old.name) ? `\t${name || old.name}` : '');
        await this.saveRegistry(registry, registry.lines.join(registry.data.includes(Buffer.from('\r\n')) ? '\r\n' : '\n'));
      } else {
        const text = registry.data.toString('utf8');
        const newline = text.includes('\r\n') ? '\r\n' : '\n';
        await this.saveRegistry(registry, text + (text && !text.endsWith('\n') ? newline : '') + directory + (name ? `\t${name}` : '') + newline);
      }
      return this.snapshot();
    });
  }

  async editNext(id: string, next: unknown, expectedHash: unknown) {
    return this.write(async () => {
      const entry = (await this.registry()).entries.find(entry => entry.id === id);
      if (!entry) throw new AppError('项目不在清单中，请刷新。', 404);
      await validateDirectory(entry.path);
      const file = path.join(entry.path, 'TASKS.md');
      const { data } = await readRegular(file);
      if (expectedHash !== hash(data)) throw new AppError('TASKS.md 已被其他程序修改。你的输入仍保留，请先刷新核对后再编辑。', 409);
      if (!parseTasks(data).readable) throw new AppError('文件内容无法识别，请先在原文件中修正。', 422);
      let updated: Buffer;
      try { updated = updateNext(data, next as string); }
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
