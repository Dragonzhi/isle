import * as fs from 'node:fs/promises';
import type { AdapterKind, Evidence, ProjectSkill, SkillCounts, SkillFile, SkillState } from '../shared/types.ts';

export type { AdapterKind, Evidence } from '../shared/types.ts';

// 案屿拥有这份落点的哪一份字节，决定写入路径：
// - 整文件（canonical / entry）走 history.json 的版本判定：只有等于当前模板或某个已发布哈希才替换。
// - 受管区块（marker）只拥有 begin 到 end 之间，块外一律不碰（S2 实现）。
export type AdapterTemplate = 'skill' | 'metadata' | 'entry' | 'marker';

export type Adapter = {
  agent: string;
  key: string;
  path: string;
  kind: AdapterKind;
  evidence: Evidence;
  // 该落点用哪份模板落字节。marker 在 S1 阶段还没有写入实现。
  template: AdapterTemplate;
  // 存在这个相对路径，就认为该项目在用这家 agent。仅用于推荐，不用于强制过滤。
  detect?: string;
  // 落点机制的简短说明，随 status 返回给界面。
  note?: string;
};

export const SKILL_TEMPLATE = new URL('../skills/isle/SKILL.md', import.meta.url);
export const METADATA_TEMPLATE = new URL('../skills/isle/agents/openai.yaml', import.meta.url);

// 入口文件用 \n 转义而不是多行模板字符串：仓库 core.autocrlf=true 时，
// 多行模板会把 CRLF 混进模板字节，和已发布哈希对不上。
export const ENTRY_TEMPLATE = Buffer.from('---\nname: isle\ndescription: 案屿开工、收工和项目交接入口；需要按案屿规范回写 TASKS.md 时使用。\n---\n\n# 案屿项目交接\n\n先完整读取并遵循[通用案屿规范](../../../.agents/skills/isle/SKILL.md)，再按用户要求执行开工或收工。\n规范文件位于项目根目录的 .agents/skills/isle/SKILL.md，任务文件为同一项目根目录的 TASKS.md，不在此入口目录下。\n如果通用规范缺失，提示用户在案屿中补齐项目 Skill，不自行编造规则。\n');

// 项目级落点表。新增一家 agent 只加一行：path 一律相对项目根、正斜杠、不带前导 ./。
// evidence 决定默认装不装：local / docs 默认参与安装，unverified 默认不装，需用户显式打开。
export const ADAPTERS: Adapter[] = [
  {
    // DeepSeek Harness 的项目级 skill 根就是 .agents/skills（rank 200），与 Codex 共用这份正文，
    // 所以这里不另写一份：同一份 Skill 出现在两个根下会在目录里重复同名条目。
    agent: 'Codex / DeepSeek Harness',
    key: 'agents-skill',
    path: '.agents/skills/isle/SKILL.md',
    kind: 'canonical',
    evidence: 'local',
    template: 'skill',
    detect: '.agents',
    note: '规范正文。Codex 读 .codex/skills 与 .agents/skills；DeepSeek Harness 的项目级根是 .dsh/skills（rank 100）与 .agents/skills（rank 200），都从这里发现',
  },
  {
    agent: 'Codex',
    key: 'agents-metadata',
    path: '.agents/skills/isle/agents/openai.yaml',
    kind: 'canonical',
    evidence: 'local',
    template: 'metadata',
    detect: '.agents',
    note: 'Codex 读取的技能元数据',
  },
  {
    agent: 'Claude Code',
    key: 'claude-entry',
    path: '.claude/skills/isle/SKILL.md',
    kind: 'entry',
    evidence: 'local',
    template: 'entry',
    detect: '.claude',
    note: '入口文件，用相对链接指回 .agents 的规范正文',
  },
  {
    agent: 'Trae',
    key: 'trae-entry',
    path: '.trae/skills/isle/SKILL.md',
    kind: 'entry',
    evidence: 'local',
    template: 'entry',
    detect: '.trae',
    note: 'Trae 工作区 skill 目录（.trae/skills/<name>/SKILL.md）的入口文件',
  },
  {
    agent: 'ZCode',
    key: 'zcode-entry',
    path: '.zcode/skills/isle/SKILL.md',
    kind: 'entry',
    evidence: 'local',
    template: 'entry',
    detect: '.zcode',
    note: 'ZCode 工作区 skill 根（.zcode/skills）的入口文件',
  },
  {
    agent: 'AGENTS.md 通用约定',
    key: 'agents-md',
    path: 'AGENTS.md',
    kind: 'marker',
    evidence: 'local',
    template: 'marker',
    detect: 'AGENTS.md',
    note: 'Codex、DeepSeek Harness、ZCode 都会读项目根的 AGENTS.md；只注入受管区块',
  },
  {
    agent: 'CLAUDE.md 通用约定',
    key: 'claude-md',
    path: 'CLAUDE.md',
    kind: 'marker',
    evidence: 'docs',
    template: 'marker',
    detect: 'CLAUDE.md',
    note: 'Claude Code 读项目根的 CLAUDE.md；只注入受管区块',
  },
];

