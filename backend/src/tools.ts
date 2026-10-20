import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

const children = new Set<ChildProcess>();
let shuttingDown = false;

export function spawnTool(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  if (shuttingDown) throw new Error('shutdown_in_progress');
  const child = spawn(command, args, { windowsHide: true, ...options });
  children.add(child);
  const forget = (): void => {
    children.delete(child);
  };
  child.once('close', forget);
  child.once('error', forget);
  return child;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function beginShutdown(): void {
  shuttingDown = true;
}

export async function killToolProcesses(): Promise<void> {
  beginShutdown();
  const pending = [...children];
  for (const child of pending) {
    if (child.pid === undefined) continue;
    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.once('close', () => resolve());
        killer.once('error', () => resolve());
      });
    } else {
      child.kill('SIGKILL');
    }
  }
  children.clear();
}
