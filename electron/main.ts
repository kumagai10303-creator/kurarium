import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
  type OpenDialogOptions,
} from 'electron';
import { X509Certificate } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

interface ServerHandle {
  host: string;
  port: number;
  protocol: 'http' | 'https';
  tls?: { fingerprint256: string };
  stop: () => Promise<void>;
}

interface KurariumServerModule {
  startServer: (options?: { port?: number }) => Promise<ServerHandle>;
}

app.setName('Kurarium');
const APP_USER_MODEL_ID = 'com.kurarium.app';
app.setAppUserModelId(APP_USER_MODEL_ID);
const repoRoot = join(__dirname, '..', '..');
const exeDir = join(app.getPath('exe'), '..');
const portableMarker = join(exeDir, 'portable.txt');
const requestedHidden = process.argv.includes('--hidden');

let tray: Tray | null = null;
let window: BrowserWindow | null = null;
let server: ServerHandle | null = null;
let quitting = false;
let hideNotificationShown = false;
let portable = false;
let dataRoot = '';
let logStream: ReturnType<typeof createWriteStream> | null = null;

function isWritable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, '.write-test');
    writeFileSync(probe, '');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function resolvePaths(): void {
  if (!app.isPackaged) {
    dataRoot = process.env.MEDIAVIEWER_DATA_DIR ?? join(repoRoot, 'data');
    portable = false;
    return;
  }

  const portableWanted = existsSync(portableMarker);
  if (portableWanted) {
    portable = true;
    const portableData = join(exeDir, 'data');
    if (isWritable(portableData)) {
      dataRoot = portableData;
      app.setPath('userData', portableData);
      return;
    }
  }

  const base = process.env.LOCALAPPDATA ?? app.getPath('appData');
  const userData = join(base, 'Kurarium');
  dataRoot = join(userData, 'data');
  app.setPath('userData', userData);
  mkdirSync(dataRoot, { recursive: true });
}

function setupLogging(): void {
  const logDir = join(dataRoot, 'logs');
  mkdirSync(logDir, { recursive: true });
  logStream = createWriteStream(join(logDir, 'app.log'), { flags: 'a' });
  const write = (level: string, args: unknown[]): void => {
    const text = args
      .map((value) => {
        if (value instanceof Error) return value.stack ?? value.message;
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      })
      .join(' ');
    logStream?.write(`${new Date().toISOString()} [${level}] ${text}\n`);
  };
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.log = (...args: unknown[]) => {
    originalLog(...args);
    write('info', args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    write('warn', args);
  };
  console.error = (...args: unknown[]) => {
    originalError(...args);
    write('error', args);
  };
}

function assetPath(name: string): string {
  if (app.isPackaged) return join(process.resourcesPath, 'assets', name);
  return join(repoRoot, 'build', name);
}

function localUrl(): string {
  const host = (server?.host ?? '127.0.0.1').trim();
  let target = host;
  if (!host || host === '0.0.0.0') target = '127.0.0.1';
  else if (host === '::' || host === '[::]') target = '[::1]';
  else if (host.includes(':') && !host.startsWith('[')) target = `[${host}]`;
  const protocol = server?.protocol ?? 'http';
  return `${protocol}://${target}:${server?.port ?? 3000}`;
}

function sameFingerprint(certificatePem: string): boolean {
  const expected = server?.tls?.fingerprint256;
  if (!expected) return false;
  try {
    const actual = new X509Certificate(certificatePem).fingerprint256;
    return actual.replace(/:/g, '').toLowerCase() === expected.replace(/:/g, '').toLowerCase();
  } catch {
    return false;
  }
}

app.on('certificate-error', (event, _webContents, url, _error, certificate, callback) => {
  let isLocal = false;
  try {
    isLocal = new URL(url).origin === new URL(localUrl()).origin;
  } catch {
    isLocal = false;
  }
  if (isLocal && sameFingerprint(certificate.data)) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
});

function autoStartEnabled(): boolean {
  if (portable || !app.isPackaged) return false;
  const settings = app.getLoginItemSettings();
  return settings.openAtLogin || settings.executableWillLaunchAtLogin;
}

function setAutoStart(enabled: boolean): void {
  if (portable || !app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    name: 'Kurarium',
    path: process.execPath,
    args: enabled ? ['--hidden'] : [],
  });
  rebuildTrayMenu();
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const isAuto = autoStartEnabled();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Kurarium を開く', click: () => showWindow() },
      { label: '既定のブラウザで開く', click: () => openInBrowser() },
      {
        label: 'データフォルダを開く',
        click: () => {
          void shell.openPath(dataRoot);
        },
      },
      { type: 'separator' },
      {
        label: 'Windows 起動時に自動起動',
        type: 'checkbox',
        checked: isAuto,
        enabled: !portable && app.isPackaged,
        click: (item) => setAutoStart(item.checked),
      },
      { type: 'separator' },
      { label: '再起動', click: () => void restartApp() },
      { label: '終了', click: () => void quitApp() },
    ]),
  );
}

