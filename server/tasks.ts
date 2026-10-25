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

function summarySections(lines: string[], name = '交接摘要') {
  const sections: { start: number; end: number }[] = [];
  let current: { start: number; end: number } | undefined;
  let topHeading = false;
  let fence: { marker: string; length: number } | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/[\r\n]+$/, '');
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
      else if (fence.marker === marker[1][0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (fence) continue;
    if (/^#(?:[ \t]|$)/.test(line)) topHeading = true;
    const heading = line.match(/^##(?:[ \t]+(.*)|$)/);
    if (!heading) continue;
    if (current) current.end = index;
    current = undefined;
    // Accept a dated heading without broad prefix matching or rewriting its original bytes.
    const title = (heading[1] ?? '').replace(/[ \t]+#+$/, '').trim()
      .replace(/[ \t]*(?:\([ \t]*\d{4}-\d{2}-\d{2}[ \t]*\)|（[ \t]*\d{4}-\d{2}-\d{2}[ \t]*）)$/, '');
    if (title === name) {
      current = { start: index, end: lines.length };
      sections.push(current);
    }
  }
  return { sections, openFence: Boolean(fence), topHeading };
}

function summaryText(lines: string[], section: { start: number; end: number }) {
  return lines.slice(section.start + 1, section.end).join('').replace(/\r\n|\r/g, '\n').replace(/^\n+|\n+$/g, '');
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
  const { sections: summaries, openFence } = summarySections(lines);
  const summary = summaries.map(section => summaryText(lines, section)).join('\n\n');
  const histories = summarySections(lines, '工作留痕').sections;
  const history = histories.map(section => summaryText(lines, section)).join('\n\n');
  const warnings: string[] = [];
  if (histories.length > 1) warnings.push('工作留痕分节重复，已合并显示；追加时请合并为一节并保留历史内容。');
  if (summaries.length > 1) warnings.push('交接摘要分节重复，已合并显示；请在原文件中合并为一节后再编辑摘要。');
  if (openFence) warnings.push('文件存在未闭合的代码块，请在原文件中检查分节边界。');
  const get = (key: string) => fields.get(key)?.[0]?.value ?? '';
  for (const [key, values] of fields) {
    if (values.length > 1) warnings.push(`${key} 重复出现，当前显示第一项；请在原文件中消除重复后再编辑。`);
  }
  let status: '进行中' | '暂停' | '已完成' = '进行中';
  if (['进行中', '暂停', '已完成'].includes(get('status'))) status = get('status') as typeof status;
  else warnings.push(get('status') ? 'status 无法识别，暂按进行中显示。' : '缺少 status，暂按进行中显示。');
  if (!get('next')) warnings.push('尚未填写续接提示。');
  else {
    const next = get('next');
    if (next.length > 50 || /[。！？!?].+[。！？!?]/.test(next)) {
      warnings.push('续接提示过长或多句，建议一句话（50 字内）；详情写进交接摘要。');
    }
    if (/(\*\*|__|`|\[[^\]]+\]\([^)]+\)|^\s{0,3}#{1,6}\s)/m.test(next)) {
      warnings.push('续接提示含 Markdown 标记，建议纯文本；详情写进交接摘要。');
    }
  }
  const estimated = !validDate(get('updated'));
  const updated = estimated ? today(modified) : get('updated');
  if (estimated) warnings.push('updated 缺失或无效，日期使用文件时间估值。');
  if (ageInDays(updated) < 0) warnings.push('updated 是未来日期，请检查原文件。');
  const tasks: Task[] = [];
  let section: TaskState = '待办';
  let knownSection = true;
  let recognized = fields.size > 0 || summaries.length > 0 || histories.length > 0 || text.trim() === '';
  let fence = '';
  for (let index = 0; index < lines.length; index++) {
    // Context and contribution records must never become task entries.
    if ([...summaries, ...histories].some(section => index >= section.start && index < section.end)) continue;
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
  return { status, next: get('next'), summary, history, updated, estimated, age: ageInDays(updated), tasks, warnings,
    readable: recognized, preview: text.slice(0, 2400) };
}

export function updateNext(original: Buffer, next: string) {
  return updateRecord(original, { next });
}

function taskSectionRange(lines: string[], name: string) {
  const starts: number[] = [];
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
    const heading = line.match(/^##(?:[ \t]+(.*)|$)/);
    if (!heading) continue;
    const title = (heading[1] ?? '').replace(/[ \t]+#+$/, '').trim();
    if (title === name) starts.push(index);
  }
  if (starts.length > 1) throw new Error(`${name}分节重复，请先在原文件中合并。`);
  if (!starts.length) return undefined;
  const start = starts[0];
  let end = lines.length;
  fence = '';
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index].replace(/[\r\n]+$/, '');
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (fence === marker[1][0]) fence = '';
      continue;
    }
    if (fence) continue;
    if (/^##(?:\s|$)/.test(line)) { end = index; break; }
  }
  return { start, end };
}

/**
 * Edits one task line without touching the summary or work trail.
 * complete moves the exact line into ## 已完成 and marks it [x]; delete removes it;
 * edit replaces only the title and keeps checkbox, indentation and trailing @tags.
 */
export function updateTask(original: Buffer, line: unknown, action: unknown, title?: unknown) {
  if (!Number.isInteger(line) || (line as number) < 1) throw new Error('任务行无效，请刷新后重试。');
  if (action !== 'complete' && action !== 'delete' && action !== 'edit') throw new Error('不支持的任务操作。');
  if (action === 'edit') {
    if (typeof title !== 'string') throw new Error('请填写任务内容。');
    if (/[\r\n\0]/.test(title)) throw new Error('任务内容须为一行。');
    if (!title.trim()) throw new Error('任务内容不能为空。');
    if (title.trim().length > 300) throw new Error('任务内容不超过 300 个字符。');
  }
  const task = parseTasks(original).tasks.find(item => item.line === line);
  if (!task) throw new Error('任务行已变化，请刷新后重试。');
  if (action !== 'edit' && (task.state === '已完成' || task.conflict)) throw new Error('只支持完成待办或进行中的任务。');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original);
  const { lines, fields, headerEnd } = inspect(text);
  const index = (line as number) - 1;
  const raw = lines[index]?.replace(/[\r\n]+$/, '') ?? '';
  const match = raw.match(/^[-*][ \t]+(?:\[([ xX])\][ \t]*)?(\S.*)$/);
  if (!match) throw new Error('任务行已变化，请刷新后重试。');
  const newline = text.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  const ending = lines[index].match(/(?:\r\n|\n|\r)$/)?.[0] ?? '';
  if (action === 'delete') {
    lines.splice(index, 1);
  } else if (action === 'edit') {
    const prefix = raw.match(/^[-*][ \t]+(?:\[[ xX]\][ \t]*)?/)?.[0] ?? '';
    const body = raw.slice(prefix.length);
    // Keep the trailing @tags and the spacing before them verbatim; only the title changes.
    const tags = body.match(/((?:[ \t]*@[A-Za-z0-9_-]+)+)[ \t]*$/)?.[1] ?? '';
    const tail = tags && !/^[ \t]/.test(tags) ? ` ${tags}` : tags;
    const edited = `${prefix}${(title as string).trim()}${tail}${ending}`;
    if (edited === lines[index]) return original;
    lines[index] = edited;
  } else {
    const taskLine = `- [x] ${match[2]}${ending || newline}`;
    lines.splice(index, 1);
    const completed = taskSectionRange(lines, '已完成');
    if (completed) {
      const insertAt = completed.end;
      if (insertAt > 0 && !/[\r\n]$/.test(lines[insertAt - 1])) lines[insertAt - 1] += newline;
      lines.splice(insertAt, 0, taskLine);
    } else {
      if (lines.length && !/[\r\n]$/.test(lines.at(-1)!)) lines[lines.length - 1] += newline;
      lines.push(`${newline}## 已完成${newline}${taskLine}`);
    }
  }
  const updatedField = fields.get('updated')?.[0];
  if (updatedField) {
    const fieldEnding = lines[updatedField.index].match(/(?:\r\n|\n|\r)$/)?.[0] ?? '';
    lines[updatedField.index] = updatedField.prefix + today() + fieldEnding;
  } else {
    if (headerEnd > 0 && !/[\r\n]$/.test(lines[headerEnd - 1])) lines[headerEnd - 1] += newline;
    lines.splice(headerEnd, 0, `updated: ${today()}${newline}`);
  }
  return Buffer.from((text.startsWith('\uFEFF') ? '\uFEFF' : '') + lines.join(''), 'utf8');
}

export function updateRecord(original: Buffer, changes: { next?: unknown; summary?: unknown }) {
  if (changes.next !== undefined && (typeof changes.next !== 'string' || /[\r\n\0]/.test(changes.next) || changes.next.length > 4000)) {
    throw new Error('续接提示须为一行，且不超过 4000 个字符。');
  }
  if (changes.summary !== undefined && (typeof changes.summary !== 'string' || changes.summary.includes('\0') || changes.summary.length > 10000)) {
    throw new Error('交接摘要须为文本，且不超过 10000 个字符。');
  }
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original);
  const { lines, fields, headerEnd } = inspect(text);
  for (const key of changes.next === undefined ? ['updated'] : ['next', 'updated']) {
    if ((fields.get(key)?.length ?? 0) > 1) throw new Error(`${key} 存在重复项，请先在原文件中修正。`);
  }
  const current = fields.get('next')?.[0];
  const next = typeof changes.next === 'string' ? changes.next.trim() : current?.value ?? '';
  const { sections, openFence } = summarySections(lines);
  const summary = typeof changes.summary === 'string' ? changes.summary.replace(/\r\n|\r/g, '\n').replace(/^\n+|\n+$/g, '') : undefined;
  if (summary !== undefined && sections.length > 1) throw new Error('交接摘要存在重复分节，请先在原文件中合并。');
  if (summary !== undefined) {
    if (openFence) throw new Error('文件的代码块未闭合，请先在原文件中修正后再编辑摘要。');
    const proposedLines = linesOf(`## 交接摘要\n${summary}\n`);
    const proposed = summarySections(proposedLines);
    if (proposed.openFence || proposed.sections[0]?.end !== proposedLines.length || proposed.topHeading) {
      throw new Error('摘要中请使用正文、列表或 ### 小标题，代码块须闭合，不要新增一级或二级分节。');
    }
  }
  const nextChanged = changes.next !== undefined && (current?.value ?? '') !== next;
  const summaryChanged = summary !== undefined && summary !== (sections[0] ? summaryText(lines, sections[0]) : '');
  if (!nextChanged && !summaryChanged) return original;
  const newline = text.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  if (summaryChanged) {
    const body = `${newline}${summary!.replace(/\n/g, newline)}${summary ? newline : ''}${newline}`;
    if (sections[0]) {
      const section = sections[0];
      if (!/[\r\n]$/.test(lines[section.start])) lines[section.start] += newline;
      lines.splice(section.start + 1, section.end - section.start - 1, body);
    } else {
      if (lines.length && !/[\r\n]$/.test(lines.at(-1)!)) lines[lines.length - 1] += newline;
      lines.push(`${newline}## 交接摘要${newline}${body}`);
    }
  }
  const additions: string[] = [];
  const updates = nextChanged ? [['next', next], ['updated', today()]] : [['updated', today()]];
  for (const [key, value] of updates) {
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
  return `# ${name}\n\nstatus: 进行中\nnext:\nupdated: ${today()}\n\n## 交接摘要\n\n## 待办\n\n## 进行中\n\n## 已完成\n\n## 工作留痕\n`;
}
