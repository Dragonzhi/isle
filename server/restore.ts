import * as fs from 'node:fs/promises';
import path from 'node:path';
import { decodeBackup, noLinks } from './store.ts';

const directory = process.argv[2];
const output = process.argv[3];
if (!directory || !output) {
  console.error('用法：npm run restore -- "项目绝对路径" "另存文件的绝对路径"\n只导出备份，不覆盖 TASKS.md；输出文件必须尚不存在。');
  process.exitCode = 1;
} else {
  try {
    const target = path.join(path.resolve(directory), 'TASKS.md');
    await noLinks(target + '.bak');
    await noLinks(path.resolve(output));
    const content = decodeBackup(await fs.readFile(target + '.bak'), target);
    await fs.writeFile(path.resolve(output), content, { flag: 'wx', mode: 0o600 });
    console.log(`备份已导出到：${path.resolve(output)}`);
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