function showWindow(): void {
  if (!window) {
    void createWindow(true);
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function createWindow(showOnReady: boolean): Promise<void> {
  const windowIcon = nativeImage.createFromPath(assetPath('icon.ico'));
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b1220',
    icon: windowIcon.isEmpty() ? assetPath('icon.ico') : windowIcon,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (!windowIcon.isEmpty()) window.setIcon(windowIcon);

  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    const closing = window;
    window = null;
    closing?.destroy();
    if (!hideNotificationShown && Notification.isSupported()) {
      hideNotificationShown = true;
      new Notification({
        title: 'Kurarium',
        body: 'タスクトレイで動作しています。終了するにはトレイメニューから「終了」を選択してください。',
      }).show();
    }
  });

  window.on('closed', () => {
    window = null;
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith(localUrl());
    if (!allowed) {
      event.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        void shell.openExternal(url);
      }
    }
  });

  window.webContents.on('did-fail-load', () => {
    setTimeout(() => {
      if (window && !window.isDestroyed()) void window.loadURL(localUrl());
    }, 750);
  });

  window.once('ready-to-show', () => {
    // 初回起動時に Windows のタスクバーアイコンが確定しない場合があるため、
    // 描画準備完了後にも明示的に設定する。
    if (!windowIcon.isEmpty()) window?.setIcon(windowIcon);
    if (showOnReady) window?.show();
  });

  await window.loadURL(localUrl());
}

function createTray(): void {
  const icon = nativeImage.createFromPath(assetPath('tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromPath(assetPath('icon.ico')) : icon);
  tray.setToolTip(`Kurarium ${app.getVersion()}`);
  tray.on('click', () => showWindow());
  rebuildTrayMenu();
}

function openInBrowser(): void {
  void shell.openExternal(localUrl());
}

async function stopServer(): Promise<void> {
  if (!server) return;
  try {
    await Promise.race([
      server.stop(),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (e) {
    console.error('サーバー停止に失敗しました', e);
  }
  server = null;
}

async function quitApp(): Promise<void> {
  if (quitting) return;
  quitting = true;
  await stopServer();
  app.exit(0);
}

async function restartApp(): Promise<void> {
  if (quitting) return;
  quitting = true;
  await stopServer();
  app.relaunch();
  app.exit(0);
}

async function start(): Promise<void> {
  resolvePaths();
  process.env.MEDIAVIEWER_DATA_DIR = dataRoot;

  if (app.isPackaged) {
    const webDir = join(process.resourcesPath, 'web');
    if (existsSync(join(webDir, 'index.html'))) {
      process.env.KURARIUM_WEB_DIR = webDir;
    }
    const binDir = join(process.resourcesPath, 'bin');
    if (existsSync(binDir)) {
      process.env.PATH = `${binDir};${process.env.PATH ?? ''}`;
    }
  } else {
    const binDir = join(repoRoot, 'vendor', 'ffmpeg');
    if (existsSync(binDir)) {
      process.env.PATH = `${binDir};${process.env.PATH ?? ''}`;
    }
  }

  process.env.KURARIUM_VERSION = app.getVersion();
  setupLogging();
  console.log(`Kurarium ${app.getVersion()} 起動 (portable=${portable}, data=${dataRoot})`);

  const serverEntry = join(app.getAppPath(), 'backend', 'dist', 'server.js');
  const mod = (await import(pathToFileURL(serverEntry).href)) as KurariumServerModule;
  server = await mod.startServer();

  createTray();
  await createWindow(!requestedHidden);
}

ipcMain.handle('kurarium:get-info', () => ({
  version: app.getVersion(),
  portable,
  autoStart: autoStartEnabled(),
  packaged: app.isPackaged,
}));

ipcMain.handle('kurarium:set-auto-start', (_event, enabled: unknown) => {
  setAutoStart(Boolean(enabled));
  return autoStartEnabled();
});

ipcMain.handle('kurarium:open-external', async (_event, url: unknown) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
});

ipcMain.handle('kurarium:open-browser', () => {
  openInBrowser();
});

ipcMain.handle('kurarium:pick-folder', async (_event, defaultPath: unknown) => {
  const options: OpenDialogOptions = {
    title: 'フォルダを選択',
    buttonLabel: '選択',
    properties: ['openDirectory', 'multiSelections'],
  };
  if (typeof defaultPath === 'string' && defaultPath.trim()) {
    options.defaultPath = defaultPath.trim();
  }
  const parent = window && !window.isDestroyed() ? window : undefined;
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('kurarium:restart', () => {
  void restartApp();
});

ipcMain.handle('kurarium:quit', () => {
  void quitApp();
});

app.on('second-instance', () => {
  showWindow();
});

app.on('window-all-closed', () => {
  // Keep running in the tray.
});

app.on('before-quit', (event) => {
  if (!quitting) {
    event.preventDefault();
    void quitApp();
  }
});

process.on('uncaughtException', (e) => {
  console.error('未処理の例外', e);
  if (!quitting && app.isReady()) {
    dialog.showErrorBox('Kurarium エラー', (e as Error).message);
  }
});

process.on('unhandledRejection', (e) => {
  console.error('未処理のPromise拒否', e);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    // Windows のタスクバーグループ/アイコンを最初のウィンドウ生成前に確定する。
    app.setAppUserModelId(APP_USER_MODEL_ID);
    start().catch((e) => {
      console.error('起動に失敗しました', e);
      dialog.showErrorBox(
        'Kurarium を起動できません',
        `${(e as Error).message}\n\nログ: ${join(dataRoot || repoRoot, 'logs', 'app.log')}`,
      );
      app.exit(1);
    });
  });
}
