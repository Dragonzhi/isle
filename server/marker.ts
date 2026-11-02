// 受管区块：案屿只在 <!-- isle:begin --> 与 <!-- isle:end --> 之间拥有字节。
// 块外一律按 Buffer 原样保留，不做全量 toString 再重编码，否则 BOM、混合换行和用户内容都会被改写。
export const MARKER_BEGIN = '<!-- isle:begin -->';
export const MARKER_END = '<!-- isle:end -->';

const BEGIN = Buffer.from(MARKER_BEGIN);
const END = Buffer.from(MARKER_END);

// 注入内容固定，不要加长：只写指针，不复制规范正文（单一真源仍是 .agents/skills/isle/SKILL.md）。
const BODY = [
  MARKER_BEGIN,
  '## 案屿（Isle）项目交接',
  '',
  '本项目用案屿管理任务与交接记录。开工或收工前，先读取 `.agents/skills/isle/SKILL.md` 并按其规范执行；任务、交接摘要与工作留痕在项目根目录的 `TASKS.md`。',
  MARKER_END,
];

export type Eol = '\n' | '\r\n';

export function markerBlock(eol: Eol = '\n') {
  return BODY.join(eol) + eol;
}

function find(data: Buffer, needle: Buffer) {
  const found: number[] = [];
  let index = data.indexOf(needle);
  while (index >= 0) {
    found.push(index);
    index = data.indexOf(needle, index + needle.length);
  }
  return found;
}

export type Region = { start: number; end: number };
export type MarkerScan = { complete: number; broken: boolean; regions: Region[] };

// 逐个配对 begin 与 end。begin 少了 end、end 在 begin 之前、或块之间互相交叉，一律算「不完整」，
// 交给用户手动处理，绝不猜边界。
export function scanMarker(data: Buffer): MarkerScan {
  const starts = find(data, BEGIN);
  const ends = find(data, END);
  if (!starts.length && !ends.length) return { complete: 0, broken: false, regions: [] };
  const regions: Region[] = [];
  let cursor = 0;
  for (const start of starts) {
    const end = ends.find(value => value > start && value >= cursor);
    if (end === undefined) return { complete: 0, broken: true, regions: [] };
    regions.push({ start, end });
    cursor = end + END.length;
  }
  // 有 end 落在所有 begin 之前，同样是残缺标记。
  if (ends.some(value => !regions.some(region => region.end === value))) return { complete: 0, broken: true, regions: [] };
  return { complete: regions.length, broken: false, regions };
}

export function hasBom(data: Buffer) {
  return data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf;
}

// 换行风格：先看全文主风格（CRLF 超过一半即 CRLF），混合时再按块所在位置之前最近的一处为准。
export function detectEol(data: Buffer, at = data.length): { eol: Eol; warning?: string } {
  const text = data.toString('utf8');
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const newlines = (text.match(/\n/g) ?? []).length;
  if (!newlines) return { eol: '\n', warning: '文件中没有换行，无法判断换行风格，已按 LF 写入' };
  const lone = newlines - crlf;
  if (crlf && lone) {
    const before = data.subarray(0, Math.min(at, data.length)).toString('utf8');
    const index = before.lastIndexOf('\n');
    const eol: Eol = index > 0 && before[index - 1] === '\r' ? '\r\n' : '\n';
    return { eol, warning: '文件混用 CRLF 与 LF，受管区块按最近的换行写入' };
  }
  return { eol: crlf * 2 > newlines ? '\r\n' : '\n' };
}

function eolAt(data: Buffer, index: number): number {
  if (data[index] === 0x0d && data[index + 1] === 0x0a) return 2;
  if (data[index] === 0x0a) return 1;
  return 0;
}

function endsWithEol(data: Buffer) {
  return data.length > 0 && data[data.length - 1] === 0x0a;
}

function blockBytes(eol: Eol, trailing: boolean) {
  const block = markerBlock(eol);
  return Buffer.from(trailing ? block : block.slice(0, -eol.length));
}

function replaceRegion(data: Buffer, region: Region, eol: Eol) {
  const afterEnd = region.end + END.length;
  const trailing = eolAt(data, afterEnd);
  return Buffer.concat([data.subarray(0, region.start), blockBytes(eol, trailing > 0), data.subarray(afterEnd + trailing)]);
}

// 删掉一整块，连同案屿追加时补的那个空行。只删块是安全的；难点是块前后各留了多少空白。
function removeRegion(data: Buffer, region: Region) {
  const afterEnd = region.end + END.length;
  let end = afterEnd;
  const trailing = eolAt(data, afterEnd);
  if (trailing) end += trailing;
  const tail = data.subarray(end).toString('utf8');
  let start = region.start;
  // 只有块后面再没有真实内容时，才把块前那个空白分隔行一起收掉；
  // 否则会把这行和下一行粘在一起，宁可留一个空行也不改用户内容。
  if (!tail.trim()) {
    const before = data.subarray(0, region.start).toString('utf8');
    const match = before.match(/(\r\n|\n)$/);
    if (match) {
      const rest = before.slice(0, before.length - match[1].length);
      if (/(\r\n|\n)$/.test(rest)) start -= match[1].length;
    }
  }
  return Buffer.concat([data.subarray(0, start), data.subarray(end)]);
}

// 写入：不存在块就追加（先补行尾、再补空行、再写块），恰有一块就只替换块内，
// 多块收敛成一份。标记不完整时不写，返回错误交给界面显示。
export function installMarker(data: Buffer): { data: Buffer; warning?: string } | { error: string } {
  const scan = scanMarker(data);
  if (scan.broken) return { error: '标记不完整，请手动检查后再试' };
  const style = detectEol(data, scan.regions[0]?.start ?? data.length);
  if (!scan.regions.length) {
    const parts: Buffer[] = [data];
    if (data.length) {
      if (!endsWithEol(data)) parts.push(Buffer.from(style.eol));
      parts.push(Buffer.from(style.eol));
    }
    parts.push(blockBytes(style.eol, true));
    return { data: Buffer.concat(parts), warning: style.warning };
  }
  let out = data;
  // 从最后一块往前删，前面几块的偏移才不会失效。
  for (let index = scan.regions.length - 1; index >= 1; index--) out = removeRegion(out, scan.regions[index]);
  out = replaceRegion(out, scan.regions[0], style.eol);
  return { data: out, warning: scan.regions.length > 1 ? `发现 ${scan.regions.length} 个受管区块，已收敛为一份` : style.warning };
}

export function removeMarker(data: Buffer): { data: Buffer } | { error: string } {
  const scan = scanMarker(data);
  if (scan.broken) return { error: '标记不完整，请手动检查后再试' };
  let out = data;
  for (let index = scan.regions.length - 1; index >= 0; index--) out = removeRegion(out, scan.regions[index]);
  return { data: out };
}

export function isBlank(data: Buffer) {
  return !data.toString('utf8').replace(/^\uFEFF/, '').trim();
}
