export type TaskState = '待办' | '进行中' | '已完成';
export type Task = { title: string; tags: string[]; state: TaskState; line: number; conflict: boolean };
export type Project = {
  id: string;
  path: string;
  name: string;
  state: 'ok' | 'offline' | 'error';
  status: '进行中' | '暂停' | '已完成';
  next: string;
  summary: string;
  history: string;
  updated: string;
  estimated: boolean;
  age: number;
  hash: string;
  tasks: Task[];
  warnings: string[];
  error?: string;
  preview?: string;
};
export type Snapshot = { projects: Project[]; warnings: string[]; registryHash: string; agents: string[]; settingsHash: string | null };

export function focusTask(tasks?: Task[]): Task | undefined {
  if (!tasks || !tasks.length) return undefined;
  return tasks.find(task => task.state === '进行中') ?? tasks.find(task => task.state === '待办');
}

type TransferProject = Pick<Project, 'name' | 'path' | 'next'> & { tasks?: Task[]; summary?: string };

function tasksFile(project: TransferProject) {
  const separator = project.path.includes('\\') ? '\\' : '/';
  return project.path.replace(/[\\/]$/, '') + separator + 'TASKS.md';
}

function writeback(project: TransferProject, author: string) {
  return `重新读取 ${tasksFile(project)}，保留其他改动；只在这份 TASKS.md 中整理交接记录。
按下面顺序回写，任务清单和交接摘要必须分别维护，交接摘要不能替代任务清单：
二级分节标题固定为“## 待办”“## 进行中”“## 已完成”“## 交接摘要”“## 工作留痕”，不要给标题追加日期、署名或其他说明；日期写入 updated 或工作留痕正文。若已有带日期后缀的摘要或留痕分节，继续维护原分节，不另建同名分节；遇到多份摘要先询问用户如何合并，不按标题日期自动丢弃旧内容。

一、先维护 ## 待办、## 进行中、## 已完成（缺少对应分节时才补上）。逐项核对本次实际涉及的任务：
- 已明确需要做、但尚未开始的具体行动项，放入 ## 待办，使用 - [ ]。
- 已开始但未达到完成标准的任务，放入 ## 进行中，使用 - [ ]；部分完成、阻塞或验证失败时保留未完成状态，不能只在摘要中说明却不维护任务。
- 只有本次实际达到完成标准的对应任务才标记 [x] 并移到 ## 已完成。
- 本次实际处理过的工作如果原来没有任务条目，应按实际结果补入对应分节；明确留下的下一个行动项也应列入待办，已有相同任务则更新原条目，不重复新增。
- 保留已有任务标题、标签和无关条目；状态变化时移动原任务，不在多个分节复制同一条任务。不为填满列表而编造任务，纯讨论且没有新增行动项时可以保持任务清单不变，并说明原因。

二、再在 ## 交接摘要 中合并本次结果和仍有效的旧信息（没有该分节则新增）。摘要补充任务背后的结论和验证依据，不替代上面的行动项。写成简短正文或列表，可用 ### 小标题，包含：
- 已确认：实际完成的变更、关键结论和必要的相对文件路径。
- 验证：实际执行过的命令及结果；没有验证的明确写“未验证”。
- 未完成或阻塞：尚未解决的问题、失败尝试以及接手时需要避开的坑。
- 接着做：下一位 Agent 可以开始的第一个具体动作。
不编造验证结果，不把尝试当成结论，不倾倒完整聊天记录。

三、在 ## 工作留痕 末尾追加本次贡献（没有该分节则新增），保留全部历史记录，不用最新摘要覆盖历史。${author ? `本次署名使用“${author}”（由用户选择）。` : '本次署名尚未指定，请向用户确认署名后再追加；不要猜测具体模型名称。'}
格式：- YYYY-MM-DD · 署名：本次实际推进了什么；对应任务是否完成；实际验证结果或“未验证”。日期使用回写当天的本地日期。只记录本次已发生的贡献，部分推进也记录，不要求任务完成才留痕；纯讨论如实写结论，不冒充代码改动。相同一轮收工不要重复追加，无新贡献时说明原因。任务末尾的 @标签只表示原计划交给谁，不能作为实际作者依据；不得替其他 Agent 补签过去的工作。

四、将 next 更新为“停在哪里；下一步做什么”，updated 使用回写当天的本地日期（YYYY-MM-DD）。不凭任务列表首项猜测本次完成了哪条任务；不清空无关任务或仍有效的交接信息。缺少关键依据时询问用户。
保留文件原有编码、换行和无关内容。保存前再次核对文件未被外部修改；有冲突先停下，不覆盖其他改动。
保存后重新读取，确认任务状态、摘要与本次留痕一致。回复中分别说明任务清单如何更新（或为何无需变更）、摘要和留痕记录了什么，以及下一步；不能只更新摘要就宣告收工回写完成。回复末尾使用同一署名；尚未确认署名时先询问，不伪造身份。`;
}

export function closeout(project: TransferProject, author = '') {
  return `项目：${project.name}
路径：${project.path}
现在准备收工或切换 Agent。请停止新增工作，只整理本次会话已经发生的结果并回写项目记录。不要为补齐结果而继续实现、补跑未执行的验证或提交代码。

${writeback(project, author)}

回写后用几句话说明本次已确认的进展、仍未验证的内容，以及下一位 Agent 从哪里继续。如果无法写文件，请在回复中给出任务清单应做的具体改动，以及可直接粘贴到“交接摘要”和“工作留痕”的内容，不声称已经写回。`;
}

export function handoff(project: TransferProject, criteria = '', goal = '', author = '') {
  const file = tasksFile(project);
  const focus = focusTask(project.tasks);
  const focusLine = focus ? `当前任务：${focus.title}${focus.tags.length ? ' ' + focus.tags.join(' ') : ''}（列表参考，不代表本次已选择）\n` : '';
  return `项目：${project.name}
路径：${project.path}
${focusLine}续接提示：${project.next || '尚未填写，请先确认本次工作内容'}
本次目标：${goal.trim() || '根据续接提示接着做；若只有等待事项或目标不明确，先与用户确认。'}
完成标准：${criteria || '（未填写，请与用户确认）'}

上次交接摘要（复制时的记录）：
${project.summary || '尚无摘要。先读取任务文件并核对实际进展，不假设已有修改已经验证。'}

开工：先读取 ${file} 的完整内容，包括任务列表与交接摘要，再核对相关工程的实际状态。不要依赖上一家 Agent 的聊天记录；文件若与以上快照不同，以刚读到的文件为准。已有结论可作为线索，未验证的内容仍需核实。本次目标优先，不能把参考任务自动当作已授权的工作。

收工：工作结束或用户要求交接时，按以下约定回写：
${writeback(project, author)}`;
}
