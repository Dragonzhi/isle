import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GitHistory, Project, ProjectSkill, Snapshot, TaskState, Workspace, Workspaces } from '../shared/types.ts';
import { closeout, focusTask, handoff, skillTransfer, worktrees } from '../shared/types.ts';
import { SummaryMarkdown } from './SummaryMarkdown.ts';
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

function Icon({ name }: { name: 'plus' | 'copy' | 'arrow' | 'refresh' | 'close' | 'island' }) {
  const paths = {
    plus: 'M12 5v14M5 12h14', copy: 'M9 9h11v11H9zM15 9V4H4v11h5',
    arrow: 'M5 12h14m-6-6 6 6-6 6', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12 0l2 5M4 12l2 5a7 7 0 0 0 12 0',
    close: 'm6 6 12 12M6 18 18 6', island: 'M3 18c3-2 5 2 8 0s5 2 10 0M5 14l6-9 7 9H5Z',
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
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
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [form, setForm] = useState<'add' | Project | null>(null);
  const [formPath, setFormPath] = useState('');
  const [formName, setFormName] = useState('');
  const [installSkill, setInstallSkill] = useState(true);
  const [formError, setFormError] = useState('');
  const [handoffProject, setHandoffProject] = useState<Project | null>(null);
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
  const [git, setGit] = useState<{ id: string; history: GitHistory | null; loading: boolean; error: string }>({ id: '', history: null, loading: false, error: '' });
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

  const projects = data?.projects ?? [];
  const currentId = route.startsWith('#project/') ? route.slice(9) : '';
  const current = projects.find(project => project.id === currentId);
  const done = projects.filter(project => project.status === '已完成');
  const visible = projects.filter(project => (showDone || project.status !== '已完成') && (!onlyStale || stale(project)));
  const oldCount = projects.filter(stale).length;
  const groupTotals = new Map<string, number>();
  for (const project of projects) {
    const key = project.group ?? 'project:' + project.id;
    groupTotals.set(key, (groupTotals.get(key) ?? 0) + 1);
  }
  const currentGroup = current?.group ? { label: groupLabel(projects, current.group), count: projects.filter(project => project.group === current.group).length, role: current.role } : null;
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
    setGit({ id: project.id, history: null, loading: true, error: '' });
    try {
      const history = await request('GET', `/${project.id}/git`) as GitHistory;
      if (token === gitToken.current) setGit({ id: project.id, history, loading: false, error: '' });
    } catch (error) {
      if (token === gitToken.current) setGit({ id: project.id, history: null, loading: false, error: (error as Error).message });
    }
  }
  async function copyGit(project: Project) {
    if (busy) return;
    const command = gitCommand(project);
    try { await navigator.clipboard.writeText(command); setNotice({ message: '已复制提交/推送命令，粘贴到终端自行运行；案屿不会代替你执行。' }); }
    catch { setGitCopy(command); }
  }
  useEffect(() => {
    if (current && current.state === 'ok') void loadGit(current);
    else setGit(previous => previous.id ? { id: '', history: null, loading: false, error: '' } : previous);
  }, [current?.id, current?.state]);
  useEffect(() => {
    if (current && current.state === 'ok') void loadSkill(current);
    else { skillToken.current++; setSkill(previous => previous.id ? { id: '', status: null, loading: false, error: '' } : previous); }
  }, [current?.id, current?.state]);

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || form || agentDraft || handoffProject || summaryCopy !== null || gitCopy !== null || worktreeOpen || workspacePicker || currentId || busy || editing || event.isComposing) return;
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
  }, [navOrder, selected, form, agentDraft, handoffProject, summaryCopy, gitCopy, worktreeOpen, workspacePicker, currentId, busy, editing]);

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
  async function remove(project: Project) {
    if (!data || busy) return;
    setBusy(true);
    try { accept(await api('DELETE', `/${project.id}`, { registryHash: data.registryHash })); location.hash = ''; setNotice({ message: '项目已移出看板' }); }
    catch (error) { setNotice({ message: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }

  function nextEditor(project: Project, showFocus = true) {
    const focus = focusTask(project.tasks);
    if (editing?.id === project.id && editing.kind === 'next') return <form className={styles.editForm} onSubmit={saveNext}>
      <input ref={editInput} aria-label={`${project.name}的下一步`} value={editing.value} maxLength={4000} disabled={busy} placeholder="下一步做什么" onChange={event => setEditing({ ...editing, value: event.target.value })} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); setEditing(null); } if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
      <button className={styles.smallButton} disabled={busy || editing.conflict}>保存</button>
      <button type="button" className={styles.textButton} disabled={busy} onClick={() => setEditing(null)}>取消</button>
      {focus && editing.value !== focus.title && <button type="button" className={styles.textButton} title={`填入任务：${focus.title}`} onClick={() => setEditing({ ...editing, value: focus.title })}>填入任务</button>}
      {editing.conflict && <button type="button" className={styles.conflict} onClick={() => void reviewConflict()}>文件已变更，点击核对最新内容</button>}
      {editing.reviewed && <div className={styles.comparison}>最新内容：{editing.baseline || '（空）'}。已保留你的输入，确认后可直接保存。</div>}
    </form>;
    return <div className={styles.nextCellContent}>
      <button className={`${styles.nextButton} ${!project.next ? styles.missing : ''}`} title={project.next || '点击填写下一步'} onClick={() => startEdit(project)} disabled={project.state !== 'ok' || editing?.kind === 'summary'}>
        {project.next || '+ 填写下一步'}
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

  function boardCard(project: Project, grouped = false) {
    const nameId = 'name-' + project.id;
    const Name = grouped ? 'h3' : 'h2';
    return <li id={'project-' + project.id} aria-labelledby={nameId} tabIndex={0} key={project.id} onFocus={() => setSelected(project.id)} onMouseDown={() => setSelected(project.id)} className={[styles.projectCard, grouped && project.role === 'main' ? styles.mainWorkspace : '', selected === project.id ? styles.selected : '', project.state !== 'ok' ? styles.unavailable : ''].filter(Boolean).join(' ')}>
      {grouped && <p className={styles.workspaceRole}>{project.role === 'main' ? '主工作区' : '分线工作区'}</p>}
      <div className={styles.cardHeading}>
        <Name id={nameId} className={styles.projectName}>{project.state === 'offline' ? project.name : <a href={'#project/' + project.id} title={project.name}>{project.name}</a>}</Name>
        <span className={[styles.status, project.status === '暂停' ? styles.paused : ''].filter(Boolean).join(' ')}><span className={[styles.stateDot, project.status === '进行中' && project.state === 'ok' ? styles.green : ''].filter(Boolean).join(' ')} />{project.state === 'ok' ? project.status : project.state === 'offline' ? '离线' : '读取失败'}</span>
      </div>
      <p className={styles.cardPath} title={project.path}>{project.path}</p>
      <div className={styles.cardBody}>
        <p className={styles.cardLabel}>{project.state === 'ok' ? '下一步' : '需要检查'}</p>
        {project.state === 'ok' ? nextEditor(project) : <div className={styles.cardError}><p>{project.error}</p><div className={styles.cardErrorActions}><button className={styles.textButton} onClick={() => openForm(project)}>重新指向 →</button><button className={styles.textButton} disabled={busy} onClick={() => void remove(project)}>移出看板</button></div></div>}
      </div>
      <div className={styles.cardFooter}>
        <span className={[styles.freshness, stale(project) ? project.age >= 14 ? styles.overdue : styles.aging : ''].filter(Boolean).join(' ')} title={project.updated ? project.updated + (project.estimated ? ' (文件时间估值)' : '') : undefined}>{project.state === 'ok' ? '记录更新 · ' : ''}{freshness(project)}</span>
        <button
          className={styles.cardTransfer}
          disabled={project.state !== 'ok' || busy || Boolean(editing)}
          title="开工 / 收工（c 复制开工词）"
          aria-label={project.name + '的开工与收工'}
          onClick={() => void openTransfer(project, 'start')}
        ><Icon name="copy" />开工 / 收工</button>
      </div>
    </li>;
  }

  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  return <div className={styles.app}>
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="#"><span className={styles.brandMark}><Icon name="island" /></span><span>案屿<small>ISLE</small></span></a>
      <div className={styles.navLabel}>工作空间</div>
      <a className={`${styles.navItem} ${!currentId ? styles.navActive : ''}`} href="#"><Icon name="island" />项目总览<span>{groupTotals.size}</span></a>
      <button className={styles.agentNav} disabled={busy || Boolean(editing)} onClick={() => void openAgents()}>Agent 名单</button>
      <div className={styles.sidebarBottom}><small>v0.1</small></div>
    </aside>
    <main className={`${styles.main} ${currentId ? styles.projectPage : ''}`}>
      <header className={styles.topbar}><span>{date}</span></header>
      {notice && <div className={`${styles.notice} ${notice.error ? styles.noticeError : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.message}</span><button aria-label="关闭提示" className={styles.iconButton} onClick={() => setNotice(null)}><Icon name="close" /></button></div>}
      {currentId ? <>
        <a className={styles.back} href="#">← 返回总览</a>
        {current ? <>
          <div className={`${styles.heading} ${styles.projectHeading}`}><div><h1>{current.name}</h1><p className={styles.path}>{current.path}</p>{currentGroup && (currentGroup.count > 1 || currentGroup.role === 'worktree') && <p className={styles.groupMeta}>{currentGroup.role === 'main' ? '主工作区 · 共 ' + currentGroup.count + ' 条线' : currentGroup.label + ' · 工作区'}</p>}</div><div className={styles.transferActions}><button className={styles.secondary} disabled={busy || Boolean(editing) || current.state !== 'ok'} onClick={() => void openWorkspacePicker(current)}>添加已有工作区</button><button className={styles.secondary} disabled={loading || busy} onClick={() => void refresh()}><Icon name="refresh" />刷新记录</button><button className={styles.secondary} disabled={current.state !== 'ok' || busy || Boolean(editing)} onClick={() => void openTransfer(current, 'close')}>收工回写</button><button className={styles.primary} disabled={current.state !== 'ok' || busy || Boolean(editing)} onClick={() => void openTransfer(current, 'start')}><Icon name="copy" />交给新 Agent</button></div></div>
          <section className={styles.contextCard} aria-label="项目下一步">
            <div className={styles.contextMeta}><span className={styles.status}>{current.status}</span><span>{freshness(current)}</span></div>
            <p className={styles.fieldLabel}>下一步</p>
            {nextEditor(current, false)}
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
                  <span className={styles.checkbox} aria-label={state === '已完成' ? '已完成' : '未完成'}>{state === '已完成' ? '✓' : ''}</span>
                  <div className={styles.taskCopy}><span className={styles.taskTitle}>{task.title}</span>
                    {(isFocus || task.tags.length > 0 || task.conflict) && <div className={styles.taskMeta}>
                      {isFocus && <span className={styles.focusBadge}>当前聚焦</span>}
                      {task.tags.map(tag => <small className={styles.tag} key={tag}>{tag}</small>)}
                      {task.conflict && <span title="复选框与分节不一致" className={styles.taskWarning}>状态需核对</span>}
                    </div>}
                  </div>
                </li>;
              })}</ul>
            </Group>;
          })}</div>{!current.tasks.length && <p className={styles.noTasks}>暂无任务</p>}</section>}
          {current.state === 'ok' && <section className={styles.summaryCard} aria-label="交接摘要">
            <div className={styles.summaryHeading}><h2>交接摘要</h2><div className={styles.transferActions}><button className={styles.textButton} disabled={busy || Boolean(editing) || !current.summary?.trim()} onClick={() => void copySummary(current)}><Icon name="copy" />复制摘要</button><button className={styles.textButton} disabled={busy || Boolean(editing)} onClick={() => startEdit(current, 'summary')}>手动补记</button></div></div>
            {editing?.id === current.id && editing.kind === 'summary' ? <form onSubmit={saveNext}>
              <label className={styles.srOnly} htmlFor="summary-input">编辑交接摘要</label>
              <textarea id="summary-input" ref={summaryInput} className={styles.summaryInput} value={editing.value} maxLength={10000} disabled={busy} placeholder={'已确认：\n验证结果：\n未完成或阻塞：\n接着做：'} onChange={event => setEditing({ ...editing, value: event.target.value })} onKeyDown={event => { if (event.key === 'Escape' && !busy) setEditing(null); }} />
              {editing.conflict && <button type="button" className={styles.conflict} onClick={() => void reviewConflict()}>文件已变更，保留输入并核对最新内容</button>}
              {editing.reviewed && <div className={styles.comparison}>文件中的最新摘要：<pre>{editing.baseline || '（空）'}</pre>上方保留了你的输入，确认后可保存。</div>}
              <div className={styles.dialogActions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setEditing(null)}>取消</button><button className={styles.primary} disabled={busy || editing.conflict}>保存摘要</button></div>
            </form> : current.summary ? <div className={styles.markdown}><SummaryMarkdown text={current.summary} /></div> : <p className={styles.summaryEmpty}>收工时，把收工词发给当前 Agent，回写后刷新。也可以在这里手动补记。</p>}
          </section>}
          {current.state === 'ok' && <section className={`${styles.summaryCard} ${styles.historyCard}`} aria-label="工作留痕">
            <div className={styles.summaryHeading}><h2>工作留痕</h2><span className={styles.historyHint}>按次追加 · Agent 自述</span></div>
            {current.history ? <div className={styles.markdown}><SummaryMarkdown text={current.history} /></div> : <p className={styles.summaryEmpty}>暂无留痕。收工时选择署名，让 Agent 追加本次推进和验证结果；未完成的工作也可以记录。</p>}
          </section>}
          {current.state === 'ok' && git.id === current.id && <section className={styles.gitCard} aria-label="Git 历史">
            <div className={styles.summaryHeading}><h2>Git 历史</h2><div className={styles.transferActions}><button className={styles.textButton} disabled={busy || git.loading} onClick={() => void loadGit(current)}><Icon name="refresh" />刷新</button><button className={styles.textButton} disabled={busy} onClick={() => void copyGit(current)}><Icon name="copy" />复制提交/推送命令</button></div></div>
            {git.loading && <p className={styles.summaryEmpty}>正在读取 git 历史…</p>}
            {!git.loading && git.error && <p className={styles.summaryEmpty}>{git.error}</p>}
            {!git.loading && git.history && !git.history.available && <p className={styles.summaryEmpty}>{git.history.reason || '无法读取 git 历史。'}</p>}
            {!git.loading && git.history && git.history.available && (git.history.entries.length
              ? <ul className={styles.gitList}>{git.history.entries.map((entry, index) => <li key={index}><code className={styles.gitHash}>{entry.hash}</code><time className={styles.gitDate}>{entry.date}</time><span className={styles.gitMessage}>{entry.message}</span></li>)}</ul>
              : <p className={styles.summaryEmpty}>{git.history.reason || '暂无提交。'}</p>)}
            <p className={styles.gitHint}>只读预览最近的提交；提交与推送由你在终端执行，案屿不主动操作 git、不出网。</p>
          </section>}
          {current.state === 'ok' && <section className={styles.summaryCard} aria-label="项目 Skill">
            <div className={styles.summaryHeading}><h2>项目 Skill</h2><button className={styles.secondary} disabled={busy || skill.loading} onClick={() => void installProjectSkill(current)}>{skill.status?.state === 'outdated' ? '升级' : skill.status?.state === 'missing' ? '安装' : skill.status?.state === 'partial' ? '补齐' : '安装 / 补齐'}</button></div>
            <p className={styles.skillDescription}>{skill.loading ? '正在检查项目 Skill…' : skill.error || (skill.status ? skillLabels[skill.status.state] : '尚未检查')}。就绪后可以对 Agent 说：“使用 isle（案屿）Skill 收工回写，署名 Codex”。</p>
            <p className={styles.skillDescription}>提供 Codex、OpenCode、Claude Code 和 TRAE 的项目入口。补充缺失文件，并把官方旧版升级到当前版本；官方旧版以外的同名文件（含你改过的）保留不覆盖。</p>
            {skill.id === current.id && skill.status && <details className={styles.skillFiles}><summary>查看安装文件</summary><ul>{skill.status.files.map(file => <li key={file.path}><code>{file.path}</code><span>{({ ready: '就绪', missing: '缺失', outdated: '官方旧版，可升级', custom: '已有不同内容，未覆盖', error: '无法访问' })[file.state]}{file.message ? `：${file.message}` : ''}</span></li>)}</ul></details>}
          </section>}
          <footer className={styles.projectFooter}><span>任务、摘要与留痕保存在 TASKS.md 中</span><div><button className={styles.textButton} onClick={() => openForm(current)}>修改路径</button><button className={styles.textButton} disabled={busy} onClick={() => openWorktrees()}>建工作区</button><button className={styles.textButton} disabled={busy} onClick={() => void remove(current)}>移出看板</button></div></footer>
        </> : <p className={styles.emptyText}>{loading ? '正在读取项目…' : '该项目不存在或已被移除。'}</p>}
      </> : <>
        <div className={styles.heading}><div><h1>项目</h1><p className={styles.subtitle}>{projects.length ? `${groupTotals.size} 个项目 · ${projects.length} 个工作区${oldCount ? ` · ${oldCount} 个工作区待检查` : ''}` : '添加本地项目以开始跟踪'}</p></div><button className={styles.primary} onClick={() => openForm()}><Icon name="plus" />添加项目</button></div>
        {data?.warnings.length ? <details className={styles.warnings} open><summary>清单有 {data.warnings.length} 条提示</summary><ul>{data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details> : null}
        {loading && !data ? <p className={styles.emptyText}>正在读取项目…</p> : !projects.length ? <section className={styles.empty}>
          <div className={styles.emptyIsland}><Icon name="island" /></div><h2>暂无项目</h2><p>添加本地项目目录，案屿将读取其中的 TASKS.md。<br />若文件不存在，会自动创建模板。</p><button className={styles.primary} onClick={() => openForm()}><Icon name="plus" />添加项目</button>
        </section> : <>
          <div className={styles.toolbar}><span>{onlyStale ? '久未更新' : '全部项目'}<small>{boardGroups.length} 个项目 · {visible.length} 个工作区</small></span><div><label className={styles.filter}><input type="checkbox" checked={onlyStale} onChange={event => setOnlyStale(event.target.checked)} />只看久未更新</label><button className={styles.iconButton} aria-label="刷新项目" title="刷新" disabled={loading} onClick={() => void refresh()}><Icon name="refresh" /></button></div></div>
          <ul className={styles.projectGrid} role="list" aria-label="项目总览" data-render-ms={renderMs?.toFixed(1)}>
            {boardGroups.map(group => group.multi
              ? <li className={styles.projectGroup} key={group.key} aria-labelledby={'group-' + group.members[0].id}>
                <header className={styles.groupHeader}>
                  <div><p className={styles.groupEyebrow}>项目</p><h2 id={'group-' + group.members[0].id} className={styles.groupTitle} title={group.key}>{groupLabel(projects, group.key)}</h2></div>
                  <div className={styles.groupActions}><span className={styles.groupCount}>{group.members.length === group.total ? `${group.total} 个工作区` : `显示 ${group.members.length} / ${group.total} 个工作区`}</span><button className={styles.secondary} disabled={busy || Boolean(editing) || !group.members.some(project => project.state === 'ok')} onClick={() => void openWorkspacePicker(group.members.find(project => project.state === 'ok')!)}>添加已有工作区</button></div>
                </header>
                <ul className={styles.workspaceGrid} aria-label={groupLabel(projects, group.key) + '的工作区'}>{group.members.map(project => boardCard(project, true))}</ul>
              </li>
              : group.members.map(project => boardCard(project)))}
          </ul>
          {!visible.length && <p className={styles.emptyText}>没有符合条件的项目。</p>}
          {done.length > 0 && <button className={styles.doneToggle} onClick={() => setShowDone(!showDone)}>{showDone ? '▾' : '▸'} {done.length} 个已完成工作区{showDone ? ' · 收起' : ' · 展开'}</button>}
          <footer className={styles.listFooter}><span /><div><kbd>j</kbd><kbd>k</kbd> 移动 <kbd>↵</kbd> 查看 <kbd>c</kbd> 复制开工词</div></footer>
        </>}
      </>}
    </main>
    {agentDraft && <Modal title="Agent 名单" close={() => { if (!busy) setAgentDraft(null); }}><form className={styles.projectForm} onSubmit={saveAgents}>
      <p>每行一个名称，可写工具名或你确认的模型名。名单用于交接时选择署名；改名或移除不会修改过去的留痕。</p>
      <label>Agent 名称<textarea autoFocus className={styles.agentInput} value={agentDraft.value} maxLength={4000} disabled={busy || agentDraft.hash === null} onChange={event => setAgentDraft({ ...agentDraft, value: event.target.value })} placeholder={'Codex\nOpenCode\nTrae'} /></label>
      {agentError && <p className={styles.formError} role="alert">{agentError}</p>}
      <div className={styles.dialogActions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setAgentDraft(null)}>取消</button><button className={styles.primary} disabled={busy || agentDraft.hash === null}>{busy ? '保存中…' : '保存名单'}</button></div>
    </form></Modal>}
    {form && <Modal title={form === 'add' ? '添加项目' : '重新指向'} close={() => { if (!busy) setForm(null); }}><form onSubmit={register} className={styles.projectForm}><label>项目目录<input autoFocus required value={formPath} onChange={event => setFormPath(event.target.value)} placeholder={'D:\\work\\my-project'} disabled={busy} autoComplete="off" /></label><label>项目名称 <span>可选，留空使用目录名</span><input value={formName} maxLength={120} onChange={event => setFormName(event.target.value)} placeholder="例如：棱镜" disabled={busy} /></label>
      <label className={styles.skillInstallLabel}><input type="checkbox" checked={installSkill} disabled={busy} onChange={event => setInstallSkill(event.target.checked)} /><span>安装项目级案屿 Skill<small>生成 .agents、.claude、.trae 的项目入口；官方旧版会升级，改过的同名文件不覆盖。</small></span></label>
      {formError && <p className={styles.formError} role="alert">{formError}</p>}<div className={styles.dialogActions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setForm(null)}>取消</button><button className={styles.primary} disabled={busy}>{busy ? '正在保存…' : form === 'add' ? '添加项目' : '保存'}</button></div></form></Modal>}
    {handoffProject && <Modal title={handoffMode === 'close' ? '收工回写' : '交给新 Agent'} close={() => setHandoffProject(null)}><div className={styles.projectForm}>
      <div className={styles.transferTabs} role="group" aria-label="交接阶段"><button disabled={busy} aria-pressed={handoffMode === 'close'} onClick={() => { setHandoffMode('close'); setTransferNote(''); }}>1 · 收工词</button><span>→</span><button disabled={busy} aria-pressed={handoffMode === 'start'} onClick={() => { setHandoffMode('start'); setTransferNote(''); }}>2 · 开工词</button></div>
      <p>{handoffMode === 'close' ? '发给正在工作的 Agent，让它整理实际结果并回写。回写后刷新，再把开工词交给下一家。' : '带上最新记录，交给下一位 Agent 接着做。打开和复制时都会重新读取任务文件。'}</p>
      <div className={styles.transferTabs} role="group" aria-label="指令格式"><button aria-pressed={transferFormat === 'skill'} disabled={busy || skill.id !== handoffProject.id || skill.status?.files[0]?.state !== 'ready'} onClick={() => { setTransferFormat('skill'); setTransferNote(''); }}>Skill 短指令</button><button aria-pressed={transferFormat === 'full'} disabled={busy} onClick={() => { setTransferFormat('full'); setTransferNote(''); }}>完整提示词</button></div>
      {transferFormat === 'full' && skill.status?.state !== 'ready' && <p className={styles.skillDescription}>项目 Skill 尚未全部就绪，当前使用完整提示词；可在项目页安装或检查。</p>}
      <label>{handoffMode === 'close' ? '本次署名' : '接手 Agent'}<select aria-describedby="author-hint" disabled={busy} value={authors[handoffMode]} onChange={event => { setAuthors({ ...authors, [handoffMode]: event.target.value }); setTransferNote(''); }}>
        <option value="">未指定，由 Agent 向我确认署名</option>
        {[...new Set([...(data?.agents ?? []), ...(authors[handoffMode] ? [authors[handoffMode]] : [])])].map(name => <option key={name} value={name}>{name}</option>)}
      </select></label><span id="author-hint" className={styles.authorHint}>收工时追加本次贡献并署名。自定义名称可在侧栏“Agent 名单”中维护。</span>
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
