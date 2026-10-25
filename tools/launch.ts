import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../server/main.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtPage = path.join(root, 'dist', 'index.html');
// 构建输入：任何一项比 dist/index.html 新，页面就可能过时。
const sourceEntries = ['src', 'shared', 'public', 'index.html', 'vite.config.ts', 'package.json'];

function latestChange(target: string): number {
  try {
    const stats = statSync(target);
    if (!stats.isDirectory()) return stats.mtimeMs;
    return readdirSync(target).reduce((latest, name) => Math.max(latest, latestChange(path.join(target, name))), stats.mtimeMs);
  } catch {
    return 0;
  }
}

function build(): boolean {
  console.log('正在构建页面（npm run build）…');
  const result = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
}

export function browserInvocation(url: string, platform: NodeJS.Platform = process.platform) {
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/c', 'start', '""', `"${url}"`], verbatim: true };
  if (platform === 'darwin') return { command: 'open', args: [url], verbatim: false };
  return { command: 'xdg-open', args: [url], verbatim: false };
}

function openBrowser(url: string) {
  const manual = () => console.log(`未能自动打开浏览器，请手动访问：\n  ${url}\n`);
  try {
    const { command, args, verbatim } = browserInvocation(url);
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim });
    child.on('error', manual);
    child.unref();
  } catch {
    manual();
  }
}

async function run(): Promise<void> {
  const changed = Math.max(...sourceEntries.map(entry => latestChange(path.join(root, entry))));
  const built = latestChange(builtPage);
  if (changed > built) {
    console.log(built ? '源码比上次构建新，先重建页面…' : '首次启动，先构建页面…');
    if (!build()) {
      // 旧的 dist 仍可用，不让构建失败挡住看板；完全没有页面时才中止。
      if (!built) throw new Error('构建失败，尚无可用页面。请先修复上方的类型或打包错误。');
      console.log('构建失败，继续使用上一次的构建结果。');
    }
  }
  const url = await main();
  if (process.argv.includes('--open')) openBrowser(url);
}

const entry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (entry) {
  run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
