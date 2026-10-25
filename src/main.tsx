import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GitHistory, Project, ProjectSkill, Snapshot, Task, TaskState, Workspace, Workspaces } from '../shared/types.ts';
import { closeout, focusTask, handoff, skillTransfer, worktrees } from '../shared/types.ts';
import { SummaryMarkdown } from './SummaryMarkdown.ts';
import { orderHistory } from './history.ts';
import { formatNext } from './next.ts';
import styles from './App.module.css';

class RequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function request(method = 'GET', suffix = '', input?: unknown, endpoint = '/api/projects'): Promise<any> {
  const response = await fetch(endpoint + suffix, {
    method, credentials: 'same-origin',
    headers: input === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(data.error || '操作失败，请重试。', response.status);
  return data;
}
async function api(method = 'GET', suffix = '', input?: unknown, endpoint = '/api/projects'): Promise<Snapshot> {
  return request(method, suffix, input, endpoint);
}

function Icon({ name, size = 18, strokeWidth = 1.5 }: { name: 'plus' | 'copy' | 'arrow' | 'refresh' | 'close' | 'island' | 'edit' | 'branch' | 'trash' | 'people' | 'chevron' | 'list' | 'grid' | 'more' | 'check' | 'folder'; size?: number; strokeWidth?: number }) {
  const paths = {
    plus: 'M12 5v14M5 12h14', copy: 'M9 9h11v11H9zM15 9V4H4v11h5',
    arrow: 'M5 12h14m-6-6 6 6-6 6', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12 0l2 5M4 12l2 5a7 7 0 0 0 12 0',
    close: 'm6 6 12 12M6 18 18 6', island: 'M3 18c3-2 5 2 8 0s5 2 10 0M5 14l6-9 7 9H5Z',
    edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14 6l4 4',
    branch: 'M6 3v18M6 6a3 3 0 1 0 0 6 3 3 0 1 0 0-6M18 3a3 3 0 1 0 0 6 3 3 0 1 0 0-6M6 9h6a6 6 0 0 0 6-6',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
    people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    chevron: 'm9 18 6-6-6-6',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    check: 'M20 6 9 17l-5-5',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); close(); }}>
    <div className={styles.dialogHeading}><h2 id="dialog-title">{title}</h2><button className={styles.iconButton} aria-label="关闭" onClick={close}><Icon name="close" /></button></div>
    {children}
  </dialog>;
}

function stale(project: Project) { return project.state === 'ok' && project.status === '进行中' && project.age >= 7 && !project.estimated; }
function freshness(project: Project) {
  if (project.state !== 'ok') return project.state === 'offline' ? '离线' : '读取失败';
  if (project.age < 0) return '日期异常';
  return (project.age === 0 ? '今天' : project.age === 1 ? '昨天' : `${project.age} 天前`) + (project.estimated ? ' (估值)' : '');
}

function baseName(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || value;
}
function groupLabel(projects: Project[], group: string) {
  return projects.find(project => project.group === group && project.role === 'main')?.name ?? baseName(group);
}

const worktreePlaceholder = 'feature/minecraft\nfeature/memes';
function parseWorktreeInput(text: string, repoName: string) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [branchPart, dirPart] = line.split('|').map(part => part.trim());
    const parts = branchPart.split('/').filter(Boolean);
    const label = parts.length > 1 ? parts.slice(1).join('-') : (parts[0] || branchPart);
    const dir = dirPart || (repoName + '-' + label);
    return { branch: branchPart, dir };
  }).filter(item => item.branch);
}

