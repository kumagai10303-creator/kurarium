import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureLanCertificate,
  getLanCertificateInfo,
  readCertificateForDownload,
  regenerateLanCertificate,
  tlsDir,
} from './tls.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kurarium-tls-'));
  process.env.MEDIAVIEWER_DATA_DIR = join(root, 'data');
});

afterEach(() => {
  delete process.env.MEDIAVIEWER_DATA_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe('LAN TLS certificate', () => {
  it('初回生成し、localhostとループバックIPを含める', async () => {
    const cert = await ensureLanCertificate();
    const parsed = new X509Certificate(cert.cert);
    expect(parsed.subjectAltName).toContain('DNS:localhost');
    expect(parsed.subjectAltName).toContain('IP Address:127.0.0.1');
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now());
    expect(cert.fingerprint256).toBe(parsed.fingerprint256);
    expect(cert.coversCurrentAddresses).toBe(true);
    const download = await readCertificateForDownload();
    expect(download).not.toBeNull();
    expect(new X509Certificate(download!).fingerprint256).toBe(cert.fingerprint256);
  });

  it('既存の有効な証明書を再利用する', async () => {
    const first = await ensureLanCertificate();
    const second = await ensureLanCertificate();
    expect(second.fingerprint256).toBe(first.fingerprint256);
  });

  it('再生成するとフィンガープリントが変わる', async () => {
    const first = await ensureLanCertificate();
    const second = await regenerateLanCertificate();
    expect(second.fingerprint256).not.toBe(first.fingerprint256);
  });

  it('証明書とメタデータが一致しない場合は再生成する', async () => {
    const first = await ensureLanCertificate();
    const metaPath = join(tlsDir(), 'server.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      fingerprint256: string;
      [key: string]: unknown;
    };
    meta.fingerprint256 = '00:00';
    writeFileSync(metaPath, JSON.stringify(meta), 'utf8');

    expect(await getLanCertificateInfo()).toBeNull();
    const renewed = await ensureLanCertificate();
    expect(renewed.fingerprint256).not.toBe(first.fingerprint256);
    expect(renewed.validTo).toBeGreaterThan(Date.now());
  });
});
