import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connect } from 'node:net';
import type { SmbConnectionRow } from './db.js';

const execFileAsync = promisify(execFile);

export interface Mountable {
  host: string;
  share: string;
  username: string;
  driveLetter?: string | null;
}

export function uncPath(c: Mountable): string {
  return `\\\\${c.host}\\${c.share}`;
}

/** Windows 資格情報マネージャーへ SMB 認証情報を登録する */
export async function registerCredential(
  host: string,
  username: string,
  password: string,
): Promise<void> {
  if (!host || !username || !password) return;
  await execFileAsync('cmdkey', [`/add:${host}`, `/user:${username}`, `/pass:${password}`]);
}

async function portReachable(host: string, port = 445, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function isMounted(target: string, driveLetter?: string | null): Promise<boolean> {
  try {
    const args = driveLetter ? ['use', driveLetter] : ['use'];
    const { stdout } = await execFileAsync('net', args);
    return stdout.includes(target);
  } catch {
    return false;
  }
}

/**
 * SMB 接続を確立し、ファイルアクセスに使うベースパスを返す。
 * ドライブレター指定時は `Z:\`、未指定時は UNC パス(`\\host\share\`)。
 */
export async function ensureMounted(conn: Mountable): Promise<string> {
  const target = uncPath(conn);
  const drive = conn.driveLetter?.replace(/\\$/, '') || null;

  if (await isMounted(target, drive)) {
    return drive ? `${drive}\\` : `${target}\\`;
  }

  if (!(await portReachable(conn.host))) {
    throw new Error(
      `SMB (${conn.host}:445) に到達できません。ホスト名/IP とネットワーク接続を確認してください。`,
    );
  }

  if (drive) {
    // 別の共有が割り当て済みの場合のみ解除して再マウント
    await execFileAsync('net', ['use', drive, '/delete', '/yes']).catch(() => undefined);
  }

  const args = drive ? ['use', drive, target] : ['use', target];
  args.push('/persistent:no');
  try {
    await execFileAsync('net', args);
  } catch (e) {
    throw new Error(`SMB 接続に失敗しました (${target}): ${(e as Error).message}`);
  }
  return drive ? `${drive}\\` : `${target}\\`;
}

export interface ConnectionTestResult {
  ok: boolean;
  basePath: string | null;
  message: string;
}

/** 接続テスト(到達確認 + マウント/セッション確立) */
export async function testConnection(conn: SmbConnectionRow): Promise<ConnectionTestResult> {
  try {
    const base = await ensureMounted({
      host: conn.host,
      share: conn.share,
      username: conn.username,
      driveLetter: conn.drive_letter,
    });
    return { ok: true, basePath: base, message: '接続できました' };
  } catch (e) {
    return { ok: false, basePath: null, message: (e as Error).message };
  }
}