type Editing = { id: string; kind: 'next' | 'summary'; value: string; hash: string; baseline: string; conflict?: boolean; reviewed?: boolean };
type TransferFormat = 'skill' | 'full';
type ProjectFilter = 'all' | 'active' | 'paused' | 'offline';
type ProjectView = 'list' | 'cards';
type DetailSection = 'summary' | 'history' | 'git';
type TextSize = 'standard' | 'large' | 'xlarge';
type BoardGroup = { key: string; members: Project[]; multi: boolean; total: number; latest: string; done: boolean };
const TEXT_SIZE_KEY = 'isle.text-size';
const PROJECT_VIEW_KEY = 'isle.project-view';
const GIT_VISIBLE = 12;
const textSizeOptions: { value: TextSize; label: string; px: string }[] = [
  { value: 'standard', label: '标准', px: '17.5px' },
  { value: 'large', label: '大', px: '19px' },
  { value: 'xlarge', label: '特大', px: '20.5px' },
];
function readTextSize(): TextSize {
  try {
    const saved = localStorage.getItem(TEXT_SIZE_KEY);
    return saved === 'large' || saved === 'xlarge' ? saved : 'standard';
  } catch { return 'standard'; }
}
function readProjectView(): ProjectView {
  try { return localStorage.getItem(PROJECT_VIEW_KEY) === 'cards' ? 'cards' : 'list'; }
  catch { return 'list'; }
}
function transferText(project: Project, mode: 'start' | 'close', format: TransferFormat, author: string, criteria: string, goal: string) {
  return format === 'skill' ? skillTransfer(project, mode, author, criteria, goal) : mode === 'close' ? closeout(project, author) : handoff(project, criteria, goal, author);
}
const skillLabels = { ready: '已就绪', missing: '尚未安装', partial: '部分入口待补齐', outdated: '有官方新版本，可升级', custom: '已有自定义同名 Skill', error: '无法安装或读取' };
function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const [onlyStale, setOnlyStale] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [filter, setFilter] = useState<ProjectFilter>('all');
  const [textSize, setTextSize] = useState<TextSize>(readTextSize);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [view, setView] = useState<ProjectView>(readProjectView);
  const [moreOpen, setMoreOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<DetailSection, boolean>>({ summary: false, history: false, git: false });
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<'add' | Project | null>(null);
  const [formPath, setFormPath] = useState('');
  const [formName, setFormName] = useState('');
  const [installSkill, setInstallSkill] = useState(true);
  const [formError, setFormError] = useState('');
  const [handoffProject, setHandoffProject] = useState<Project | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [taskDelete, setTaskDelete] = useState<{ project: Project; task: Task } | null>(null);
  const [handoffMode, setHandoffMode] = useState<'start' | 'close'>('start');
  const [transferFormat, setTransferFormat] = useState<TransferFormat>('full');
  const [goal, setGoal] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const [worktreeBase, setWorktreeBase] = useState('main');
  const [worktreeInput, setWorktreeInput] = useState('');
  const [worktreeNote, setWorktreeNote] = useState('');
  const [workspacePicker, setWorkspacePicker] = useState<{ project: Project; list: Workspaces | null; selected: string[]; names: Record<string, string>; installSkill: boolean; loading: boolean; error: string } | null>(null);
  const [summaryCopy, setSummaryCopy] = useState<string | null>(null);
  const [git, setGit] = useState<{ id: string; history: GitHistory | null; loading: boolean; error: string; all: boolean }>({ id: '', history: null, loading: false, error: '', all: false });
  const [gitCopy, setGitCopy] = useState<string | null>(null);
  const [skill, setSkill] = useState<{ id: string; status: ProjectSkill | null; loading: boolean; error: string }>({ id: '', status: null, loading: false, error: '' });
  const [criteria, setCriteria] = useState('');
  const [authors, setAuthors] = useState({ start: '', close: '' });
  const [agentDraft, setAgentDraft] = useState<{ value: string; hash: string | null } | null>(null);
  const [agentError, setAgentError] = useState('');
  const [route, setRoute] = useState(location.hash);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const arrival = useRef(0);
  const editInput = useRef<HTMLInputElement>(null);
  const summaryInput = useRef<HTMLTextAreaElement>(null);
  const gitToken = useRef(0);
  const skillToken = useRef(0);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreItemRef = useRef<HTMLButtonElement>(null);

  const accept = (snapshot: Snapshot) => { arrival.current = performance.now(); setData(snapshot); };
  async function refresh() {
    setLoading(true);
    try { const snapshot = await api(); accept(snapshot); return snapshot; }
    catch (error) { setNotice({ message: (error as Error).message, error: true }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); const change = () => setRoute(location.hash); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => {
    if (!data) return;
    const frame = requestAnimationFrame(() => {
      const duration = performance.now() - arrival.current;
      setRenderMs(duration);
      performance.clearMeasures('isle:projects-render');
      performance.measure('isle:projects-render', { start: arrival.current, end: performance.now() });
    });
    return () => cancelAnimationFrame(frame);
  }, [data]);
  useEffect(() => { (editing?.kind === 'summary' ? summaryInput.current : editInput.current)?.focus(); }, [editing?.id, editing?.kind]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    try { localStorage.setItem(TEXT_SIZE_KEY, textSize); } catch { /* 隐私模式或存储不可用时只影响本次会话。 */ }
  }, [textSize]);
  useEffect(() => {
    try { localStorage.setItem(PROJECT_VIEW_KEY, view); } catch { /* 隐私模式或存储不可用时只影响本次会话。 */ }
  }, [view]);

  const projects = data?.projects ?? [];
  const currentId = route.startsWith('#project/') ? route.slice(9) : '';
  const current = projects.find(project => project.id === currentId);
  const done = projects.filter(project => project.status === '已完成');
  const activeProjects = projects.filter(project => project.status !== '已完成');
  const tabBase = activeProjects.filter(project => !onlyStale || stale(project));
  const countTabGroups = (predicate: (project: Project) => boolean) => new Set(tabBase.filter(predicate).map(project => project.group ?? 'project:' + project.id)).size;
  const filterCounts = {
    all: countTabGroups(() => true),
    active: countTabGroups(project => project.state === 'ok' && project.status === '进行中'),
    paused: countTabGroups(project => project.state === 'ok' && project.status === '暂停'),
    offline: countTabGroups(project => project.state !== 'ok'),
  };
  const matchesFilter = (project: Project) => filter === 'all'
    || (filter === 'active' && project.state === 'ok' && project.status === '进行中')
    || (filter === 'paused' && project.state === 'ok' && project.status === '暂停')
    || (filter === 'offline' && project.state !== 'ok');
  const visible = projects.filter(project => (showDone || project.status !== '已完成') && (!onlyStale || stale(project)) && matchesFilter(project));
  const oldCount = projects.filter(stale).length;
  const activeGroupCount = new Set(activeProjects.map(project => project.group ?? 'project:' + project.id)).size;
  const groupTotals = new Map<string, number>();
  for (const project of projects) {
    const key = project.group ?? 'project:' + project.id;
    groupTotals.set(key, (groupTotals.get(key) ?? 0) + 1);
  }
  const currentGroup = current?.group ? { label: groupLabel(projects, current.group), count: projects.filter(project => project.group === current.group).length, role: current.role } : null;
  const historyView = current?.history ? orderHistory(current.history) : null;
  const historyHint = historyView?.parsed
    ? historyView.outOfOrder ? '按日期倒序 · 文件顺序已校准' : '按日期倒序 · 原文顺序保留'
    : '按次追加 · Agent 自述';
  const historyHintTitle = historyView?.parsed
    ? historyView.outOfOrder
      ? 'TASKS.md 原文顺序与日期不一致，界面已按日期倒序显示；原文未改。'
      : '界面按日期倒序显示；TASKS.md 原文保留原顺序。'
    : '按文件追加顺序显示。';
  const currentNext = formatNext(current?.next ?? '');
  useEffect(() => {
    setOpenSections({ summary: false, history: false, git: false });
    setMoreOpen(false);
  }, [current?.id]);
  useEffect(() => {
    if (!moreOpen) return;
    moreItemRef.current?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!moreMenuRef.current?.contains(target) && !moreButtonRef.current?.contains(target)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);
  const boardGroups = (() => {
    const buckets = new Map<string, Project[]>();
    for (const project of visible) {
      const key = project.group ?? 'project:' + project.id;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(project); else buckets.set(key, [project]);
    }
    return [...buckets.entries()].map(([key, members]) => {
      const sorted = [...members].sort((a, b) => Number(a.status === '已完成') - Number(b.status === '已完成') || Number(b.role === 'main') - Number(a.role === 'main') || b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name, 'zh-CN'));
      const latest = members.reduce((max, project) => project.updated > max ? project.updated : max, '');
      const done = members.every(project => project.status === '已完成');
      const total = groupTotals.get(key) ?? members.length;
      return { key, members: sorted, multi: total > 1, total, latest, done };
    }).sort((a, b) => Number(a.done) - Number(b.done) || b.latest.localeCompare(a.latest));
  })();
  const navOrder = boardGroups.flatMap(group => group.members);

  async function latestProject(project: Project) {
    const snapshot = await api();
    accept(snapshot);
    const latest = snapshot.projects.find(item => item.id === project.id);
    if (!latest || latest.state !== 'ok') throw new Error(latest?.error || '项目已离线或移出看板，请检查后重试。');
    if (typeof latest.history !== 'string' || !Array.isArray(snapshot.agents)) throw new Error('本机服务仍是旧版本，请关闭启动窗口并重新启动案屿。');
    return latest;
  }
  async function openTransfer(project: Project, mode: 'start' | 'close') {
    if (busy || editing) return;
    setBusy(true);
    try {
      const latest = await latestProject(project);
      const status = await loadSkill(latest);
      setTransferFormat(status?.state === 'ready' ? 'skill' : 'full');
      setHandoffProject(latest); setHandoffMode(mode); setGoal(''); setCriteria(''); setTransferNote(''); setAuthors({ start: '', close: '' });
    } catch (error) { setNotice({ message: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }
  async function copy(project: Project, mode: 'start' | 'close' = 'start', standard = '', target = '', author = '', format?: TransferFormat) {
    if (busy || editing) return;
    setBusy(true);
    try {
      const latest = await latestProject(project);
      if (handoffProject?.id === project.id && latest.hash !== project.hash) {
        setHandoffProject(latest); setTransferNote('文件已更新，预览已刷新。请核对后再次复制。'); return;
      }
      const status = await loadSkill(latest);
      const chosenFormat = format ?? (status?.state === 'ready' ? 'skill' : 'full');
      if (chosenFormat === 'skill' && status?.files[0]?.state !== 'ready') {
        setTransferNote('通用 Skill 尚未就绪或已被修改，请先检查项目 Skill，或切换到完整提示词。'); return;
      }
      try {
        await navigator.clipboard.writeText(transferText(latest, mode, chosenFormat, author, standard, target));
        const message = mode === 'close' ? `${chosenFormat === 'skill' ? '收工短指令' : '收工词'}已复制，发给当前 Agent 回写后再刷新。` : `${chosenFormat === 'skill' ? '开工短指令' : '开工词'}已复制，发给下一位 Agent。`;
        if (handoffProject) setTransferNote(message); else setNotice({ message });
      } catch {
        setHandoffProject(latest); setHandoffMode(mode); setGoal(target); setCriteria(standard);
        setTransferFormat(chosenFormat);
        setAuthors(previous => ({ ...previous, [mode]: author }));
        setTransferNote('无法自动复制，请选中下方预览文本手动复制。');
      }
    } catch (error) {
      if (handoffProject) setTransferNote((error as Error).message);
      else setNotice({ message: (error as Error).message, error: true });
    } finally { setBusy(false); }
  }
  async function refreshTransfer() {
    if (!handoffProject || busy) return;
    setBusy(true);
    try {
      const latest = await latestProject(handoffProject);
      setTransferNote(latest.hash === handoffProject.hash ? '尚未检测到文件变化。先让当前 Agent 回写，再刷新。' : '文件已变化，已读取最新记录。核对交接摘要后，可切换到开工词。');
      setHandoffProject(latest);
    } catch (error) { setTransferNote((error as Error).message); }
    finally { setBusy(false); }
  }

  async function openAgents() {
    if (busy || editing) return;
    setBusy(true);
    try {
      const snapshot = await api(); accept(snapshot);
      if (!Array.isArray(snapshot.agents)) throw new Error('请重启案屿本机服务后编辑 Agent 名单。');
      setAgentDraft({ value: snapshot.agents.join('\n'), hash: snapshot.settingsHash });
      setAgentError(snapshot.settingsHash === null ? '名单无法读取，请先修正 settings.json 的格式或访问权限，再重新打开。' : '');
    } catch (error) { setNotice({ message: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }
  async function saveAgents(event: React.FormEvent) {
    event.preventDefault();
    if (!agentDraft || agentDraft.hash === null || busy) return;
    setBusy(true); setAgentError('');
    try {
      accept(await api('PATCH', '', { agents: agentDraft.value.split(/\r?\n/).map(name => name.trim()).filter(Boolean), settingsHash: agentDraft.hash }, '/api/agents'));
      setAgentDraft(null); setNotice({ message: 'Agent 名单已保存，已有署名记录保留原样。' });
    } catch (error) { setAgentError((error as Error).message); }
    finally { setBusy(false); }
  }

  async function copySummary(project: Project) {
    if (busy || editing) return;
    setBusy(true);
    try {
      const latest = await latestProject(project);
      if (!latest.summary.trim()) { setNotice({ message: '当前没有可复制的交接摘要。' }); return; }
      try {
        await navigator.clipboard.writeText(latest.summary);
        setNotice({ message: '已复制交接摘要的 Markdown 原文。' });
      } catch { setSummaryCopy(latest.summary); }
    } catch (error) { setNotice({ message: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }
  async function loadSkill(project: Project) {
    const token = ++skillToken.current;
    setSkill({ id: project.id, status: null, loading: true, error: '' });
    try {
      const status = await request('GET', `/${project.id}/skill`) as ProjectSkill;
      if (token === skillToken.current) setSkill({ id: project.id, status, loading: false, error: '' });
      return status;
    } catch (error) {
      if (token === skillToken.current) setSkill({ id: project.id, status: null, loading: false, error: (error as Error).message });
    }
  }
  async function installProjectSkill(project: Project) {
    if (busy) return;
    setBusy(true);
    const token = ++skillToken.current;
    try {
      const status = await request('POST', `/${project.id}/skill`, {}) as ProjectSkill;
      if (token === skillToken.current) setSkill({ id: project.id, status, loading: false, error: '' });
      setNotice({ message: status.state === 'ready' ? '项目 Skill 已就绪，可以复制短指令。' : status.state === 'outdated' ? '仍有官方旧版未能升级，请重试或查看各入口状态。' : '未覆盖已有文件；请查看各入口的状态并核对。', error: status.state !== 'ready' });
    } catch (error) { setNotice({ message: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }
  function stamp() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
  function gitCommand(project: Project) {
    const target = `"${project.path}"`;
    return `git -C ${target} add TASKS.md && git -C ${target} commit -m "案屿交接回写 ${stamp()}" && git -C ${target} push`;
  }
  async function loadGit(project: Project) {
    if (project.state !== 'ok') return;
    const token = ++gitToken.current;
    setGit({ id: project.id, history: null, loading: true, error: '', all: false });
    try {
      const history = await request('GET', `/${project.id}/git`) as GitHistory;
      if (token === gitToken.current) setGit({ id: project.id, history, loading: false, error: '', all: false });
    } catch (error) {
      if (token === gitToken.current) setGit({ id: project.id, history: null, loading: false, error: (error as Error).message, all: false });
    }
  }
  async function copyGit(project: Project) {
    if (busy) return;
    const command = gitCommand(project);
    try { await navigator.clipboard.writeText(command); setNotice({ message: '已复制提交/推送命令，粘贴到终端自行运行；案屿不会代替你执行。' }); }
    catch { setGitCopy(command); }
  }
  async function openFolder(project: Project) {
    if (busy || project.state !== 'ok') return;
    setBusy(true);
    try {
      await request('POST', `/${project.id}/reveal`, {});
      setNotice({ message: '已在系统文件管理器中打开项目目录。' });
    } catch (error) { setNotice({ message: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (current && current.state === 'ok') void loadGit(current);
    else setGit(previous => previous.id ? { id: '', history: null, loading: false, error: '', all: false } : previous);
  }, [current?.id, current?.state]);
  useEffect(() => {
    if (current && current.state === 'ok') void loadSkill(current);
    else { skillToken.current++; setSkill(previous => previous.id ? { id: '', status: null, loading: false, error: '' } : previous); }
  }, [current?.id, current?.state]);

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || form || agentDraft || handoffProject || summaryCopy !== null || gitCopy !== null || worktreeOpen || workspacePicker || settingsOpen || moreOpen || currentId || busy || editing || event.isComposing) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') { setSelected(''); return; }
      const index = navOrder.findIndex(project => project.id === selected);
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const next = navOrder[Math.max(0, Math.min(navOrder.length - 1, index < 0 ? 0 : index + (event.key === 'j' ? 1 : -1)))];
        if (next) { setSelected(next.id); document.getElementById(`project-${next.id}`)?.scrollIntoView({ block: 'nearest' }); }
      }
      const project = navOrder[index];
      if (!project) return;
      if (event.key === 'Enter' && !target.closest('button,a') && project.state !== 'offline') { event.preventDefault(); location.hash = `project/${project.id}`; }
      if (event.key === 'c' && project.state === 'ok') { event.preventDefault(); void copy(project); }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [navOrder, selected, form, agentDraft, handoffProject, summaryCopy, gitCopy, worktreeOpen, workspacePicker, settingsOpen, moreOpen, currentId, busy, editing]);

  async function openWorkspacePicker(project: Project) {
    setWorkspacePicker({ project, list: null, selected: [], names: {}, installSkill: true, loading: true, error: '' });
    try {
      const list = await request('GET', `/${project.id}/workspaces`) as Workspaces;
      setWorkspacePicker(previous => previous?.project.id === project.id ? { ...previous, list, names: Object.fromEntries(list.entries.map(entry => [entry.path, entry.name])), loading: false } : previous);
    } catch (error) {
      setWorkspacePicker(previous => previous?.project.id === project.id ? { ...previous, loading: false, error: (error as Error).message } : previous);
    }
  }
  async function addSelectedWorkspaces() {
    if (!workspacePicker || !data || busy || !workspacePicker.selected.length) return;
    setBusy(true);
    let snapshot = data;
    const added: string[] = [];
    try {
      for (const target of workspacePicker.selected) {
        snapshot = await api('POST', `/${workspacePicker.project.id}/workspaces`, { path: target, name: workspacePicker.names[target], registryHash: snapshot.registryHash, installSkill: workspacePicker.installSkill });
        added.push(target);
        accept(snapshot);
      }
      setWorkspacePicker(null);
      setNotice({ message: `已添加 ${added.length} 个工作区；按所属项目自动分组。请分别核对方向任务与下一步。` });
    } catch (error) {
      const message = (error as Error).message;
      const latest = await refresh();
      const known = new Set((latest ?? snapshot).projects.map(project => project.path.toLowerCase()));
      setWorkspacePicker(previous => previous ? { ...previous, selected: previous.selected.filter(target => !known.has(target.toLowerCase())), list: previous.list ? { ...previous.list, entries: previous.list.entries.map(entry => ({ ...entry, registered: known.has(entry.path.toLowerCase()) })) } : null, error: `${added.length ? `已添加 ${added.length} 个；` : ''}${message}。已添加的工作区会保留。` } : previous);
    } finally { setBusy(false); }
  }

  function openWorktrees() {
    setWorktreeNote('');
    setWorktreeBase('main');
    setWorktreeInput('');
    setWorktreeOpen(true);
  }
  async function copyWorktree(project: Project) {
    const dirs = parseWorktreeInput(worktreeInput, baseName(project.path));
    if (!dirs.length) { setWorktreeNote('请至少填写一个方向分支。'); return; }
    try {
      await navigator.clipboard.writeText(worktrees(project, worktreeBase.trim() || 'main', dirs));
      setWorktreeNote('工作区词已复制，交给项目 Agent 执行。');
    } catch {
      setWorktreeNote('无法自动复制，请选中下方预览手动复制。');
    }
  }

  function openForm(project?: Project) {
    setForm(project ?? 'add'); setFormPath(project?.path ?? ''); setFormName(project?.name ?? ''); setFormError(''); setInstallSkill(true);
  }
  async function register(event: React.FormEvent) {
    event.preventDefault(); if (!data || busy) return;
    setBusy(true); setFormError('');
    try {
      const replacing = form && form !== 'add' ? form : null;
      accept(await api('POST', replacing ? `/${replacing.id}/repoint` : '', { path: formPath, name: formName, registryHash: data.registryHash, installSkill }));
      setForm(null); if (replacing) location.hash = '';
      setNotice({ message: replacing ? '路径已更新' : '项目已添加' });
    } catch (error) { setFormError((error as Error).message); }
    finally { setBusy(false); }
  }
  function startEdit(project: Project, kind: 'next' | 'summary' = 'next') {
    if (project.state !== 'ok' || busy) return;
    setEditing({ id: project.id, kind, value: project[kind], hash: project.hash, baseline: project[kind] }); setNotice(null);
  }
  async function saveNext(event: React.FormEvent) {
    event.preventDefault(); if (!editing || busy || editing.conflict) return;
    setBusy(true);
    try {
      accept(await api('PATCH', `/${editing.id}`, { [editing.kind]: editing.value, hash: editing.hash }));
      setEditing(null); setNotice({ message: '已保存' });
    } catch (error) {
      setNotice({ message: (error as Error).message, error: true });
      if (error instanceof RequestError && error.status === 409) setEditing({ ...editing, conflict: true });
    } finally { setBusy(false); }
  }
  async function reviewConflict() {
    const snapshot = await refresh();
    const project = snapshot?.projects.find(project => project.id === editing?.id);
    if (project?.state === 'ok' && editing) setEditing({ ...editing, hash: project.hash, baseline: project[editing.kind], conflict: false, reviewed: true });
  }
  async function completeTask(project: Project, task: Task) {
    if (busy || editing) return;
    setBusy(true);
    try {
      accept(await api('PATCH', `/${project.id}/tasks`, { line: task.line, action: 'complete', hash: project.hash }));
      setNotice({ message: '任务已完成，已移入已完成分组' });
    } catch (error) {
      setNotice({ message: (error as Error).message, error: true });
      if (error instanceof RequestError && error.status === 409) void refresh();
    } finally { setBusy(false); }
  }
  async function removeTask() {
    if (!taskDelete || busy) return;
    const { project, task } = taskDelete;
    setBusy(true);
    try {
      accept(await api('PATCH', `/${project.id}/tasks`, { line: task.line, action: 'delete', hash: project.hash }));
      setTaskDelete(null);
      setNotice({ message: '任务已删除' });
    } catch (error) {
      setTaskDelete(null);
      setNotice({ message: (error as Error).message, error: true });
      if (error instanceof RequestError && error.status === 409) void refresh();
    } finally { setBusy(false); }
  }
  async function remove(project: Project) {
    if (!data || busy) return;
    setBusy(true);
    try { accept(await api('DELETE', `/${project.id}`, { registryHash: data.registryHash })); setRemoveTarget(null); location.hash = ''; setNotice({ message: '项目已移出看板' }); }
    catch (error) { setRemoveTarget(null); setNotice({ message: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }

  function nextEditor(project: Project, showFocus = true, showEditHint = true, textEditable = true) {
    const focus = focusTask(project.tasks);
    const next = formatNext(project.next);
    if (editing?.id === project.id && editing.kind === 'next') return <form className={styles.editForm} onSubmit={saveNext}>
      <input ref={editInput} aria-label={`${project.name}的下一步`} value={editing.value} maxLength={4000} disabled={busy} placeholder="下一步做什么" onChange={event => setEditing({ ...editing, value: event.target.value })} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); setEditing(null); } if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
      <button className={styles.smallButton} disabled={busy || editing.conflict}>保存</button>
      <button type="button" className={styles.textButton} disabled={busy} onClick={() => setEditing(null)}>取消</button>
      {focus && editing.value !== focus.title && <button type="button" className={styles.textButton} title={`填入任务：${focus.title}`} onClick={() => setEditing({ ...editing, value: focus.title })}>填入任务</button>}
      {editing.conflict && <button type="button" className={styles.conflict} onClick={() => void reviewConflict()}>文件已变更，点击核对最新内容</button>}
      {editing.reviewed && <div className={styles.comparison}>最新内容：{editing.baseline || '（空）'}。已保留你的输入，确认后可直接保存。</div>}
    </form>;
    if (!textEditable) return <div className={styles.nextCellContent}>
      <div className={`${styles.nextButton} ${styles.nextStatic} ${!project.next ? styles.missing : ''}`} title={next.plain || undefined}>
        <span className={styles.nextText}>{next.text || '尚未填写下一步'}</span>
      </div>
      {showFocus && focus && (
        <span className={styles.focusTaskChip} title={`当前任务：${focus.title}${focus.tags.length ? ' ' + focus.tags.join(' ') : ''}`}>
          <span className={styles.focusTaskIcon}>↳</span>
          <span className={styles.focusTaskTitle}>{focus.title}</span>
          {focus.tags.map(tag => <small key={tag} className={styles.tag}>{tag}</small>)}
        </span>
      )}
    </div>;
    return <div className={styles.nextCellContent}>
      <button className={`${styles.nextButton} ${!project.next ? styles.missing : ''}`} title={next.plain || '点击填写下一步'} onClick={() => startEdit(project)} disabled={project.state !== 'ok' || editing?.kind === 'summary'}>
        <span className={styles.nextText}>{next.text || '+ 填写下一步'}</span>
        {showEditHint && <span className={styles.editHint} aria-hidden="true"><Icon name="edit" size={14} /><span>编辑</span></span>}
      </button>
      {showFocus && focus && (
        <span className={styles.focusTaskChip} title={`当前任务：${focus.title}${focus.tags.length ? ' ' + focus.tags.join(' ') : ''}`}>
          <span className={styles.focusTaskIcon}>↳</span>
          <span className={styles.focusTaskTitle}>{focus.title}</span>
          {focus.tags.map(tag => <small key={tag} className={styles.tag}>{tag}</small>)}
        </span>
      )}
    </div>;
  }

  function taskOpen(project: Project) { return project.tasks.filter(task => task.state !== '已完成').length; }
  function taskDone(project: Project) { return project.tasks.filter(task => task.state === '已完成').length; }
  function statusText(project: Project) {
    if (project.state === 'offline') return '离线';
    if (project.state === 'error') return '读取失败';
    return project.status;
  }
  function stampDate(project: Project) { return /^\d{4}-\d{2}-\d{2}$/.test(project.updated) ? project.updated.slice(5) : '—'; }
  function toggleSection(key: DetailSection) { setOpenSections(previous => ({ ...previous, [key]: !previous[key] })); }
  function openProject(project: Project, event: React.MouseEvent) {
    if ((event.target as HTMLElement).closest('a, button, input, textarea, select, summary, label')) return;
    location.hash = 'project/' + project.id;
  }

  function subRow(project: Project) {
    const offline = project.state !== 'ok';
    const next = formatNext(project.next);
    const meta = offline ? '离线' : (project.status === '暂停' ? '暂停 / ' : project.status === '已完成' ? '已完成 / ' : '') + freshness(project);
    return <div
      id={'project-' + project.id}
      key={project.id}
      className={styles.subRow}
      onMouseDown={() => setSelected(project.id)}
      onFocusCapture={() => setSelected(project.id)}
      onClick={event => { event.stopPropagation(); openProject(project, event); }}
    >
      <span className={`${styles.subDot} ${project.status === '暂停' ? styles.subPaused : ''} ${offline ? styles.subOffline : ''}`.trim()} />
      <a className={styles.subName} href={'#project/' + project.id}>{project.name}<span className={styles.subOpen} aria-hidden="true"><Icon name="chevron" size={14} /></span></a>
      <span className={styles.subNext} title={offline ? undefined : next.plain || undefined}>{offline ? (project.error || '目录不可读') : (next.text || '尚未填写下一步')}</span>
      <span className={`${styles.subMeta} ${stale(project) ? styles.stale : ''}`.trim()}>{meta}</span>
      {offline || project.status === '已完成'
        ? <span className={styles.subMuted}>{offline ? '离线' : '已完成'}</span>
        : <button className={styles.miniButton} disabled={busy || Boolean(editing)} onClick={() => void openTransfer(project, 'start')} aria-label={project.name + '的交接'}>交接</button>}
    </div>;
  }

  function slipCard(group: BoardGroup) {
    const main = group.members.find(project => project.role === 'main') ?? group.members[0];
    const extras = group.members.filter(project => project.id !== main.id);
    const title = group.multi ? groupLabel(projects, group.key) : main.name;
    const offline = main.state !== 'ok';
    const finished = main.status === '已完成';
    const open = group.members.reduce((count, project) => count + taskOpen(project), 0);
    const count = offline ? '记录不可读' : group.multi
      ? `${group.members.length === group.total ? group.total + ' 个工作区' : '显示 ' + group.members.length + ' / ' + group.total + ' 个工作区'} / ${open} 项未完成`
      : `${open} 项未完成 / ${taskDone(main)} 项已完成`;
    const classes = [
      styles.slip,
      group.multi ? styles.slipGroup : '',
      offline ? styles.slipOffline : '',
      main.status === '暂停' ? styles.slipPaused : '',
      finished ? styles.slipDone : '',
      selected === main.id ? styles.slipSelected : '',
    ].filter(Boolean).join(' ');
    return <article
      id={'project-' + main.id}
      key={group.key}
      role="listitem"
      aria-labelledby={'slip-title-' + main.id}
      className={classes}
      onMouseDown={() => setSelected(main.id)}
      onFocusCapture={() => setSelected(main.id)}
      onClick={event => openProject(main, event)}
    >
      <div className={styles.stamp}><span>{statusText(main)}</span><small>{offline ? '—' : stampDate(main)}</small></div>
      <div className={styles.slipBody}>
        <div className={styles.slipTitle}>
          <h2 id={'slip-title-' + main.id}><a href={'#project/' + main.id}><span className={styles.slipTitleText}>{title}</span><span className={styles.openMark} aria-hidden="true"><Icon name="arrow" size={16} /></span></a></h2>
          <span className={styles.slipCount}>{count}</span>
        </div>
        <p className={styles.slipPath} title={main.path}>{main.path}</p>
        {offline
          ? <div className={styles.slipError}><p>{main.error}</p><div className={styles.slipErrorActions}><button className={styles.quietButton} onClick={() => openForm(main)}>重新指向</button><button className={`${styles.quietButton} ${styles.quietDanger}`} disabled={busy} onClick={() => setRemoveTarget(main)}>移出看板</button></div></div>
          : <div className={styles.slipNext}>{nextEditor(main, !group.multi)}</div>}
        {group.multi && extras.length > 0 && <div className={styles.subList}>{extras.map(subRow)}</div>}
      </div>
      <div className={styles.slipSide}>
        <span className={`${styles.slipUpdate} ${stale(main) ? styles.stale : ''}`.trim()} title={main.updated ? main.updated + (main.estimated ? ' (文件时间估值)' : '') : undefined}>{offline ? '离线' : freshness(main)}</span>
        {offline || finished
          ? <span className={styles.doneLabel}>{offline ? '不可交接' : '已完成'}</span>
          : <button className={styles.handoffButton} disabled={busy || Boolean(editing)} onClick={() => void openTransfer(main, 'start')} aria-label={title + '的交接'}><Icon name="copy" />交接</button>}
      </div>
    </article>;
  }

  const gitEntries = git.id === currentId && git.history?.available ? git.history.entries : [];
  const gitVisible = git.all ? gitEntries : gitEntries.slice(0, GIT_VISIBLE);
  const now = new Date();
  const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]}`;
  return <div className={styles.app} data-text-size={textSize}>
    <header className={`${styles.siteHeader} ${currentId ? styles.siteHeaderCompact : ''}`}>
      <a className={styles.brand} href="#" aria-label="案屿项目总览" title="返回项目总览">
        <span className={styles.brandMark}><Icon name="island" /></span>
        <span className={styles.brandName}>案屿<small>ISLE</small></span>
      </a>
      <div className={styles.headerTitle}>
        {currentId ? <nav className={styles.crumb} aria-label="面包屑">
          <a className={`${styles.quietButton} ${styles.crumbBack}`} href="#" title="返回项目交接单"><span className={styles.crumbArrow} aria-hidden="true">←</span>项目交接单</a>
          <span className={styles.crumbSep} aria-hidden="true">/</span>
          <span className={styles.crumbCurrent} aria-current="page">{current?.name || '项目'}</span>
        </nav> : <>
          <h1>项目交接单</h1>
          <p className={styles.headerMeta}><span>{date}</span><span>{activeGroupCount} 个项目</span><span>{activeProjects.length} 个工作区</span><span>{oldCount} 个待检查</span></p>
        </>}
      </div>
      <div className={styles.headerActions}>
        {currentId && <a className={styles.textLink} href="#">← 返回总览</a>}
        <button className={`${styles.quietButton} ${styles.textSizeButton}`} aria-label="显示设置" aria-haspopup="dialog" aria-expanded={settingsOpen} title="显示设置" onClick={() => setSettingsOpen(true)}>Aa</button>
        <button className={styles.quietButton} disabled={busy || Boolean(editing)} onClick={() => void openAgents()}><Icon name="people" size={15} />Agent 名单</button>
        {!currentId && <button className={styles.primaryButton} onClick={() => openForm()}><Icon name="plus" />添加项目</button>}
      </div>
    </header>
    <main className={`${styles.main} ${currentId ? styles.projectPage : ''}`}>
      {notice && <div className={`${styles.notice} ${notice.error ? styles.noticeError : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.message}</span><button aria-label="关闭提示" className={styles.iconButton} onClick={() => setNotice(null)}><Icon name="close" /></button></div>}
      {currentId ? <>
        {current ? <>
          <section className={styles.projectHead} aria-labelledby="project-title">
            <div className={styles.projectHeadMain}>
              <div className={styles.projectKicker}>
                <span className={`${styles.statusChip} ${current.state !== 'ok' ? styles.statusOffline : current.status === '暂停' ? styles.statusPaused : current.status === '已完成' ? styles.statusDone : ''}`.trim()}>{statusText(current)}</span>
                {current.state === 'ok' && <span className={styles.projectFresh}>{freshness(current)}</span>}
                {stale(current) && <span className={styles.projectFlag}>待检查</span>}
                {currentGroup && (currentGroup.count > 1 || currentGroup.role === 'worktree') && <span className={styles.projectGroupNote}>{currentGroup.role === 'main' ? '主工作区 / 共 ' + currentGroup.count + ' 条线' : currentGroup.label + ' / 工作区'}</span>}
              </div>
              <h1 id="project-title" className={styles.projectTitle}>{current.name}</h1>
              <p className={styles.projectPath} title={current.path}>{current.path}</p>
            </div>
            <div className={styles.projectActions}>
              <button className={styles.primary} disabled={current.state !== 'ok' || busy || Boolean(editing)} onClick={() => void openTransfer(current, 'start')}><Icon name="copy" size={16} />交给新 Agent</button>
              <button className={styles.secondary} disabled={current.state !== 'ok' || busy || Boolean(editing)} onClick={() => void openTransfer(current, 'close')}>收工回写</button>
            </div>
          </section>
          <div className={styles.projectUtilities} role="group" aria-label="项目设置与工作区">
            <button className={`${styles.quietButton} ${styles.utilityButton}`} disabled={busy || Boolean(editing) || current.state !== 'ok'} title="在系统文件管理器中打开这个目录；之后可在其中用编辑器打开" onClick={() => void openFolder(current)}><Icon name="folder" size={14} />打开目录</button>
            <button className={`${styles.quietButton} ${styles.utilityButton}`} disabled={busy || Boolean(editing) || current.state !== 'ok'} onClick={() => void openWorkspacePicker(current)}><Icon name="plus" size={14} />添加已有工作区</button>
            <button className={`${styles.quietButton} ${styles.utilityButton}`} disabled={loading || busy} onClick={() => void refresh()}><Icon name="refresh" size={14} />刷新记录</button>
            <span className={styles.utilitySpacer} />
            <button className={`${styles.quietButton} ${styles.utilityButton}`} onClick={() => openForm(current)} disabled={busy || Boolean(editing)}><Icon name="edit" size={14} />修改路径</button>
            <button className={`${styles.quietButton} ${styles.utilityButton}`} disabled={busy || Boolean(editing)} onClick={() => openWorktrees()}><Icon name="branch" size={14} />建工作区</button>
            <button className={`${styles.quietButton} ${styles.utilityButton} ${styles.quietDanger}`} disabled={busy || Boolean(editing)} onClick={() => setRemoveTarget(current)}><Icon name="trash" size={14} />移出看板</button>
          </div>
          <section className={styles.contextCard} aria-label="项目下一步">
            <div className={styles.contextHead}>
              <p className={styles.fieldLabel}>下一步
                {(currentNext.overlong || currentNext.markdown) && <span className={styles.nextWarning} title="建议一句话、50 字内，纯文本；细节写进交接摘要">建议精简</span>}
              </p>
              <div className={styles.contextHeadActions}>
                <span className={styles.contextHint}>交接时随记录交给下一位 Agent</span>
                {!(editing?.id === current.id && editing.kind === 'next') && <button className={styles.quietButton} disabled={current.state !== 'ok' || busy || Boolean(editing)} onClick={() => startEdit(current)}><Icon name="edit" size={14} />编辑</button>}
              </div>
            </div>
            {nextEditor(current, false, false, false)}
            {(() => {
              const focus = focusTask(current.tasks);
              return focus ? <div className={styles.detailFocusTask}>
                <span className={styles.focusBadge}>当前任务</span>
                <span>{focus.title}</span>
                {focus.tags.map(tag => <small key={tag} className={styles.tag}>{tag}</small>)}
              </div> : null;
            })()}
          </section>
          {current.error && <div className={styles.errorCard}><strong>{current.state === 'offline' ? '离线' : '读取失败'}</strong><p>{current.error}</p><button className={styles.secondary} onClick={() => openForm(current)}>重新指向</button>{current.preview && <pre>{current.preview}</pre>}</div>}
          {current.warnings.length > 0 && <details className={styles.warnings}><summary>{current.warnings.length} 条提示</summary><ul>{current.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
          {current.state === 'ok' && <section className={styles.tasksPanel} aria-label="任务清单">
            <div className={styles.sectionHeading}><h2>任务清单</h2><span>{current.tasks.filter(task => task.state !== '已完成').length} 项未完成 · {current.tasks.filter(task => task.state === '已完成').length} 项已完成</span></div>
            <div className={styles.taskGroups}>{(['进行中', '待办', '已完成'] as TaskState[]).filter(state => current.tasks.some(task => task.state === state)).map(state => {
            const focus = focusTask(current.tasks);
            const Group = state === '已完成' ? 'details' : 'section';
            const groupTitle = <h3><span className={`${styles.stateDot} ${state === '进行中' ? styles.green : ''}`} />{state}<small>{current.tasks.filter(task => task.state === state).length}</small></h3>;
            return <Group className={`${styles.taskGroup} ${state === '进行中' ? styles.activeGroup : ''} ${state === '已完成' ? styles.completedGroup : ''}`} aria-label={state} key={state}>
              {state === '已完成' ? <summary>{groupTitle}</summary> : groupTitle}
              <ul className={styles.taskList}>{current.tasks.filter(task => task.state === state).map(task => {
                const isFocus = focus && task.line === focus.line && task.state !== '已完成';
                return <li key={task.line} className={`${styles.task} ${state === '已完成' ? styles.doneTask : ''}`}>
                  <span className={styles.taskMark} data-done={state === '已完成' ? 'true' : 'false'} aria-hidden="true" />
                  <div className={styles.taskCopy}><span className={styles.taskTitle}>{task.title}</span>
                    {(isFocus || task.tags.length > 0 || task.conflict) && <div className={styles.taskMeta}>
                      {isFocus && <span className={styles.focusBadge}>当前聚焦</span>}
                      {task.tags.map(tag => <small className={styles.tag} key={tag}>{tag}</small>)}
                      {task.conflict && <span title="复选框与分节不一致" className={styles.taskWarning}>状态需核对</span>}
                    </div>}
                  </div>
                  {task.state !== '已完成' && !task.conflict && <div className={styles.taskActions}>
                    <button className={`${styles.quietButton} ${styles.taskAction}`} aria-label={`完成任务：${task.title}`} title="完成，移入已完成" disabled={busy || Boolean(editing)} onClick={() => void completeTask(current, task)}><Icon name="check" size={15} /></button>
                    <button className={`${styles.quietButton} ${styles.taskAction} ${styles.taskDelete}`} aria-label={`删除任务：${task.title}`} title="删除任务" disabled={busy || Boolean(editing)} onClick={() => setTaskDelete({ project: current, task })}><Icon name="trash" size={15} /></button>
                  </div>}
                </li>;
              })}</ul>
            </Group>;
          })}</div>{!current.tasks.length && <p className={styles.noTasks}>暂无任务</p>}</section>}
          {current.state === 'ok' && <section className={`${styles.summaryCard} ${!openSections.summary ? styles.collapsedSection : ''}`} aria-label="交接摘要">
            <div className={styles.summaryHeading}>
              <h2>交接摘要</h2>
              <div className={styles.sectionHeadingActions}>
                {openSections.summary && <div className={styles.transferActions}><button className={styles.quietButton} disabled={busy || Boolean(editing) || !current.summary?.trim()} onClick={() => void copySummary(current)}><Icon name="copy" size={14} />复制摘要</button><button className={styles.quietButton} disabled={busy || Boolean(editing)} onClick={() => startEdit(current, 'summary')}><Icon name="edit" size={14} />手动补记</button></div>}
                <button className={`${styles.quietButton} ${styles.sectionToggle}`} aria-expanded={openSections.summary} aria-controls="summary-content" aria-label={openSections.summary ? '收起交接摘要' : '展开交接摘要'} title={openSections.summary ? '收起交接摘要' : '展开交接摘要'} disabled={editing?.id === current.id && editing.kind === 'summary'} onClick={() => toggleSection('summary')}><Icon name="chevron" size={16} /></button>
              </div>
            </div>
            {openSections.summary && <div id="summary-content" className={styles.sectionBody}>
              {editing?.id === current.id && editing.kind === 'summary' ? <form onSubmit={saveNext}>
                <label className={styles.srOnly} htmlFor="summary-input">编辑交接摘要</label>
                <textarea id="summary-input" ref={summaryInput} className={styles.summaryInput} value={editing.value} maxLength={10000} disabled={busy} placeholder={'已确认：\n验证结果：\n未完成或阻塞：\n接着做：'} onChange={event => setEditing({ ...editing, value: event.target.value })} onKeyDown={event => { if (event.key === 'Escape' && !busy) setEditing(null); }} />
                {editing.conflict && <button type="button" className={styles.conflict} onClick={() => void reviewConflict()}>文件已变更，保留输入并核对最新内容</button>}
                {editing.reviewed && <div className={styles.comparison}>文件中的最新摘要：<pre>{editing.baseline || '（空）'}</pre>上方保留了你的输入，确认后可保存。</div>}
                <div className={styles.dialogActions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setEditing(null)}>取消</button><button className={styles.primary} disabled={busy || editing.conflict}>保存摘要</button></div>
              </form> : current.summary ? <div className={styles.markdown}><SummaryMarkdown text={current.summary} /></div> : <p className={styles.summaryEmpty}>收工时，把收工词发给当前 Agent，回写后刷新。也可以在这里手动补记。</p>}
            </div>}
          </section>}
          {current.state === 'ok' && <section className={`${styles.summaryCard} ${styles.historyCard} ${!openSections.history ? styles.collapsedSection : ''}`} aria-label="工作留痕">
            <div className={styles.summaryHeading}>
              <h2>工作留痕</h2>
              <div className={styles.sectionHeadingActions}>
                <span className={`${styles.historyHint} ${historyView?.outOfOrder ? styles.historyAdjusted : ''}`.trim()} title={historyHintTitle}>{historyHint}</span>
                <button className={`${styles.quietButton} ${styles.sectionToggle}`} aria-expanded={openSections.history} aria-controls="history-content" aria-label={openSections.history ? '收起工作留痕' : '展开工作留痕'} title={openSections.history ? '收起工作留痕' : '展开工作留痕'} onClick={() => toggleSection('history')}><Icon name="chevron" size={16} /></button>
              </div>
            </div>
            {openSections.history && <div id="history-content" className={styles.sectionBody}>
              {current.history ? <div className={styles.markdown}><SummaryMarkdown text={historyView?.text ?? current.history} /></div> : <p className={styles.summaryEmpty}>暂无留痕。收工时选择署名，让 Agent 追加本次推进和验证结果；未完成的工作也可以记录。</p>}
            </div>}
          </section>}
          {current.state === 'ok' && git.id === current.id && <section className={`${styles.gitCard} ${!openSections.git ? styles.collapsedSection : ''}`} aria-label="Git 历史">
            <div className={styles.summaryHeading}>
              <h2>Git 历史</h2>
              <div className={styles.sectionHeadingActions}>
                {openSections.git && <div className={styles.transferActions}><button className={styles.quietButton} disabled={busy || git.loading} onClick={() => void loadGit(current)}><Icon name="refresh" size={14} />刷新</button><button className={styles.quietButton} disabled={busy} onClick={() => void copyGit(current)}><Icon name="copy" size={14} />复制提交/推送命令</button></div>}
                <button className={`${styles.quietButton} ${styles.sectionToggle}`} aria-expanded={openSections.git} aria-controls="git-content" aria-label={openSections.git ? '收起 Git 历史' : '展开 Git 历史'} title={openSections.git ? '收起 Git 历史' : '展开 Git 历史'} onClick={() => toggleSection('git')}><Icon name="chevron" size={16} /></button>
              </div>
            </div>
            {openSections.git && <div id="git-content" className={styles.sectionBody}>
              {git.loading && <p className={styles.summaryEmpty}>正在读取 git 历史…</p>}
              {!git.loading && git.error && <p className={styles.summaryEmpty}>{git.error}</p>}
              {!git.loading && git.history && !git.history.available && <p className={styles.summaryEmpty}>{git.history.reason || '无法读取 git 历史。'}</p>}
              {!git.loading && git.history && git.history.available && (gitEntries.length
                ? <ul className={styles.gitList}>{gitVisible.map((entry, index) => <li key={index}><code className={styles.gitHash}>{entry.hash}</code><time className={styles.gitDate}>{entry.date}</time><span className={styles.gitMessage}>{entry.message}</span></li>)}</ul>
                : <p className={styles.summaryEmpty}>{git.history.reason || '暂无提交。'}</p>)}
              {!git.loading && gitEntries.length > GIT_VISIBLE && <div className={styles.gitMore}><button className={styles.quietButton} onClick={() => setGit(previous => ({ ...previous, all: !previous.all }))}>{git.all ? `只看最近 ${GIT_VISIBLE} 条` : `显示全部（共 ${gitEntries.length} 条）`}</button></div>}
              <p className={styles.gitHint}>只读预览最近的非合并提交，合并提交已省略；提交与推送由你在终端执行，案屿不主动操作 git、不出网。</p>
            </div>}
          </section>}
          {current.state === 'ok' && <section className={styles.summaryCard} aria-label="项目 Skill">
            <div className={styles.summaryHeading}><h2>项目 Skill</h2><button className={styles.quietButton} disabled={busy || skill.loading} onClick={() => void (skill.status?.state === 'ready' ? loadSkill(current) : installProjectSkill(current))}><Icon name="refresh" size={14} />{skill.status?.state === 'ready' ? '重新检查' : skill.status?.state === 'outdated' ? '升级' : skill.status?.state === 'missing' ? '安装' : skill.status?.state === 'partial' ? '补齐' : '安装 / 补齐'}</button></div>
            <p className={styles.skillDescription}>{skill.loading ? '正在检查项目 Skill…' : skill.error || (skill.status ? skillLabels[skill.status.state] : '尚未检查')}{skill.status?.state === 'ready' ? '。' : '；就绪后'}可以对 Agent 说：“使用 isle（案屿）Skill 收工回写，署名 Codex”。</p>
            <p className={styles.skillDescription}>提供 Codex、OpenCode、Claude Code 和 TRAE 的项目入口。补充缺失文件，并把官方旧版升级到当前版本；官方旧版以外的同名文件（含你改过的）保留不覆盖。</p>
            {skill.id === current.id && skill.status && <details className={styles.skillFiles}><summary>查看安装文件</summary><ul>{skill.status.files.map(file => <li key={file.path}><code>{file.path}</code><span>{({ ready: '就绪', missing: '缺失', outdated: '官方旧版，可升级', custom: '已有不同内容，未覆盖', error: '无法访问' })[file.state]}{file.message ? `：${file.message}` : ''}</span></li>)}</ul></details>}
          </section>}
          <footer className={styles.projectFooter}><span>任务、摘要与留痕保存在 TASKS.md 中</span><span>案屿只读取记录、生成文字，不执行项目命令</span></footer>
        </> : <p className={styles.emptyText}>{loading ? '正在读取项目…' : '该项目不存在或已被移除。'}</p>}
      </> : <>
        <div className={styles.toolbar}>
          <nav className={styles.tabs} aria-label="筛选项目">
            {([['all', '全部'], ['active', '进行中'], ['paused', '暂停'], ['offline', '离线']] as const).map(([key, label]) => (
              <button key={key} className={styles.tab} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{filterCounts[key]}</span></button>
            ))}
          </nav>
          <div className={styles.toolbarRight}>
            <div className={styles.viewToggle} role="group" aria-label="项目展示方式">
              <button className={styles.viewButton} aria-pressed={view === 'list'} aria-label="列表显示" title="列表显示" onClick={() => { setView('list'); setMoreOpen(false); }}><Icon name="list" size={16} /></button>
              <button className={styles.viewButton} aria-pressed={view === 'cards'} aria-label="卡片显示" title="卡片显示" onClick={() => { setView('cards'); setMoreOpen(false); }}><Icon name="grid" size={16} /></button>
            </div>
            <div className={styles.moreWrap}>
              <button
                ref={moreButtonRef}
                className={`${styles.iconButton} ${styles.iconButtonBordered} ${onlyStale ? styles.moreActive : ''}`.trim()}
                aria-label={onlyStale ? '更多筛选，已启用只看久未更新' : '更多筛选'}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                aria-controls="project-filter-menu"
                title="更多筛选"
                onClick={() => setMoreOpen(open => !open)}
              >
                <Icon name="more" strokeWidth={2.4} />
                {onlyStale && <span className={styles.moreDot} aria-hidden="true" />}
              </button>
              {moreOpen && <div
                ref={moreMenuRef}
                id="project-filter-menu"
                className={styles.moreMenu}
                role="menu"
                aria-label="更多筛选"
                onBlur={event => { const next = event.relatedTarget as Node | null; if (!next || (!moreMenuRef.current?.contains(next) && !moreButtonRef.current?.contains(next))) setMoreOpen(false); }}
              >
                <button
                  ref={moreItemRef}
                  className={styles.moreItem}
                  role="menuitemcheckbox"
                  aria-checked={onlyStale}
                  onClick={() => { setOnlyStale(value => !value); setMoreOpen(false); moreButtonRef.current?.focus(); }}
                >
                  <span className={styles.moreCheck} aria-hidden="true">{onlyStale && <Icon name="check" size={15} />}</span>
                  <span>只看久未更新</span>
                </button>
              </div>}
            </div>
            <button className={`${styles.iconButton} ${styles.iconButtonBordered}`} aria-label="刷新项目" title="刷新" disabled={loading} onClick={() => void refresh()}><Icon name="refresh" /></button>
          </div>
        </div>
        {data?.warnings.length ? <details className={styles.warnings} open><summary>清单有 {data.warnings.length} 条提示</summary><ul>{data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details> : null}
        {loading && !data ? <p className={styles.emptyText}>正在读取项目…</p> : !projects.length ? <section className={styles.empty}>
          <div className={styles.emptyIsland}><Icon name="island" /></div><h2>暂无项目</h2><p>添加本地项目目录，案屿将读取其中的 TASKS.md。<br />若文件不存在，会自动创建模板。</p><button className={styles.primary} onClick={() => openForm()}><Icon name="plus" />添加项目</button>
        </section> : <>
          {boardGroups.length > 0 && <div key={view} className={`${styles.slipList} ${view === 'cards' ? styles.cardList : ''}`.trim()} role="list" aria-label="项目总览" data-render-ms={renderMs?.toFixed(1)}>{boardGroups.map(slipCard)}</div>}
          {!visible.length && <p className={styles.emptyText}>没有符合条件的项目。</p>}
          {done.length > 0 && <button className={styles.doneToggle} onClick={() => setShowDone(!showDone)}>{showDone ? '▾' : '▸'} {done.length} 个已完成工作区{showDone ? ' / 收起' : ' / 展开'}</button>}
          <footer className={styles.listFooter}><span>记录保存在各项目的 TASKS.md</span><div><kbd>j</kbd><kbd>k</kbd> 移动 <kbd>↵</kbd> 查看 <kbd>c</kbd> 复制开工词</div></footer>
        </>}
      </>}
    </main>
    {settingsOpen && <Modal title="显示设置" close={() => setSettingsOpen(false)}><div className={styles.settingsBody}>
      <p className={styles.settingsHint}>字号只影响本机显示，不会修改 TASKS.md 或项目记录。选择会保存在此浏览器。</p>
      <div className={styles.sizeOptions} role="group" aria-label="字号">
        {textSizeOptions.map(option => <button
          key={option.value}
          className={`${styles.sizeOption} ${textSize === option.value ? styles.sizeOptionActive : ''}`.trim()}
          aria-pressed={textSize === option.value}
          data-size={option.value}
          onClick={() => setTextSize(option.value)}
        >
          <span className={styles.sizeOptionSample} style={{ fontSize: option.px }}>Aa</span>
          <span className={styles.sizeOptionLabel}>{option.label}</span>
          <span className={styles.sizeOptionPx}>{option.px}</span>
        </button>)}
      </div>
      <div className={styles.sizePreview} aria-hidden="true"><span>项目交接单</span><p>停在 v0.20 能力集；下一步按用户安排做真实交接或性能复测。</p></div>
      <div className={styles.dialogActions}><button className={styles.primary} onClick={() => setSettingsOpen(false)}>完成</button></div>
    </div></Modal>}
    {agentDraft && <Modal title="Agent 名单" close={() => { if (!busy) setAgentDraft(null); }}><form className={styles.projectForm} onSubmit={saveAgents}>
      <p>每行一个名称，可写工具名或你确认的模型名。名单用于交接时选择署名；改名或移除不会修改过去的留痕。</p>
      <label>Agent 名称<textarea autoFocus className={styles.agentInput} value={agentDraft.value} maxLength={4000} disabled={busy || agentDraft.hash === null} onChange={event => setAgentDraft({ ...agentDraft, value: event.target.value })} placeholder={'Codex\nOpenCode\nTrae'} /></label>
      {agentError && <p className={styles.formError} role="alert">{agentError}</p>}
      <div className={styles.dialogActions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setAgentDraft(null)}>取消</button><button className={styles.primary} disabled={busy || agentDraft.hash === null}>{busy ? '保存中…' : '保存名单'}</button></div>
    </form></Modal>}
    {form && <Modal title={form === 'add' ? '添加项目' : '重新指向'} close={() => { if (!busy) setForm(null); }}><form onSubmit={register} className={styles.projectForm}><label>项目目录<input autoFocus required value={formPath} onChange={event => setFormPath(event.target.value)} placeholder={'D:\\work\\my-project'} disabled={busy} autoComplete="off" /></label><label>项目名称 <span>可选，留空使用目录名</span><input value={formName} maxLength={120} onChange={event => setFormName(event.target.value)} placeholder="例如：棱镜" disabled={busy} /></label>
      <label className={styles.skillInstallLabel}><input type="checkbox" checked={installSkill} disabled={busy} onChange={event => setInstallSkill(event.target.checked)} /><span>安装项目级案屿 Skill<small>生成 .agents、.claude、.trae 的项目入口；官方旧版会升级，改过的同名文件不覆盖。</small></span></label>
      {formError && <p className={styles.formError} role="alert">{formError}</p>}<div className={styles.dialogActions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setForm(null)}>取消</button><button className={styles.primary} disabled={busy}>{busy ? '正在保存…' : form === 'add' ? '添加项目' : '保存'}</button></div></form></Modal>}
    {removeTarget && <Modal title="移出看板" close={() => { if (!busy) setRemoveTarget(null); }}><div className={styles.projectForm}>
      <p>将「{removeTarget.name}」移出看板？项目目录和 TASKS.md 不会被删除，之后仍可重新添加。</p>
      <div className={styles.dialogActions}><button className={styles.secondary} disabled={busy} onClick={() => setRemoveTarget(null)}>取消</button><button className={`${styles.primary} ${styles.dangerButton}`} disabled={busy} onClick={() => void remove(removeTarget)}>{busy ? '正在移出…' : '移出看板'}</button></div>
    </div></Modal>}
    {taskDelete && <Modal title="删除任务" close={() => { if (!busy) setTaskDelete(null); }}><div className={styles.projectForm}>
      <p>从「{taskDelete.project.name}」的 TASKS.md 删除这条任务？只删任务行，交接摘要和工作留痕不会改动。</p>
      <p className={styles.taskDeleteTitle}>{taskDelete.task.title}</p>
      <div className={styles.dialogActions}><button className={styles.secondary} disabled={busy} onClick={() => setTaskDelete(null)}>取消</button><button className={`${styles.primary} ${styles.dangerButton}`} disabled={busy} onClick={() => void removeTask()}>{busy ? '正在删除…' : '删除任务'}</button></div>
    </div></Modal>}
    {handoffProject && <Modal title={handoffMode === 'close' ? '收工回写' : '交给新 Agent'} close={() => setHandoffProject(null)}><div className={styles.projectForm}>
      <div className={styles.transferTabs} role="group" aria-label="交接阶段"><button disabled={busy} aria-pressed={handoffMode === 'close'} onClick={() => { setHandoffMode('close'); setTransferNote(''); }}>1 · 收工词</button><span>→</span><button disabled={busy} aria-pressed={handoffMode === 'start'} onClick={() => { setHandoffMode('start'); setTransferNote(''); }}>2 · 开工词</button></div>
      <p>{handoffMode === 'close' ? '发给正在工作的 Agent，让它整理实际结果并回写。回写后刷新，再把开工词交给下一家。' : '带上最新记录，交给下一位 Agent 接着做。打开和复制时都会重新读取任务文件。'}</p>
      <div className={styles.transferTabs} role="group" aria-label="指令格式"><button aria-pressed={transferFormat === 'skill'} disabled={busy || skill.id !== handoffProject.id || skill.status?.files[0]?.state !== 'ready'} onClick={() => { setTransferFormat('skill'); setTransferNote(''); }}>Skill 短指令</button><button aria-pressed={transferFormat === 'full'} disabled={busy} onClick={() => { setTransferFormat('full'); setTransferNote(''); }}>完整提示词</button></div>
      {transferFormat === 'full' && skill.status?.state !== 'ready' && <p className={styles.skillDescription}>项目 Skill 尚未全部就绪，当前使用完整提示词；可在项目页安装或检查。</p>}
      <label>{handoffMode === 'close' ? '本次署名' : '接手 Agent'}<select aria-describedby="author-hint" disabled={busy} value={authors[handoffMode]} onChange={event => { setAuthors({ ...authors, [handoffMode]: event.target.value }); setTransferNote(''); }}>
        <option value="">未指定，由 Agent 向我确认署名</option>
        {[...new Set([...(data?.agents ?? []), ...(authors[handoffMode] ? [authors[handoffMode]] : [])])].map(name => <option key={name} value={name}>{name}</option>)}
      </select></label><span id="author-hint" className={styles.authorHint}>收工时追加本次贡献并署名。自定义名称可在页头“Agent 名单”中维护。</span>
      {handoffMode === 'start' && <><label>本次目标 <span>可选</span><input disabled={busy} value={goal} maxLength={1000} onChange={event => setGoal(event.target.value)} placeholder="留空按下一步继续，也可以指定这次要做的事" /></label><label>完成标准 <span>可选</span><input disabled={busy} value={criteria} maxLength={800} onChange={event => setCriteria(event.target.value)} placeholder="例如：通过所有单元测试" /></label></>}
      <textarea className={`${styles.handoff} ${transferFormat === 'skill' ? styles.shortInstruction : ''}`} aria-label={handoffMode === 'close' ? '收工词预览' : '开工词预览'} readOnly value={transferText(handoffProject, handoffMode, transferFormat, authors[handoffMode], criteria, goal)} onFocus={event => event.target.select()} />
      {handoffMode === 'close' && <details className={styles.summaryPreview}><summary>当前交接摘要</summary><div className={styles.markdown}><SummaryMarkdown text={handoffProject.summary || '暂无摘要。'} /></div></details>}
      {transferNote && <p className={styles.transferNote} role="status">{transferNote}</p>}
      <div className={styles.dialogActions}>{handoffMode === 'close' && <button className={styles.secondary} disabled={busy} onClick={() => void refreshTransfer()}><Icon name="refresh" />已回写，刷新记录</button>}<button className={styles.primary} disabled={busy} onClick={() => void copy(handoffProject, handoffMode, criteria, goal, authors[handoffMode], transferFormat)}><Icon name="copy" />{busy ? '读取中…' : transferFormat === 'skill' ? '复制短指令' : handoffMode === 'close' ? '复制收工词' : '复制开工词'}</button></div>
    </div></Modal>}
    {summaryCopy !== null && <Modal title="复制交接摘要" close={() => setSummaryCopy(null)}><div className={styles.projectForm}><p>浏览器未允许自动复制，请选中下方原文后复制。</p><textarea autoFocus className={styles.handoff} aria-label="交接摘要原文" readOnly value={summaryCopy} onFocus={event => event.target.select()} /><div className={styles.dialogActions}><button className={styles.secondary} onClick={() => setSummaryCopy(null)}>关闭</button></div></div></Modal>}
    {workspacePicker && <Modal title="添加已有工作区" close={() => { if (!busy) setWorkspacePicker(null); }}><div className={styles.projectForm}>
      <p>只列出“{workspacePicker.project.name}”所属仓库的 Git 工作区。勾选后加入看板，各自保留 TASKS.md，并自动归入同一项目组。</p>
      <p className={styles.skillDescription}>已有任务不会自动改写。加入后分别整理该方向的下一步与任务；Git 工作区也不会自动隔离链接到外部的技能、插件或运行数据。</p>
      {workspacePicker.loading && <p role="status">正在读取工作区…</p>}
      {workspacePicker.error && <p className={styles.formError} role="alert">{workspacePicker.error}</p>}
      {workspacePicker.list && !workspacePicker.list.available && <p role="status">{workspacePicker.list.reason}</p>}
      {workspacePicker.list?.available && <div className={styles.workspaceChoices}>{workspacePicker.list.entries.map((entry: Workspace) => <div className={styles.workspaceChoice} key={entry.path}>
        <label className={styles.workspaceCheck}><input type="checkbox" checked={workspacePicker.selected.includes(entry.path)} disabled={busy || entry.registered || Boolean(entry.reason)} onChange={event => setWorkspacePicker({ ...workspacePicker, selected: event.target.checked ? [...workspacePicker.selected, entry.path] : workspacePicker.selected.filter(target => target !== entry.path) })} /><span>{entry.branch || '游离 HEAD'}<small>{entry.path}</small></span></label>
        {entry.registered || entry.reason ? <span className={styles.skillDescription}>{entry.registered ? '已加入看板' : entry.reason}</span> : <label className={styles.workspaceName}>看板名称<input aria-label={`${entry.branch || entry.path}的看板名称`} value={workspacePicker.names[entry.path] ?? entry.name} maxLength={120} disabled={busy} onChange={event => setWorkspacePicker({ ...workspacePicker, names: { ...workspacePicker.names, [entry.path]: event.target.value } })} /></label>}
      </div>)}</div>}
      <label className={styles.skillInstallLabel}><input type="checkbox" checked={workspacePicker.installSkill} disabled={busy} onChange={event => setWorkspacePicker({ ...workspacePicker, installSkill: event.target.checked })} /><span>同时安装／补齐案屿 Skill<small>官方旧版自动升级，改过的同名文件保留。</small></span></label>
      <div className={styles.dialogActions}><button className={styles.secondary} disabled={busy} onClick={() => setWorkspacePicker(null)}>取消</button><button className={styles.primary} disabled={busy || workspacePicker.loading || !workspacePicker.selected.length} onClick={() => void addSelectedWorkspaces()}>{busy ? '正在添加…' : `添加所选（${workspacePicker.selected.length}）`}</button></div>
    </div></Modal>}
    {worktreeOpen && current && (() => {
      const dirs = parseWorktreeInput(worktreeInput, baseName(current.path));
      const prompt = dirs.length ? worktrees(current, worktreeBase.trim() || 'main', dirs) : '';
      return <Modal title="创建工作区" close={() => setWorktreeOpen(false)}><div className={styles.projectForm}>
        <p>生成一段交给项目 Agent 的指令，让它在仓库里创建 git worktree。案屿只生成词、不执行；建好后用「添加已有工作区」加入看板，可顺带装 Skill。</p>
        <p className={styles.skillDescription}>Agent 配置与依赖（如 .agents、.claude、.trae、node_modules）不会跟着 worktree 复制；每个目录还要由你另开一个 Agent 会话，把工作目录切过去。</p>
        <label>基准分支<input value={worktreeBase} maxLength={120} onChange={event => setWorktreeBase(event.target.value)} placeholder="main" /></label>
        <label>方向 <span>每行一个分支，也可写「分支 | 目录名」</span><textarea className={styles.agentInput} value={worktreeInput} maxLength={2000} onChange={event => setWorktreeInput(event.target.value)} placeholder={worktreePlaceholder} /></label>
        {worktreeNote && <p className={styles.transferNote} role="status">{worktreeNote}</p>}
        <label>预览<textarea readOnly className={styles.handoff} value={prompt} onFocus={event => event.target.select()} /></label>
        <div className={styles.dialogActions}><button className={styles.secondary} onClick={() => setWorktreeOpen(false)}>关闭</button><button className={styles.primary} disabled={busy || !dirs.length} onClick={() => void copyWorktree(current)}><Icon name="copy" />复制工作区词</button></div>
      </div></Modal>;
    })()}
    {gitCopy !== null && <Modal title="复制提交/推送命令" close={() => setGitCopy(null)}><div className={styles.projectForm}><p>浏览器未允许自动复制，请选中下方命令后复制，粘贴到终端自行运行。</p><textarea autoFocus className={styles.handoff} aria-label="提交/推送命令" readOnly value={gitCopy} onFocus={event => event.target.select()} /><div className={styles.dialogActions}><button className={styles.secondary} onClick={() => setGitCopy(null)}>关闭</button></div></div></Modal>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
