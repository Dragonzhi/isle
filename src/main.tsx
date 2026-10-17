import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Project, Snapshot, TaskState } from '../shared/types.ts';
import { closeout, focusTask, handoff } from '../shared/types.ts';
import { SummaryMarkdown } from './SummaryMarkdown.ts';
import styles from './App.module.css';

class RequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function api(method = 'GET', suffix = '', input?: unknown, endpoint = '/api/projects'): Promise<Snapshot> {
  const response = await fetch(endpoint + suffix, {
    method, credentials: 'same-origin',
    headers: input === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(data.error || '操作失败，请重试。', response.status);
  return data;
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

type Editing = { id: string; kind: 'next' | 'summary'; value: string; hash: string; baseline: string; conflict?: boolean; reviewed?: boolean };
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
  const [formError, setFormError] = useState('');
  const [handoffProject, setHandoffProject] = useState<Project | null>(null);
  const [handoffMode, setHandoffMode] = useState<'start' | 'close'>('start');
  const [goal, setGoal] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [summaryCopy, setSummaryCopy] = useState<string | null>(null);
  const [criteria, setCriteria] = useState('');
  const [authors, setAuthors] = useState({ start: '', close: '' });
  const [agentDraft, setAgentDraft] = useState<{ value: string; hash: string | null } | null>(null);
  const [agentError, setAgentError] = useState('');
  const [route, setRoute] = useState(location.hash);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const arrival = useRef(0);
  const editInput = useRef<HTMLInputElement>(null);
  const summaryInput = useRef<HTMLTextAreaElement>(null);

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
      setHandoffProject(latest); setHandoffMode(mode); setGoal(''); setCriteria(''); setTransferNote(''); setAuthors({ start: '', close: '' });
    } catch (error) { setNotice({ message: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }
  async function copy(project: Project, mode: 'start' | 'close' = 'start', standard = '', target = '', author = '') {
    if (busy || editing) return;
    setBusy(true);
    try {
      const latest = await latestProject(project);
      if (handoffProject?.id === project.id && latest.hash !== project.hash) {
        setHandoffProject(latest); setTransferNote('文件已更新，预览已刷新。请核对后再次复制。'); return;
      }
      try {
        await navigator.clipboard.writeText(mode === 'close' ? closeout(latest, author) : handoff(latest, standard, target, author));
        const message = mode === 'close' ? '收工词已复制，发给当前 Agent 回写后再刷新。' : '开工词已复制，发给下一位 Agent。';
        if (handoffProject) setTransferNote(message); else setNotice({ message });
      } catch {
        setHandoffProject(latest); setHandoffMode(mode); setGoal(target); setCriteria(standard);
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

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || form || agentDraft || handoffProject || summaryCopy !== null || currentId || busy || editing || event.isComposing) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') { setSelected(''); return; }
      const index = visible.findIndex(project => project.id === selected);
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const next = visible[Math.max(0, Math.min(visible.length - 1, index < 0 ? 0 : index + (event.key === 'j' ? 1 : -1)))];
        if (next) { setSelected(next.id); document.getElementById(`row-${next.id}`)?.scrollIntoView({ block: 'nearest' }); }
      }
      const project = visible[index];
      if (!project) return;
      if (event.key === 'Enter' && !target.closest('button,a') && project.state !== 'offline') { event.preventDefault(); location.hash = `project/${project.id}`; }
      if (event.key === 'c' && project.state === 'ok') { event.preventDefault(); void copy(project); }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [visible, selected, form, agentDraft, handoffProject, summaryCopy, currentId, busy, editing]);

  function openForm(project?: Project) {
    setForm(project ?? 'add'); setFormPath(project?.path ?? ''); setFormName(project?.name ?? ''); setFormError('');
  }
  async function register(event: React.FormEvent) {
    event.preventDefault(); if (!data || busy) return;
    setBusy(true); setFormError('');
    try {
      const replacing = form && form !== 'add' ? form : null;
      accept(await api('POST', replacing ? `/${replacing.id}/repoint` : '', { path: formPath, name: formName, registryHash: data.registryHash }));
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

  function nextEditor(project: Project) {
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
      {focus && (
        <span className={styles.focusTaskChip} title={`当前任务：${focus.title}${focus.tags.length ? ' ' + focus.tags.join(' ') : ''}`}>
          <span className={styles.focusTaskIcon}>↳</span>
          <span className={styles.focusTaskTitle}>{focus.title}</span>
          {focus.tags.map(tag => <small key={tag} className={styles.tag}>{tag}</small>)}
        </span>
      )}
    </div>;
  }

  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  return <div className={styles.app}>
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="#"><span className={styles.brandMark}><Icon name="island" /></span><span>案屿<small>ISLE</small></span></a>
      <div className={styles.navLabel}>工作空间</div>
      <a className={`${styles.navItem} ${!currentId ? styles.navActive : ''}`} href="#"><Icon name="island" />项目总览<span>{projects.length}</span></a>
      <button className={styles.agentNav} disabled={busy || Boolean(editing)} onClick={() => void openAgents()}>Agent 名单</button>
      <div className={styles.sidebarBottom}><small>v0.1</small></div>
    </aside>
    <main className={styles.main}>
      <header className={styles.topbar}><span>{date}</span></header>
      {notice && <div className={`${styles.notice} ${notice.error ? styles.noticeError : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.message}</span><button aria-label="关闭提示" className={styles.iconButton} onClick={() => setNotice(null)}><Icon name="close" /></button></div>}
      {currentId ? <>
        <a className={styles.back} href="#">← 返回总览</a>
        {current ? <>
          <div className={styles.heading}><div><h1>{current.name}</h1><p className={styles.path}>{current.path}</p></div><div className={styles.transferActions}><button className={styles.secondary} disabled={current.state !== 'ok' || busy || Boolean(editing)} onClick={() => void openTransfer(current, 'close')}>收工回写</button><button className={styles.primary} disabled={current.state !== 'ok' || busy || Boolean(editing)} onClick={() => void openTransfer(current, 'start')}><Icon name="copy" />交给新 Agent</button></div></div>
          <section className={styles.contextCard} aria-label="项目下一步">
            <div className={styles.contextMeta}><span className={styles.status}>{current.status}</span><span>{freshness(current)}</span></div>
            {(() => {
              const focus = focusTask(current.tasks);
              return focus ? <div className={styles.detailFocusTask}>
                <span className={styles.focusBadge}>下一步任务</span>
                <span>{focus.title}</span>
                {focus.tags.map(tag => <small key={tag} className={styles.tag}>{tag}</small>)}
              </div> : null;
            })()}
            <p className={styles.fieldLabel}>下一步</p>
            {nextEditor(current)}
          </section>
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
          {current.error && <div className={styles.errorCard}><strong>{current.state === 'offline' ? '离线' : '读取失败'}</strong><p>{current.error}</p><button className={styles.secondary} onClick={() => openForm(current)}>重新指向</button>{current.preview && <pre>{current.preview}</pre>}</div>}
          {current.warnings.length > 0 && <details className={styles.warnings}><summary>{current.warnings.length} 条提示</summary><ul>{current.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
          {current.state === 'ok' && <div className={styles.taskGroups}>{(['待办', '进行中', '已完成'] as TaskState[]).map(state => {
            const focus = focusTask(current.tasks);
            return <section className={styles.taskGroup} key={state}>
              <h2><span className={`${styles.stateDot} ${state === '进行中' ? styles.green : ''}`} />{state}<small>{current.tasks.filter(task => task.state === state).length}</small></h2>
              {current.tasks.filter(task => task.state === state).map(task => {
                const isFocus = focus && task.line === focus.line && task.state !== '已完成';
                return <div key={task.line} className={`${styles.task} ${state === '已完成' ? styles.doneTask : ''}`}>
                  <span className={styles.checkbox} aria-label={state === '已完成' ? '已完成' : '未完成'}>{state === '已完成' ? '✓' : ''}</span>
                  {isFocus && <span className={styles.focusBadge}>下一步</span>}
                  <span>{task.title}</span>
                  {task.tags.map(tag => <small className={styles.tag} key={tag}>{tag}</small>)}
                  {task.conflict && <span title="复选框与分节不一致" className={styles.taskWarning}>!</span>}
                </div>;
              })}
              {!current.tasks.some(task => task.state === state) && <p className={styles.noTasks}>暂无任务</p>}
            </section>;
          })}</div>}
          {current.state === 'ok' && <section className={styles.summaryCard} aria-label="工作留痕">
            <div className={styles.summaryHeading}><h2>工作留痕</h2><span className={styles.historyHint}>按次追加 · Agent 自述</span></div>
            {current.history ? <div className={styles.markdown}><SummaryMarkdown text={current.history} /></div> : <p className={styles.summaryEmpty}>暂无留痕。收工时选择署名，让 Agent 追加本次推进和验证结果；未完成的工作也可以记录。</p>}
          </section>}
          <footer className={styles.projectFooter}><span>任务、摘要与留痕保存在 TASKS.md 中</span><div><button className={styles.textButton} onClick={() => openForm(current)}>修改路径</button><button className={styles.textButton} disabled={busy} onClick={() => void remove(current)}>移出看板</button><button className={styles.secondary} disabled={loading || busy} onClick={() => void refresh()}><Icon name="refresh" />刷新记录</button></div></footer>
        </> : <p className={styles.emptyText}>{loading ? '正在读取项目…' : '该项目不存在或已被移除。'}</p>}
      </> : <>
        <div className={styles.heading}><div><h1>项目</h1><p className={styles.subtitle}>{projects.length ? `${projects.filter(project => project.status === '进行中').length} 个进行中${oldCount ? ` · ${oldCount} 个待检查` : ''}` : '添加本地项目以开始跟踪'}</p></div><button className={styles.primary} onClick={() => openForm()}><Icon name="plus" />添加项目</button></div>
        {data?.warnings.length ? <details className={styles.warnings} open><summary>清单有 {data.warnings.length} 条提示</summary><ul>{data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details> : null}
        {loading && !data ? <p className={styles.emptyText}>正在读取项目…</p> : !projects.length ? <section className={styles.empty}>
          <div className={styles.emptyIsland}><Icon name="island" /></div><h2>暂无项目</h2><p>添加本地项目目录，案屿将读取其中的 TASKS.md。<br />若文件不存在，会自动创建模板。</p><button className={styles.primary} onClick={() => openForm()}><Icon name="plus" />添加项目</button>
        </section> : <>
          <div className={styles.toolbar}><span>全部项目 <small>{visible.length}</small></span><div><label className={styles.filter}><input type="checkbox" checked={onlyStale} onChange={event => setOnlyStale(event.target.checked)} />只看久未更新</label><button className={styles.iconButton} aria-label="刷新项目" title="刷新" disabled={loading} onClick={() => void refresh()}><Icon name="refresh" /></button></div></div>
          <div className={styles.table} role="table" aria-label="项目总览" data-render-ms={renderMs?.toFixed(1)}>
            <div className={styles.tableHead} role="row"><span role="columnheader">项目</span><span role="columnheader">状态</span><span role="columnheader">更新时间</span><span role="columnheader">下一步</span><span role="columnheader" className={styles.srOnly}>交接词</span></div>
            {visible.map(project => <div role="row" id={`row-${project.id}`} tabIndex={0} key={project.id} onFocus={() => setSelected(project.id)} onMouseDown={() => setSelected(project.id)} className={`${styles.row} ${selected === project.id ? styles.selected : ''} ${project.state !== 'ok' ? styles.unavailable : ''} ${editing?.id === project.id ? styles.editingRow : ''}`}>
              <div role="cell" className={styles.nameCell}>{project.state === 'offline' ? <span className={styles.projectName}>{project.name}</span> : <a className={styles.projectName} href={`#project/${project.id}`} title={project.path}>{project.name}</a>}</div>
              <span role="cell" className={`${styles.status} ${project.status === '暂停' ? styles.paused : ''}`}><span className={`${styles.stateDot} ${project.status === '进行中' && project.state === 'ok' ? styles.green : ''}`} />{project.status}</span>
              <span role="cell" className={`${styles.freshness} ${stale(project) ? project.age >= 14 ? styles.overdue : styles.aging : ''}`} title={project.updated ? `${project.updated}${project.estimated ? ' (文件时间估值)' : ''}` : undefined}>{freshness(project)}</span>
              <div role="cell" className={styles.nextCell}>{project.state === 'ok' ? nextEditor(project) : <div className={styles.rowError}><span title={project.error}>{project.error}</span><button className={styles.textButton} onClick={() => openForm(project)}>重新指向</button></div>}</div>
              <div role="cell"><button className={`${styles.iconButton} ${styles.copyButton}`} disabled={project.state !== 'ok' || busy || Boolean(editing)} title="开工 / 收工（c 复制开工词）" aria-label={`${project.name}的开工与收工`} onClick={() => void openTransfer(project, 'start')}><Icon name="copy" /></button></div>
            </div>)}
            {!visible.length && <p className={styles.emptyText}>没有符合条件的项目。</p>}
          </div>
          {done.length > 0 && <button className={styles.doneToggle} onClick={() => setShowDone(!showDone)}>{showDone ? '▾' : '▸'} {done.length} 个已完成{showDone ? ' · 收起' : ' · 展开'}</button>}
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
    {form && <Modal title={form === 'add' ? '添加项目' : '重新指向'} close={() => { if (!busy) setForm(null); }}><form onSubmit={register} className={styles.projectForm}><label>项目目录<input autoFocus required value={formPath} onChange={event => setFormPath(event.target.value)} placeholder={'D:\\work\\my-project'} disabled={busy} autoComplete="off" /></label><label>项目名称 <span>可选，留空使用目录名</span><input value={formName} maxLength={120} onChange={event => setFormName(event.target.value)} placeholder="例如：棱镜" disabled={busy} /></label>{formError && <p className={styles.formError} role="alert">{formError}</p>}<div className={styles.dialogActions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setForm(null)}>取消</button><button className={styles.primary} disabled={busy}>{busy ? '正在保存…' : form === 'add' ? '添加项目' : '保存'}</button></div></form></Modal>}
    {handoffProject && <Modal title={handoffMode === 'close' ? '收工回写' : '交给新 Agent'} close={() => setHandoffProject(null)}><div className={styles.projectForm}>
      <div className={styles.transferTabs} role="group" aria-label="交接阶段"><button disabled={busy} aria-pressed={handoffMode === 'close'} onClick={() => { setHandoffMode('close'); setTransferNote(''); }}>1 · 收工词</button><span>→</span><button disabled={busy} aria-pressed={handoffMode === 'start'} onClick={() => { setHandoffMode('start'); setTransferNote(''); }}>2 · 开工词</button></div>
      <p>{handoffMode === 'close' ? '发给正在工作的 Agent，让它整理实际结果并回写。回写后刷新，再把开工词交给下一家。' : '带上最新记录，交给下一位 Agent 接着做。打开和复制时都会重新读取任务文件。'}</p>
      <label>{handoffMode === 'close' ? '本次署名' : '接手 Agent'}<select aria-describedby="author-hint" disabled={busy} value={authors[handoffMode]} onChange={event => { setAuthors({ ...authors, [handoffMode]: event.target.value }); setTransferNote(''); }}>
        <option value="">未指定，由 Agent 向我确认署名</option>
        {[...new Set([...(data?.agents ?? []), ...(authors[handoffMode] ? [authors[handoffMode]] : [])])].map(name => <option key={name} value={name}>{name}</option>)}
      </select></label><span id="author-hint" className={styles.authorHint}>收工时追加本次贡献并署名。自定义名称可在侧栏“Agent 名单”中维护。</span>
      {handoffMode === 'start' && <><label>本次目标 <span>可选</span><input disabled={busy} value={goal} maxLength={1000} onChange={event => setGoal(event.target.value)} placeholder="留空按下一步继续，也可以指定这次要做的事" /></label><label>完成标准 <span>可选</span><input disabled={busy} value={criteria} maxLength={800} onChange={event => setCriteria(event.target.value)} placeholder="例如：通过所有单元测试" /></label></>}
      <textarea className={styles.handoff} aria-label={handoffMode === 'close' ? '收工词预览' : '开工词预览'} readOnly value={handoffMode === 'close' ? closeout(handoffProject, authors.close) : handoff(handoffProject, criteria, goal, authors.start)} onFocus={event => event.target.select()} />
      {handoffMode === 'close' && <details className={styles.summaryPreview}><summary>当前交接摘要</summary><div className={styles.markdown}><SummaryMarkdown text={handoffProject.summary || '暂无摘要。'} /></div></details>}
      {transferNote && <p className={styles.transferNote} role="status">{transferNote}</p>}
      <div className={styles.dialogActions}>{handoffMode === 'close' && <button className={styles.secondary} disabled={busy} onClick={() => void refreshTransfer()}><Icon name="refresh" />已回写，刷新记录</button>}<button className={styles.primary} disabled={busy} onClick={() => void copy(handoffProject, handoffMode, criteria, goal, authors[handoffMode])}><Icon name="copy" />{busy ? '读取中…' : handoffMode === 'close' ? '复制收工词' : '复制开工词'}</button></div>
    </div></Modal>}
    {summaryCopy !== null && <Modal title="复制交接摘要" close={() => setSummaryCopy(null)}><div className={styles.projectForm}><p>浏览器未允许自动复制，请选中下方原文后复制。</p><textarea autoFocus className={styles.handoff} aria-label="交接摘要原文" readOnly value={summaryCopy} onFocus={event => event.target.select()} /><div className={styles.dialogActions}><button className={styles.secondary} onClick={() => setSummaryCopy(null)}>关闭</button></div></div></Modal>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
