import { createHash } from 'node:crypto';
import type { Task, TaskState } from '../shared/types.ts';

export function hash(data: Uint8Array | string) {
  return createHash('sha256').update(data).digest('hex');
}

export function today(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

export function ageInDays(value: string) {
  return Math.floor((Date.parse(today()) - Date.parse(value)) / 86_400_000);
}

function linesOf(text: string) {
  return text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
}

// Shared line recognition keeps reads and small, byte-preserving edits in agreement.
function inspect(text: string) {
  const lines = linesOf(text.replace(/^\uFEFF/, ''));
  const fields = new Map<string, { index: number; value: string; prefix: string }[]>();
  let headerEnd = lines.length;
  let fence = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/[\r\n]+$/, '');
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (fence === marker[1][0]) fence = '';
      continue;
    }
    if (fence) continue;
    if (/^##(?:\s|$)/.test(line)) { headerEnd = index; break; }
    const match = line.match(/^([ \t]*(status|next|updated)[ \t]*[:：][ \t]*)(.*)$/);
    if (match) {
      const list = fields.get(match[2]) ?? [];
      list.push({ index, prefix: match[1], value: match[3].trim() });
      fields.set(match[2], list);
    }
  }
  return { lines, fields, headerEnd };
}

export function parseTasks(data: Buffer, modified = new Date()) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  const { lines, fields } = inspect(text);
  const warnings: string[] = [];
  const get = (key: string) => fields.get(key)?.[0]?.value ?? '';
  for (const [key, values] of fields) {
    if (values.length > 1) warnings.push(`${key} 重复出现，当前显示第一项；请在原文件中消除重复后再编辑。`);
  }
  let status: '进行中' | '暂停' | '已完成' = '进行中';
  if (['进行中', '暂停', '已完成'].includes(get('status'))) status = get('status') as typeof status;
  else warnings.push(get('status') ? 'status 无法识别，暂按进行中显示。' : '缺少 status，暂按进行中显示。');
  if (!get('next')) warnings.push('尚未填写续接提示。');
  const estimated = !validDate(get('updated'));
  const updated = estimated ? today(modified) : get('updated');
  if (estimated) warnings.push('updated 缺失或无效，日期使用文件时间估值。');
  if (ageInDays(updated) < 0) warnings.push('updated 是未来日期，请检查原文件。');
  const tasks: Task[] = [];
  let section: TaskState = '待办';
  let knownSection = true;
  let recognized = fields.size > 0 || text.trim() === '';
  let fence = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/[\r\n]+$/, '');
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (fence === marker[1][0]) fence = '';
      continue;
    }
    if (fence) continue;
    if (/^#\s+\S/.test(line)) recognized = true;
    const heading = line.match(/^##(?:[ \t]+(.*)|$)/);
    if (heading) {
      recognized = true;
      const name = (heading[1] ?? '').replace(/[ \t]+#+$/, '').trim();
      knownSection = ['待办', '进行中', '已完成'].includes(name);
      section = knownSection ? name as TaskState : '待办';
      if (!knownSection) warnings.push(`第 ${index + 1} 行的分节“${name}”无法识别，未勾选任务暂归待办。`);
      continue;
    }
    const task = line.match(/^[-*][ \t]+(?:\[([ xX])\][ \t]*)?(\S.*)$/);
    if (!task) continue;
    recognized = true;
    const checked = task[1]?.toLowerCase() === 'x';
    const conflict = (checked && section !== '已完成') || (!checked && section === '已完成');
    const state: TaskState = checked ? '已完成' : section === '已完成' ? '待办' : section;
    let title = task[2].trim();
    const tags: string[] = [];
    for (;;) {
      const tag = title.match(/(?:^|\s)(@[A-Za-z0-9_-]+)$/);
      if (!tag) break;
      tags.unshift(tag[1]);
      title = title.slice(0, tag.index).trimEnd();
    }
    tasks.push({ title: title || '未命名任务', tags, state, line: index + 1, conflict });
    if (conflict) warnings.push(`第 ${index + 1} 行的复选框与分节不一致，暂按${state}显示；原文件未修改。`);
  }
  return { status, next: get('next'), updated, estimated, age: ageInDays(updated), tasks, warnings,
    readable: recognized, preview: text.slice(0, 2400) };
}

export function updateNext(original: Buffer, next: string) {
  if (typeof next !== 'string' || /[\r\n\0]/.test(next) || next.length > 4000) {
    throw new Error('续接提示须为一行，且不超过 4000 个字符。');
  }
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original);
  const { lines, fields, headerEnd } = inspect(text);
  for (const key of ['next', 'updated']) {
    if ((fields.get(key)?.length ?? 0) > 1) throw new Error(`${key} 存在重复项，请先在原文件中修正。`);
  }
  const current = fields.get('next')?.[0];
  next = next.trim();
  if ((current?.value ?? '') === next) return original;
  const newline = text.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  const additions: string[] = [];
  for (const [key, value] of [['next', next], ['updated', today()]]) {
    const field = fields.get(key)?.[0];
    if (field) {
      const ending = lines[field.index].match(/(?:\r\n|\n|\r)$/)?.[0] ?? '';
      lines[field.index] = field.prefix + value + ending;
    } else additions.push(`${key}: ${value}${newline}`);
  }
  if (additions.length) {
    if (headerEnd > 0 && !/[\r\n]$/.test(lines[headerEnd - 1])) lines[headerEnd - 1] += newline;
    lines.splice(headerEnd, 0, ...additions);
  }
  return Buffer.from((text.startsWith('\uFEFF') ? '\uFEFF' : '') + lines.join(''), 'utf8');
}

export function template(name: string) {
  return `# ${name}\n\nstatus: 进行中\nnext:\nupdated: ${today()}\n\n## 待办\n\n## 进行中\n\n## 已完成\n`;
}
