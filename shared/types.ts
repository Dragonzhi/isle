export type TaskState = '待办' | '进行中' | '已完成';
export type Task = { title: string; tags: string[]; state: TaskState; line: number; conflict: boolean };
export type Project = {
  id: string;
  path: string;
  name: string;
  state: 'ok' | 'offline' | 'error';
  status: '进行中' | '暂停' | '已完成';
  next: string;
  updated: string;
  estimated: boolean;
  age: number;
  hash: string;
  tasks: Task[];
  warnings: string[];
  error?: string;
  preview?: string;
};
export type Snapshot = { projects: Project[]; warnings: string[]; registryHash: string };

export function handoff(project: Pick<Project, 'name' | 'path' | 'next'>, criteria = '') {
  const separator = project.path.includes('\\') ? '\\' : '/';
  const file = project.path.replace(/[\\/]$/, '') + separator + 'TASKS.md';
  return `项目：${project.name}
路径：${project.path}
续接提示：${project.next || '尚未填写，请先确认本次工作内容'}
完成标准：${criteria || '（未填写，请与用户确认）'}
收工：结束本次工作时，重新读取 ${file}，保留其中其他改动。
      按实际结果回写：只有已达到完成标准的对应任务才标记 [x] 并移到 ## 已完成；
      部分完成、阻塞或验证失败时，保留未完成状态并在 next 说明。
      将 next 更新为“停在哪里；下一步做什么”，updated 使用回写当天的本地日期（YYYY-MM-DD）。
      没有明确对应任务时，不猜测、不将其他任务标记完成；只更新续接提示和日期。
      缺少结果或下一步依据时询问用户；保留文件现有格式，避免覆盖其他人的修改。`;
}
