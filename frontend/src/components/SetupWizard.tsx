import { useState } from 'react';
import {
  createConnection,
  createLibrary,
  startScan,
  testConnectionInput,
  type ConnectionTestResult,
  type MediaType,
} from '../api';
import { canPickFolder, firstPath, mergeFolderPaths, pickFolders } from '../folderPicker';
import { FolderIcon } from './icons';
import { Logo } from './Logo';

interface SetupWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

const inputClass =
  'h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-800';
const textareaClass =
  'min-h-[54px] w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-800';

interface RowState {
  tab: string;
  kind: MediaType;
  enabled: boolean;
  /** 複数パス(改行区切り) */
  paths: string;
}

const KINDS: { tab: string; kind: MediaType }[] = [
  { tab: '画像', kind: 'image' },
  { tab: '動画', kind: 'video' },
  { tab: 'PDF', kind: 'pdf' },
  { tab: '音楽', kind: 'music' },
];

const initialRows = (pathsFor: (tab: string) => string): RowState[] =>
  KINDS.map((k) => ({ ...k, enabled: true, paths: pathsFor(k.tab) }));

const splitPaths = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** 初回起動時(ライブラリ未設定)のセットアップ画面 */
export function SetupWizard({ onComplete, onSkip }: SetupWizardProps) {
  const [localRows, setLocalRows] = useState<RowState[]>(() => initialRows(() => ''));
  const [useLocal, setUseLocal] = useState(false);
  const [useSmb, setUseSmb] = useState(false);
  const [smbRows, setSmbRows] = useState<RowState[]>(() => initialRows(() => ''));
  const [smbHost, setSmbHost] = useState('');
  const [smbShare, setSmbShare] = useState('');
  const [smbUser, setSmbUser] = useState('');
  const [smbPassword, setSmbPassword] = useState('');
  const [smbDrive, setSmbDrive] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingSmb, setTestingSmb] = useState(false);
  const [smbTestResult, setSmbTestResult] = useState<ConnectionTestResult | null>(null);
  const [pickingTab, setPickingTab] = useState<string | null>(null);

  const updateRow = (
    setter: React.Dispatch<React.SetStateAction<RowState[]>>,
    index: number,
    patch: Partial<RowState>,
  ) => {
    setter((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const pickLocalFolders = async (
    row: RowState,
    index: number,
    setter: React.Dispatch<React.SetStateAction<RowState[]>>,
  ) => {
    setError(null);
    setPickingTab(row.tab);
    try {
      const selected = await pickFolders(firstPath(row.paths));
      if (selected.length > 0) {
        updateRow(setter, index, { paths: mergeFolderPaths(row.paths, selected) });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPickingTab(null);
    }
  };

  const testSmb = async () => {
    setTestingSmb(true);
    setSmbTestResult(null);
    setError(null);
    try {
      const result = await testConnectionInput({
        host: smbHost.trim(),
        share: smbShare.trim(),
        username: smbUser.trim(),
        password: smbPassword,
      });
      setSmbTestResult(result);
    } catch (e) {
      setSmbTestResult({ ok: false, basePath: null, message: (e as Error).message });
    } finally {
      setTestingSmb(false);
    }
  };

  const submit = async () => {
    setError(null);

    const localEnabled = useLocal
      ? localRows.filter((r) => r.enabled && splitPaths(r.paths).length > 0)
      : [];
    const smbEnabled = useSmb
      ? smbRows.filter((r) => r.enabled && splitPaths(r.paths).length > 0)
      : [];

    const anyLocalChecked = useLocal && localRows.some((r) => r.enabled);
    const anySmbChecked = useSmb && smbRows.some((r) => r.enabled);
    if (!anyLocalChecked && !anySmbChecked) {
      setError('ローカルまたは SMB のいずれかを有効にしてください');
      return;
    }
    if (useLocal && localRows.some((r) => r.enabled && splitPaths(r.paths).length === 0)) {
      setError('有効にしたローカルライブラリのパスを入力してください');
      return;
    }
    if (
      useSmb &&
      smbRows.some((r) => r.enabled && splitPaths(r.paths).length === 0)
    ) {
      setError('有効にした SMB ライブラリのパスを入力してください');
      return;
    }
    if (anySmbChecked && (!smbHost.trim() || !smbShare.trim() || !smbUser.trim())) {
      setError('SMB のホスト・共有名・ユーザー名を入力してください');
      return;
    }

    setBusy(true);
    try {
      let connectionId: number | null = null;
      if (anySmbChecked) {
        const conn = await createConnection({
          name: `SMB (${smbHost.trim()})`,
          host: smbHost.trim(),
          share: smbShare.trim(),
          username: smbUser.trim(),
          password: smbPassword || undefined,
          driveLetter: smbDrive.trim() || null,
          autoMount: true,
        });
        connectionId = conn.id;
      }

      const localKinds = new Set(localEnabled.map((r) => r.kind));
      const smbKinds = new Set(smbEnabled.map((r) => r.kind));

      for (const row of localEnabled) {
        const name = smbKinds.has(row.kind) ? `${row.tab} (ローカル)` : row.tab;
        await createLibrary({
          name,
          tab: row.tab,
          extensions: [],
          enabled: true,
          paths: splitPaths(row.paths).map((p) => ({
            provider: 'local' as const,
            path: p,
            enabled: true,
          })),
        });
      }

      for (const row of smbEnabled) {
        const name = localKinds.has(row.kind) ? `${row.tab} (SMB)` : row.tab;
        await createLibrary({
          name,
          tab: row.tab,
          extensions: [],
          enabled: true,
          paths: splitPaths(row.paths).map((p) => ({
            provider: 'smb' as const,
            path: p,
            smbConnectionId: connectionId,
            enabled: true,
          })),
        });
      }

      void startScan('diff').catch(() => undefined);
      onComplete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renderRows = (
    rows: RowState[],
    setRows: React.Dispatch<React.SetStateAction<RowState[]>>,
    mode: 'local' | 'smb',
    disabled: boolean,
  ) =>
    rows.map((row, i) => (
      <div
        key={row.tab}
        className={`rounded-lg border p-2.5 transition-colors ${
          row.enabled && !disabled
            ? 'border-sky-300 bg-sky-50/40 dark:border-sky-800 dark:bg-sky-900/10'
            : 'border-zinc-200 bg-white opacity-70 dark:border-zinc-700 dark:bg-zinc-900'
        }`}
      >
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-2"
            checked={row.enabled}
            disabled={disabled}
            onChange={(e) => updateRow(setRows, i, { enabled: e.target.checked })}
            aria-label={`${row.tab}を有効にする`}
          />
          <span className="mt-1.5 w-14 shrink-0 text-sm font-medium">{row.tab}</span>
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <textarea
              value={row.paths}
              onChange={(e) => updateRow(setRows, i, { paths: e.target.value })}
              disabled={disabled || !row.enabled}
              className={`${textareaClass} min-w-0 flex-1`}
              rows={2}
              placeholder={
                mode === 'local'
                  ? `1行に1パス (例: D:\\Media\\${row.tab})`
                  : `1行に1パス (例: ${row.tab})`
              }
            />
            {mode === 'local' && (
              <button
                type="button"
                onClick={() => void pickLocalFolders(row, i, setRows)}
                disabled={
                  disabled || !row.enabled || pickingTab !== null || !canPickFolder()
                }
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-sky-600 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-sky-400"
                title={
                  canPickFolder()
                    ? 'エクスプローラからフォルダを選択'
                    : 'デスクトップ版でのみフォルダを選択できます'
                }
                aria-label={`${row.tab}のフォルダを選択`}
              >
                {pickingTab === row.tab ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                ) : (
                  <FolderIcon className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    ));

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
        <div className="flex justify-center">
          <Logo size={80} showSubtitle />
        </div>
        <div className="mt-5 text-lg font-semibold">ようこそ</div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          ローカルと SMB を併用できます。種別ごとに有効/無効を選び、パスは1行に1つずつ複数指定できます。
        </p>

        <div className="mt-5 space-y-5">
          <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                checked={useLocal}
                onChange={(e) => setUseLocal(e.target.checked)}
                type="checkbox"
              />
              ローカルフォルダから読み込む
            </label>

            {useLocal && (
              <>
                <div className="mt-3 flex items-center justify-between">
                  <div className="text-xs font-medium text-zinc-500">種別ごとの有効/無効</div>
                  <div className="flex gap-2 text-[11px]">
                    <button
                      onClick={() =>
                        setLocalRows((prev) => prev.map((r) => ({ ...r, enabled: true })))
                      }
                      className="text-sky-600 hover:underline dark:text-sky-400"
                    >
                      すべて有効
                    </button>
                    <button
                      onClick={() =>
                        setLocalRows((prev) => prev.map((r) => ({ ...r, enabled: false })))
                      }
                      className="text-zinc-500 hover:underline"
                    >
                      すべて無効
                    </button>
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  {renderRows(localRows, setLocalRows, 'local', !useLocal)}
                </div>
              </>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input checked={useSmb} onChange={(e) => setUseSmb(e.target.checked)} type="checkbox" />
              SMB共有から読み込む
            </label>

            {useSmb && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <input
                    value={smbHost}
                    onChange={(e) => setSmbHost(e.target.value)}
                    className={inputClass}
                    placeholder="ホスト (例: 192.0.2.10)"
                  />
                  <input
                    value={smbShare}
                    onChange={(e) => setSmbShare(e.target.value)}
                    className={inputClass}
                    placeholder="共有名 (例: media)"
                  />
                  <input
                    value={smbUser}
                    onChange={(e) => setSmbUser(e.target.value)}
                    className={inputClass}
                    placeholder="ユーザー名"
                  />
                  <input
                    type="password"
                    value={smbPassword}
                    onChange={(e) => setSmbPassword(e.target.value)}
                    className={inputClass}
                    placeholder="パスワード"
                  />
                  <input
                    value={smbDrive}
                    onChange={(e) => setSmbDrive(e.target.value)}
                    className={inputClass}
                    placeholder="ドライブレター (任意: Z:)"
                  />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => void testSmb()}
                    disabled={testingSmb || !smbHost.trim() || !smbShare.trim() || !smbUser.trim()}
                    className="h-8 rounded-md border border-sky-300 px-3 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-900/30"
                  >
                    {testingSmb ? 'テスト中...' : '接続テスト'}
                  </button>
                  {smbTestResult && (
                    <span
                      className={`text-[11px] ${
                        smbTestResult.ok ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {smbTestResult.message}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="text-xs font-medium text-zinc-500">種別ごとの有効/無効</div>
                  <div className="flex gap-2 text-[11px]">
                    <button
                      onClick={() => setSmbRows((prev) => prev.map((r) => ({ ...r, enabled: true })))}
                      className="text-sky-600 hover:underline dark:text-sky-400"
                    >
                      すべて有効
                    </button>
                    <button
                      onClick={() =>
                        setSmbRows((prev) => prev.map((r) => ({ ...r, enabled: false })))
                      }
                      className="text-zinc-500 hover:underline"
                    >
                      すべて無効
                    </button>
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  {renderRows(smbRows, setSmbRows, 'smb', !useSmb)}
                </div>
              </>
            )}
          </section>

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              onClick={onSkip}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              あとで設定する
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy}
              className="rounded-md bg-sky-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              {busy ? '設定中...' : 'はじめる'}
            </button>
          </div>
          <div className="text-[11px] text-zinc-500">
            同じ種別をローカルと SMB の両方で有効にした場合、タブは共通でライブラリ名に (ローカル)/(SMB) を付けます。
          </div>
        </div>
      </div>
    </div>
  );
}
