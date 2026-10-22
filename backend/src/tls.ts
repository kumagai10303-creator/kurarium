import { X509Certificate } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { networkInterfaces, hostname } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { dataDir } from './db.js';

const CERT_FILE = 'server.pem';
const KEY_FILE = 'server-key.pem';
const META_FILE = 'server.json';
const CERT_DOWNLOAD_FILE = 'kurarium-lan.cer';
const VALIDITY_DAYS = 365;

export interface CertificateAddresses {
  dns: string[];
  ips: string[];
}

export interface LanCertificateInfo {
  fingerprint256: string;
  validFrom: number;
  validTo: number;
  sans: string[];
  coversCurrentAddresses: boolean;
}

export interface LanCertificate extends LanCertificateInfo {
  key: string;
  cert: string;
  certPath: string;
}

interface CertificateMeta {
  fingerprint256: string;
  validFrom: number;
  validTo: number;
  sans: string[];
  createdAt: number;
}

export function tlsDir(): string {
  return join(dataDir(), '.system', 'tls');
}

function certPath(): string {
  return join(tlsDir(), CERT_FILE);
}

function keyPath(): string {
  return join(tlsDir(), KEY_FILE);
}

function metaPath(): string {
  return join(tlsDir(), META_FILE);
}

function downloadPath(): string {
  return join(tlsDir(), CERT_DOWNLOAD_FILE);
}

export function currentAddresses(): CertificateAddresses {
  const dns = new Set(['localhost']);
  const machineName = hostname().trim();
  if (machineName) dns.add(machineName);
  const ips = new Set(['127.0.0.1', '::1']);

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.internal) continue;
      if (address.family === 'IPv4' || address.family === 'IPv6') {
        ips.add(address.address);
      }
    }
  }

  return { dns: [...dns], ips: [...ips] };
}

function sanLabels(addresses: CertificateAddresses): string[] {
  return [
    ...addresses.dns.map((value) => `DNS:${value.toLowerCase()}`),
    ...addresses.ips.map((value) => `IP:${value.toLowerCase()}`),
  ];
}

function normalizeSan(value: string): string {
  if (value.startsWith('DNS:')) return `dns:${value.slice(4).toLowerCase()}`;
  if (value.startsWith('IP:')) return `ip:${value.slice(3).toLowerCase()}`;
  return value.toLowerCase();
}

function coversCurrentAddresses(sans: string[]): boolean {
  const stored = new Set(sans.map(normalizeSan));
  const current = currentAddresses();
  return (
    current.dns.every((value) => stored.has(`dns:${value.toLowerCase()}`)) &&
    current.ips.every((value) => stored.has(`ip:${value.toLowerCase()}`))
  );
}

function parseCertificate(cert: string): X509Certificate {
  return new X509Certificate(cert);
}

function certificateInfo(meta: CertificateMeta, cert: string): LanCertificateInfo {
  const parsed = parseCertificate(cert);
  return {
    fingerprint256: parsed.fingerprint256,
    validFrom: Date.parse(parsed.validFrom),
    validTo: Date.parse(parsed.validTo),
    sans: meta.sans,
    coversCurrentAddresses: coversCurrentAddresses(meta.sans),
  };
}

async function readExisting(): Promise<LanCertificate | null> {
  try {
    const [key, cert, rawMeta] = await Promise.all([
      readFile(keyPath(), 'utf8'),
      readFile(certPath(), 'utf8'),
      readFile(metaPath(), 'utf8'),
    ]);
    const meta = JSON.parse(rawMeta) as CertificateMeta;
    if (
      typeof meta.fingerprint256 !== 'string' ||
      !Number.isFinite(meta.validFrom) ||
      !Number.isFinite(meta.validTo) ||
      !Array.isArray(meta.sans)
    ) {
      return null;
    }
    const parsed = parseCertificate(cert);
    if (parsed.fingerprint256 !== meta.fingerprint256) return null;
    const now = Date.now();
    const validFrom = Date.parse(parsed.validFrom);
    const validTo = Date.parse(parsed.validTo);
    if (!(validFrom <= now && validTo > now)) return null;
    return {
      key,
      cert,
      certPath: certPath(),
      ...certificateInfo(meta, cert),
    };
  } catch {
    return null;
  }
}

async function writeAtomic(path: string, content: string, mode?: number): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, { encoding: 'utf8', mode });
  await rename(tmp, path);
}

async function generateCertificate(): Promise<LanCertificate> {
  const addresses = currentAddresses();
  const now = Date.now();
  const pems = await generate(
    [{ name: 'commonName', value: 'Kurarium LAN' }],
    {
      keyType: 'rsa',
      keySize: 2048,
      algorithm: 'sha256',
      notBeforeDate: new Date(now - 5 * 60 * 1000),
      notAfterDate: new Date(now + VALIDITY_DAYS * 24 * 60 * 60 * 1000),
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            ...addresses.dns.map((value) => ({ type: 2 as const, value })),
            ...addresses.ips.map((value) => ({ type: 7 as const, ip: value })),
          ],
        },
      ],
    },
  );

  const parsed = parseCertificate(pems.cert);
  const meta: CertificateMeta = {
    fingerprint256: parsed.fingerprint256,
    validFrom: Date.parse(parsed.validFrom),
    validTo: Date.parse(parsed.validTo),
    sans: sanLabels(addresses),
    createdAt: now,
  };

  await mkdir(tlsDir(), { recursive: true });
  await writeAtomic(keyPath(), pems.private, 0o600);
  await writeAtomic(certPath(), pems.cert, 0o644);
  await writeAtomic(metaPath(), JSON.stringify(meta, null, 2), 0o600);
  await writeFile(downloadPath(), parsed.raw, { mode: 0o644 });
  await chmod(keyPath(), 0o600).catch(() => undefined);
  await chmod(metaPath(), 0o600).catch(() => undefined);

  return {
    key: pems.private,
    cert: pems.cert,
    certPath: certPath(),
    ...certificateInfo(meta, pems.cert),
  };
}

export async function ensureLanCertificate(): Promise<LanCertificate> {
  const existing = await readExisting();
  if (existing) return existing;
  return generateCertificate();
}

export async function regenerateLanCertificate(): Promise<LanCertificate> {
  return generateCertificate();
}

export async function getLanCertificateInfo(): Promise<LanCertificateInfo | null> {
  const existing = await readExisting();
  if (!existing) return null;
  return {
    fingerprint256: existing.fingerprint256,
    validFrom: existing.validFrom,
    validTo: existing.validTo,
    sans: existing.sans,
    coversCurrentAddresses: existing.coversCurrentAddresses,
  };
}

export async function readCertificateForDownload(): Promise<Buffer | null> {
  try {
    return await readFile(downloadPath());
  } catch {
    try {
      const cert = await readFile(certPath(), 'utf8');
      return parseCertificate(cert).raw;
    } catch {
      return null;
    }
  }
}
