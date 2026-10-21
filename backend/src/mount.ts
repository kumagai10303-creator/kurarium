import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connect } from 'node:net';
import { Client } from 'node-smb2';
import type { SmbConnectionRow } from './db.js';
import { registerWindowsCredential } from './credentials.js';

const execFileAsync = promisify(execFile);

export interface Mountable {
  host: string;
  share: string;
  username: string;
  driveLetter?: string | null;
}

export function uncPath(c: Pick<Mountable, 'host' | 'share'>): string {
  return `\\\\${c.host}\\${c.share}`;
}

/** Windows 資格情報マネージャーへ SMB 認証情報を登録する */
export async function registerCredential(
  host: string,
  username: string,
  password: string,
): Promise<void> {
  if (!host || !username || !password) return;
  await registerWindowsCredential(host, username, password);
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

export interface SmbTestInput {
  host: string;
  share: string;
  username: string;
  password: string;
}

function splitUsername(raw: string): { domain: string; username: string } {
  const slash = raw.indexOf('\\');
  if (slash > 0) return { domain: raw.slice(0, slash), username: raw.slice(slash + 1) };
  const at = raw.indexOf('@');
  if (at > 0) return { domain: raw.slice(at + 1), username: raw.slice(0, at) };
  return { domain: '', username: raw };
}

/** 保存前の資格情報でSMB2認証・共有アクセスを確認する(Windows資格情報は変更しない) */
export async function testConnectionInput(input: SmbTestInput): Promise<ConnectionTestResult> {
  const host = input.host.trim();
  const share = input.share.trim();
  const username = input.username.trim();
  if (!host || !share || !username) {
    return { ok: false, basePath: null, message: 'ホスト・共有名・ユーザー名を入力してください' };
  }
  const { domain, username: user } = splitUsername(username);
  let client: Client | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    client = new Client(host, { connectTimeout: 10000, requestTimeout: 10000 });
    const run = async (): Promise<void> => {
      const session = await client!.authenticate({
        domain,
        username: user,
        password: input.password,
        forceNtlmVersion: 'v2',
      });
      await session.connectTree(share);
    };
    await Promise.race([
      run(),
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error('接続がタイムアウトしました')), 10000);
      }),
    ]);
    return { ok: true, basePath: null, message: '接続できます' };
  } catch (e) {
    const message = (e as Error).message || '接続できません';
    return { ok: false, basePath: null, message };
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await client?.close();
    } catch {
      // ignore
    }
  }
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
