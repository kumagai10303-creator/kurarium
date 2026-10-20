import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './password.js';

type IniData = Record<string, Record<string, string>>;

/**
 * 簡易 ini パーサー(Node.js の `ini` パッケージは
 * `\a` `\b` 等をエスケープ処理してしまい Windows パスと相性が悪いため自前実装)
 * - セクション: [name]
 * - キー=値: key = value
 * - コメント: ; または # で始まる行
 * - バックスラッシュはそのまま値に含める(エスケープ処理なし)
 */
export function parseIni(text: string): IniData {
  const result: IniData = {};
  let section = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sectionMatch = /^\[(.+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      result[section] ??= {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
    result[section] ??= {};
    result[section][key] = value;
  }
  return result;
}

export interface SmbConfig {
  host: string;
  share: string;
  username: string;
  password: string;
  driveLetter: string;
  autoMount: boolean;
}

export interface MediaConfig {
  imageFolders: string[];
  videoFolders: string[];
  pdfFolders: string[];
  musicFolders: string[];
}

export interface ServerConfig {
  port: number;
  host: string;
  basicAuthUser: string;
  /** scrypt ハッシュ。平文パスワードは保持しない */
  basicAuthPasswordHash: string;
}

export interface TagRule {
  match: string;
  tag: string;
}

export interface TagsConfig {
  rules: TagRule[];
}

export interface AppConfig {
  smb: SmbConfig;
  media: MediaConfig;
  server: ServerConfig;
  tags: TagsConfig;
}

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function dataRoot(): string {
  return process.env.MEDIAVIEWER_DATA_DIR ?? join(projectRoot, 'data');
}

/** ユーザーに見えない場所に置く設定ファイル(UI管理・秘匿情報はハッシュ) */
export function configIniPath(): string {
  return join(dataRoot(), '.system', 'config.ini');
}

/** 旧バージョンの設定ファイル(移行元) */
export function legacyConfigIniPath(): string {
  return join(projectRoot, 'config.ini');
}

function resolveConfigPath(): string {
  if (existsSync(configIniPath())) return configIniPath();
  if (existsSync(legacyConfigIniPath())) return legacyConfigIniPath();
  return configIniPath();
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function mediaBasePath(config: AppConfig): string {
  return config.smb.driveLetter + '\\';
}

export function absMediaPath(config: AppConfig, folder: string): string {
  return join(mediaBasePath(config), folder);
}

const DEFAULT_SERVER: ServerConfig = {
  port: 3000,
  host: '127.0.0.1',
  basicAuthUser: '',
  basicAuthPasswordHash: '',
};

function defaultConfig(): AppConfig {
  return {
    smb: {
      host: '',
      share: '',
      username: '',
      password: '',
      driveLetter: 'Z:',
      autoMount: false,
    },
    media: {
      imageFolders: [],
      videoFolders: [],
      pdfFolders: [],
      musicFolders: [],
    },
    server: { ...DEFAULT_SERVER },
    tags: { rules: [] },
  };
}

export function loadConfig(path: string = resolveConfigPath()): AppConfig {
  if (!existsSync(path)) {
    return defaultConfig();
  }

  const raw = parseIni(readFileSync(path, 'utf-8'));
  const errors: string[] = [];

  const smb: SmbConfig = {
    host: raw.smb?.host ?? '',
    share: raw.smb?.share ?? '',
    username: raw.smb?.username ?? '',
    password: raw.smb?.password ?? '',
    driveLetter: (raw.smb?.drive_letter ?? 'Z:').replace(/\\$/, ''),
    autoMount: String(raw.smb?.auto_mount ?? 'true').toLowerCase() === 'true',
  };

  const media: MediaConfig = {
    imageFolders: splitList(raw.media?.image_folders),
    videoFolders: splitList(raw.media?.video_folders),
    pdfFolders: splitList(raw.media?.pdf_folders),
    musicFolders: splitList(raw.media?.music_folders),
  };

  const port = Number(raw.server?.port ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('[server] port は 1〜65535 の整数で指定してください');
  }

  // 旧設定の平文パスワードは起動時にハッシュへ変換する(ディスクには書かない)
  const legacyPassword = raw.server?.basic_auth_password ?? '';
  const passwordHash =
    raw.server?.basic_auth_password_hash ??
    (legacyPassword ? hashPassword(legacyPassword) : '');

  const tags: TagsConfig = {
    rules: splitList(raw.tags?.rules)
      .map((r) => {
        const idx = r.indexOf('=>');
        if (idx <= 0) return null;
        const match = r.slice(0, idx).trim();
        const tag = r.slice(idx + 2).trim();
        return match && tag ? { match, tag } : null;
      })
      .filter((r): r is TagRule => r !== null),
  };

  if (errors.length > 0) {
    throw new Error(`設定に問題があります:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    smb,
    media,
    server: {
      port,
      host: raw.server?.host?.trim() || '127.0.0.1',
      basicAuthUser: raw.server?.basic_auth_user ?? '',
      basicAuthPasswordHash: passwordHash,
    },
    tags,
  };
}

/** サーバー設定を隠しディレクトリへ保存する(UIから呼び出す) */
export function writeServerConfig(server: ServerConfig): void {
  const dir = dirname(configIniPath());
  mkdirSync(dir, { recursive: true });
  const body = [
    '; Kurarium のサーバー設定(Web UI から自動生成)',
    '; 手動編集は不要です。パスワードはハッシュのみ保存されます。',
    '[server]',
    `port = ${server.port}`,
    `host = ${server.host}`,
    `basic_auth_user = ${server.basicAuthUser}`,
    `basic_auth_password_hash = ${server.basicAuthPasswordHash}`,
    '',
  ].join('\r\n');
  writeFileSync(configIniPath(), body, 'utf-8');
  if (process.platform === 'win32') {
    execFile('attrib', ['+h', dir], () => undefined);
  }
}

/**
 * 旧設定ファイルを隠しディレクトリへ移行する。
 * 平文パスワード行は除去し、新しい設定ファイルを作成する。
 */
export function migrateLegacyConfigFile(server: ServerConfig): void {
  const legacy = legacyConfigIniPath();
  if (!existsSync(legacy)) return;

  if (!existsSync(configIniPath())) {
    writeServerConfig(server);
  }

  const sanitized = readFileSync(legacy, 'utf-8')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(basic_auth_password|password)\s*=/.test(line))
    .join('\r\n');
  const dir = dirname(configIniPath());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'legacy-config.ini'), sanitized, 'utf-8');
  unlinkSync(legacy);
  if (process.platform === 'win32') {
    execFile('attrib', ['+h', dir], () => undefined);
  }
}
