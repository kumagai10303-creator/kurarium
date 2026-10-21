import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$reader = [System.IO.StreamReader]::new(
    [Console]::OpenStandardInput(),
    [System.Text.Encoding]::UTF8,
    $true
)
$payload = $reader.ReadToEnd() | ConvertFrom-Json
$source = @"
using System;
using System.Runtime.InteropServices;

public static class KurariumCredential
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    private const uint CRED_TYPE_DOMAIN_PASSWORD = 2;
    private const uint CRED_PERSIST_LOCAL_MACHINE = 2;

    public static void Write(string target, string userName, string password)
    {
        byte[] blob = System.Text.Encoding.Unicode.GetBytes(password);
        IntPtr blobPtr = Marshal.AllocCoTaskMem(blob.Length);
        try
        {
            Marshal.Copy(blob, 0, blobPtr, blob.Length);
            CREDENTIAL credential = new CREDENTIAL
            {
                Type = CRED_TYPE_DOMAIN_PASSWORD,
                TargetName = target,
                CredentialBlobSize = (uint)blob.Length,
                CredentialBlob = blobPtr,
                Persist = CRED_PERSIST_LOCAL_MACHINE,
                UserName = userName,
            };
            if (!CredWrite(ref credential, 0))
            {
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
        }
        finally
        {
            Marshal.FreeCoTaskMem(blobPtr);
        }
    }
}
"@
Add-Type -TypeDefinition $source -Language CSharp
[KurariumCredential]::Write([string]$payload.host, [string]$payload.username, [string]$payload.password)
`;

function runPowerShell(scriptPath: string, input: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true },
    );
    let stderr = '';
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('資格情報の登録がタイムアウトしました'));
    }, 15_000);
    timer.unref?.();
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (code === 0) finish();
      else finish(new Error(`資格情報の登録に失敗しました: ${stderr.trim() || `exit ${code}`}`));
    });
    child.stdin.once('error', (error) => finish(error));
    child.stdin.end(input, 'utf8');
  });
}

/**
 * Windows 資格情報マネージャーへ SMB 資格情報を登録する。
 * パスワードは cmdkey の引数ではなく、PowerShell の標準入力から渡す。
 */
export async function registerWindowsCredential(
  host: string,
  username: string,
  password: string,
): Promise<void> {
  if (!host || !username || !password) return;
  const dir = await mkdtemp(join(tmpdir(), 'kurarium-credential-'));
  const scriptPath = join(dir, 'register.ps1');
  try {
    await writeFile(scriptPath, POWERSHELL_SCRIPT, 'utf8');
    await runPowerShell(
      scriptPath,
      JSON.stringify({ host, username, password }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
