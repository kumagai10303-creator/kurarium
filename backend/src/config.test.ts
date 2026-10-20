import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  const writeIni = (content: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'bhv-test-'));
    const path = join(dir, 'config.ini');
    writeFileSync(path, content, 'utf-8');
    return path;
  };

  it('従来の ini をそのまま読み込める', () => {
    const path = writeIni(`
[smb]
host = 192.0.2.1
share = media
username = user
password = pass
drive_letter = Y:
auto_mount = false

[media]
image_folders = Pics\\a,Pics\\b
video_folders = Vid

[server]
port = 8080
`);
    const c = loadConfig(path);
    expect(c.smb.host).toBe('192.0.2.1');
    expect(c.smb.driveLetter).toBe('Y:');
    expect(c.smb.autoMount).toBe(false);
    expect(c.media.imageFolders).toEqual(['Pics\\a', 'Pics\\b']);
    expect(c.media.videoFolders).toEqual(['Vid']);
    expect(c.server.port).toBe(8080);
    rmSync(join(path, '..'), { recursive: true, force: true });
  });

  it('SMB/フォルダ未設定でも起動できる(ブートストラップ専用)', () => {
    const path = writeIni(`
[server]
port = 3100
`);
    const c = loadConfig(path);
    expect(c.server.port).toBe(3100);
    expect(c.smb.host).toBe('');
    expect(c.media.imageFolders).toEqual([]);
    rmSync(join(path, '..'), { recursive: true, force: true });
  });

  it('auto_mount は "true" 以外を false とみなす', () => {
    const path = writeIni(`
[smb]
host = h
share = s
username = u
password = p
auto_mount = true
`);
    const c = loadConfig(path);
    expect(c.smb.autoMount).toBe(true);
    rmSync(join(path, '..'), { recursive: true, force: true });
  });

  it('host とログイン認証の設定を読み込む', () => {
    const path = writeIni(`
[server]
port = 3000
host = 0.0.0.0
basic_auth_user = user
basic_auth_password = secret
`);
    const c = loadConfig(path);
    expect(c.server.host).toBe('0.0.0.0');
    expect(c.server.basicAuthUser).toBe('user');
    expect(c.server.basicAuthPasswordHash.startsWith('scrypt$')).toBe(true);
    rmSync(join(path, '..'), { recursive: true, force: true });
  });
  it('不正ポートはエラー', () => {
    const path = writeIni(`
[server]
port = 99999
`);
    expect(() => loadConfig(path)).toThrow(/port/);
  });

  it('ファイルが無い場合は既定値で起動する(初回セットアップ)', () => {
    const c = loadConfig(join(tmpdir(), 'no-such-config.ini'));
    expect(c.server.port).toBe(3000);
    expect(c.smb.host).toBe('');
    expect(c.media.imageFolders).toEqual([]);
  });
});
