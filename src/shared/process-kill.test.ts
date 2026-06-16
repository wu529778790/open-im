import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { destroyAllLiveChildren, killProcessTree, trackChild } from './process-kill.js';

// 一个会一直存活、直到被杀才退出的 node 子进程
const spawnPersistentChild = () =>
  spawn(process.execPath, ['-e', 'setInterval(()=>{},10000)'], {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  });

const waitForExit = (child: { once: (e: string, cb: () => void) => void }) =>
  new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve());
    const t = setTimeout(() => reject(new Error('子进程未在超时内退出')), 5000);
    t.unref();
  });

describe('process-kill', () => {
  afterEach(() => {
    // 测试失败时兜底清理，避免遗留进程
    destroyAllLiveChildren();
  });

  it('killProcessTree 终止被追踪的子进程', async () => {
    const child = trackChild(spawnPersistentChild());
    await new Promise((r) => setTimeout(r, 150)); // 让进程启动

    const exit = waitForExit(child);
    killProcessTree(child, { force: true });
    await expect(exit).resolves.toBeUndefined();
  });

  it('destroyAllLiveChildren 强制终止所有被追踪子进程', async () => {
    const children = [1, 2].map(() => trackChild(spawnPersistentChild()));
    await new Promise((r) => setTimeout(r, 150));

    const exits = children.map((c) => waitForExit(c));
    destroyAllLiveChildren();
    await expect(Promise.all(exits)).resolves.toHaveLength(2);
  });
});