// 证据不足的落点默认不装；调用方可以显式打开某一条（设置里勾选）。
export function adapterEnabled(adapter: Adapter, enabled: readonly string[] = []): boolean {
  return adapter.evidence !== 'unverified' || enabled.includes(adapter.key);
}

// 返回每条落点要落盘的字节。marker 在 S1 阶段没有写入实现，data 为 null，由调用方跳过。
export async function loadedAdapters(): Promise<{ adapter: Adapter; data: Buffer | null }[]> {
  const [skill, metadata] = await Promise.all([fs.readFile(SKILL_TEMPLATE), fs.readFile(METADATA_TEMPLATE)]);
  return ADAPTERS.map(adapter => {
    const data = adapter.template === 'skill' ? skill
      : adapter.template === 'metadata' ? metadata
      : adapter.template === 'entry' ? ENTRY_TEMPLATE
      : null;
    return { adapter, data };
  });
}

// history.json 的旧键：skill / metadata / entry 是 S1 之前的写法。
// 读旧文件必须先迁到带 agent 前缀的键，否则已装好的项目会被判成 custom 而拒绝升级。
// entry 过去由两个入口共用一份哈希，迁移时要同时喂给两家。
const LEGACY_HISTORY_KEYS: Record<string, string[]> = {
  skill: ['agents-skill'],
  metadata: ['agents-metadata'],
  entry: ['claude-entry', 'trae-entry'],
};

export function migrateHistory(table: Record<string, string[]>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(table)) result[key] = [...value];
  for (const [legacy, keys] of Object.entries(LEGACY_HISTORY_KEYS)) {
    const hashes = result[legacy];
    if (!hashes?.length) continue;
    delete result[legacy];
    for (const key of keys) result[key] = [...new Set([...(result[key] ?? []), ...hashes])];
  }
  return result;
}

export function emptyCounts(): SkillCounts {
  return { ready: 0, missing: 0, custom: 0, outdated: 0, error: 0, skipped: 0, unverified: 0 };
}

export function countStates(files: SkillFile[]): SkillCounts {
  const counts = emptyCounts();
  for (const file of files) counts[file.state] += 1;
  return counts;
}

// skipped / unverified 是「案屿不写」或「证据不足」，不参与整体就绪判定：
// 否则加一条候选适配器就会把已装好的项目从「就绪」打成「部分」。
const inert: SkillState[] = ['skipped', 'unverified'];

export function skillReport(files: SkillFile[]): ProjectSkill {
  const active = files.filter(file => !inert.includes(file.state));
  const primary = active[0]?.state;
  const state: SkillState | 'partial' = !active.length ? 'ready'
    : active.every(file => file.state === 'ready') ? 'ready'
    : active.some(file => file.state === 'error') ? 'error'
    : primary === 'custom' ? 'custom'
    : active.some(file => file.state === 'outdated') ? 'outdated'
    : active.every(file => file.state === 'missing') ? 'missing' : 'partial';
  return { state, files, counts: countStates(files) };
}
