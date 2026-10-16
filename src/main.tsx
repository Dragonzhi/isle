import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Project, Snapshot, TaskState } from '../shared/types.ts';
import { handoff } from '../shared/types.ts';
import styles from './App.module.css';

class RequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function api(method = 'GET', suffix = '', input?: unknown): Promise<Snapshot> {
  const response = await fetch('/api/projects' + suffix, {
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

type Editing = { id: string; value: string; hash: string; baseline: string; conflict?: boolean; reviewed?: boolean };
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
  const [criteria, setCriteria] = useState('');
  const [route, setRoute] = useState(location.hash);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const arrival = useRef(0);
  const editInput = useRef<HTMLInputElement>(null);

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
  useEffect(() => { editInput.current?.focus(); }, [editing?.id]);
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

  async function copy(project: Project, standard = '') {
    try { await navigator.clipboard.writeText(handoff(project, standard)); setNotice({ message: `已复制「${project.name}」交接词` }); }
    catch { setHandoffProject(project); setNotice({ message: '未获得剪贴板权限，请在弹窗中手动复制。', error: true }); }
  }

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || form || handoffProject || currentId || event.isComposing) return;
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
  }, [visible, selected, form, handoffProject, currentId]);

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
  function startEdit(project: Project) {
    if (project.state !== 'ok' || busy) return;
    setEditing({ id: project.id, value: project.next, hash: project.hash, baseline: project.next }); setNotice(null);
  }
  async function saveNext(event: React.FormEvent) {
    event.preventDefault(); if (!editing || busy || editing.conflict) return;
    setBusy(true);
    try {
      accept(await api('PATCH', `/${editing.id}`, { next: editing.value, hash: editing.hash }));
      setEditing(null); setNotice({ message: '已保存' });
    } catch (error) {
      setNotice({ message: (error as Error).message, error: true });
      if (error instanceof RequestError && error.status === 409) setEditing({ ...editing, conflict: true });
    } finally { setBusy(false); }
  }
  async function reviewConflict() {
    const snapshot = await refresh();
    const project = snapshot?.projects.find(project => project.id === editing?.id);
    if (project?.state === 'ok' && editing) setEditing({ ...editing, hash: project.hash, baseline: project.next, conflict: false, reviewed: true });
  }
  async function remove(project: Project) {
    if (!data || busy) return;
    setBusy(true);
    try { accept(await api('DELETE', `/${project.id}`, { registryHash: data.registryHash })); location.hash = ''; setNotice({ message: '项目已移出看板' }); }
    catch (error) { setNotice({ message: (error as Error).message, error: true }); }
    finally { setBusy(false); }
  }

  function nextEditor(project: Project) {
    if (editing?.id === project.id) return <form className={styles.editForm} onSubmit={saveNext}>
      <input ref={editInput} aria-label={`${project.name}的下一步`} value={editing.value} maxLength={4000} disabled={busy} placeholder="下一步做什么" onChange={event => setEditing({ ...editing, value: event.target.value })} onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); setEditing(null); } if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
      <button className={styles.smallButton} disabled={busy || editing.conflict}>保存</button>
      <button type="button" className={styles.textButton} disabled={busy} onClick={() => setEditing(null)}>取消</button>
      {editing.conflict && <button type="button" className={styles.conflict} onClick={() => void reviewConflict()}>文件已变更，点击核对最新内容</button>}
      {editing.reviewed && <div className={styles.comparison}>最新内容：{editing.baseline || '（空）'}。已保留你的输入，确认后可直接保存。</div>}
    </form>;
    return <button className={`${styles.nextButton} ${!project.next ? styles.missing : ''}`} title={project.next || '点击填写下一步'} onClick={() => startEdit(project)} disabled={project.state !== 'ok'}>{project.next || '+ 填写下一步'}</button>;
  }

  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  return <div className={styles.app}>
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="#"><span className={styles.brandMark}><Icon name="island" /></span><span>案屿<small>ISLE</small></span></a>
      <div className={styles.navLabel}>工作空间</div>
      <a className={`${styles.navItem} ${!currentId ? styles.navActive : ''}`} href="#"><Icon name="island" />项目总览<span>{projects.length}</span></a>
      <div className={styles.sidebarBottom}><small>v0.1</small></div>
    </aside>
    <main className={styles.main}>
      <header className={styles.topbar}><span>{date}</span></header>
      {notice && <div className={`${styles.notice} ${notice.error ? styles.noticeError : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.message}</span><button aria-label="关闭提示" className={styles.iconButton} onClick={() => setNotice(null)}><Icon name="close" /></button></div>}
      {currentId ? <>
        <a className={styles.back} href="#">← 返回总览</a>
        {current ? <>
          <div className={styles.heading}><div><h1>{current.name}</h1><p className={styles.path}>{current.path}</p></div><button className={styles.primary} disabled={current.state !== 'ok'} onClick={() => { setCriteria(''); setHandoffProject(current); }}><Icon name="copy" />交接词</button></div>
          <section className={styles.contextCard} aria-label="项目下一步"><div className={styles.contextMeta}><span className={styles.status}>{current.status}</span><span>{freshness(current)}</span></div><p className={styles.fieldLabel}>下一步</p>{nextEditor(current)}</section>
          {current.error && <div className={styles.errorCard}><strong>{current.state === 'offline' ? '离线' : '读取失败'}</strong><p>{current.error}</p><button className={styles.secondary} onClick={() => openForm(current)}>重新指向</button>{current.preview && <pre>{current.preview}</pre>}</div>}
          {current.warnings.length > 0 && <details className={styles.warnings}><summary>{current.warnings.length} 条提示</summary><ul>{current.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
          {current.state === 'ok' && <div className={styles.taskGroups}>{(['待办', '进行中', '已完成'] as TaskState[]).map(state => <section className={styles.taskGroup} key={state}><h2><span className={`${styles.stateDot} ${state === '进行中' ? styles.green : ''}`} />{state}<small>{current.tasks.filter(task => task.state === state).length}</small></h2>{current.tasks.filter(task => task.state === state).map(task => <div key={task.line} className={`${styles.task} ${state === '已完成' ? styles.doneTask : ''}`}><span className={styles.checkbox} aria-label={state === '已完成' ? '已完成' : '未完成'}>{state === '已完成' ? '✓' : ''}</span><span>{task.title}</span>{task.tags.map(tag => <small className={styles.tag} key={tag}>{tag}</small>)}{task.conflict && <span title="复选框与分节不一致" className={styles.taskWarning}>!</span>}</div>)}{!current.tasks.some(task => task.state === state) && <p className={styles.noTasks}>暂无任务</p>}</section>)}</div>}
          <footer className={styles.projectFooter}><span>在 TASKS.md 中维护任务，保存后刷新</span><div><button className={styles.textButton} onClick={() => openForm(current)}>修改路径</button><button className={styles.textButton} disabled={busy} onClick={() => void remove(current)}>移出看板</button><button className={styles.secondary} disabled={loading} onClick={() => void refresh()}><Icon name="refresh" />刷新</button></div></footer>
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
              <div role="cell"><button className={`${styles.iconButton} ${styles.copyButton}`} disabled={project.state !== 'ok'} title="复制交接词 (c)" aria-label={`复制${project.name}的交接词`} onClick={() => void copy(project)}><Icon name="copy" /></button></div>
            </div>)}
            {!visible.length && <p className={styles.emptyText}>没有符合条件的项目。</p>}
          </div>
          {done.length > 0 && <button className={styles.doneToggle} onClick={() => setShowDone(!showDone)}>{showDone ? '▾' : '▸'} {done.length} 个已完成{showDone ? ' · 收起' : ' · 展开'}</button>}
          <footer className={styles.listFooter}><span /><div><kbd>j</kbd><kbd>k</kbd> 移动 <kbd>↵</kbd> 查看 <kbd>c</kbd> 复制交接词</div></footer>
        </>}
      </>}
    </main>
    {form && <Modal title={form === 'add' ? '添加项目' : '重新指向'} close={() => { if (!busy) setForm(null); }}><form onSubmit={register} className={styles.projectForm}><label>项目目录<input autoFocus required value={formPath} onChange={event => setFormPath(event.target.value)} placeholder={'D:\\work\\my-project'} disabled={busy} autoComplete="off" /></label><label>项目名称 <span>可选，留空使用目录名</span><input value={formName} maxLength={120} onChange={event => setFormName(event.target.value)} placeholder="例如：棱镜" disabled={busy} /></label>{formError && <p className={styles.formError} role="alert">{formError}</p>}<div className={styles.dialogActions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => setForm(null)}>取消</button><button className={styles.primary} disabled={busy}>{busy ? '正在保存…' : form === 'add' ? '添加项目' : '保存'}</button></div></form></Modal>}
    {handoffProject && <Modal title="复制交接词" close={() => setHandoffProject(null)}><div className={styles.projectForm}><p>发给 Agent 执行，做完后将自动写回 TASKS.md。</p><label>完成标准 <span>可选</span><input value={criteria} maxLength={800} onChange={event => setCriteria(event.target.value)} placeholder="例如：通过所有单元测试" /></label><textarea className={styles.handoff} aria-label="交接词预览" readOnly value={handoff(handoffProject, criteria)} onFocus={event => event.target.select()} /><div className={styles.dialogActions}><button className={styles.secondary} onClick={() => setHandoffProject(null)}>关闭</button><button className={styles.primary} onClick={() => void copy(handoffProject, criteria)}><Icon name="copy" />复制交接词</button></div></div></Modal>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
