import { useEffect, useState } from 'react';
import {
  createConnection,
  createLibrary,
  deleteConnection,
  deleteLibrary,
  getScanStatus,
  getServerSettings,
  getSystem,
  listConnections,
  listLibraries,
  logout as apiLogout,
  reorderLibraries,
  saveServerSettings,
  saveSystemSettings,
  startScan,
  testConnection,
  updateConnection,
  updateLibrary,
  type Library,
  type LibraryPathInput,
  type LibraryProvider,
  type ScanMode,
  type ScanState,
  type SmbConnection,
  type SystemInfo,
} from '../api';
import type { BehaviorSettings, FolderTileAspect } from '../hooks/useBehaviorSettings';
import { CloseIcon } from './icons';
import { useModalA11y } from '../hooks/useModalA11y';

type Tab = 'libraries' | 'connections' | 'system' | 'behavior';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  behavior: BehaviorSettings;
  onChangeBehavior: (patch: Partial<BehaviorSettings>) => void;
  initialTab?: Tab;
  onLibrariesChanged?: () => void;
}

type ToggleKey =
  | 'hoverPreview'
  | 'wheelNavigate'
  | 'doubleClickFullscreen'
  | 'keepHistory'
  | 'rowWobble';

const BEHAVIOR_ITEMS: { key: ToggleKey; label: string; description: string }[] = [
  {
    key: 'hoverPreview',
    label: 'サムネイル・ホバー動画プレビュー',
    description: '動画サムネイルにカーソルを合わせるとミュートで自動再生します',
  },
  {
    key: 'wheelNavigate',
    label: 'ホイールでの前後切替',
    description: 'ライトボックスで画像の外側をスクロールして前後の画像へ移動します',
  },
  {
    key: 'doubleClickFullscreen',
    label: 'ダブルクリックで全画面',
    description: 'ライトボックスの画像をダブルクリックして全画面表示に切り替えます',
  },
  {
    key: 'keepHistory',
    label: '閲覧履歴を残す',
    description: 'オフにすると動画・音楽の視聴履歴が記録されなくなります(既存の履歴は消えません)',
  },
  {
    key: 'rowWobble',
    label: '行の高さにゆらぎをつける',
    description: '「サムネのみ」レイアウトで行の高さを±10%の範囲でランダムに変化させます',
  },
];

const THUMB_HEIGHT_ITEMS: {
  key:
    | 'thumbHeight'
    | 'thumbHeightImage'
    | 'thumbHeightVideo'
    | 'thumbHeightPdf'
    | 'thumbHeightMusic';
  label: string;
}[] = [
  { key: 'thumbHeight', label: 'すべて/履歴' },
  { key: 'thumbHeightImage', label: '画像' },
  { key: 'thumbHeightVideo', label: '動画' },
  { key: 'thumbHeightPdf', label: 'PDF' },
  { key: 'thumbHeightMusic', label: '音楽' },
];

const FOLDER_TILE_ASPECTS: { value: FolderTileAspect; label: string }[] = [
  { value: 'thumb', label: 'サムネイルに合わせる' },
  { value: '1:1', label: '固定 1:1 (正方形)' },
  { value: '4:3', label: '固定 4:3' },
  { value: '3:2', label: '固定 3:2' },
  { value: '16:9', label: '固定 16:9' },
  { value: '3:4', label: '固定 3:4 (縦長)' },
  { value: '2:3', label: '固定 2:3 (縦長)' },
  { value: '9:16', label: '固定 9:16 (縦長)' },
  { value: 'custom', label: 'カスタム (縦横比を指定)' },
];

const inputClass =
  'h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-800';

export function SettingsModal({
  open,
  onClose,
  behavior,
  onChangeBehavior,
  initialTab = 'libraries',
  onLibrariesChanged,
}: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const dialogRef = useModalA11y(open, onClose, true);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="設定"
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900"
      >
        <div className="flex items-center gap-1 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          {(
            [
              ['libraries', 'ライブラリ'],
              ['connections', '接続'],
              ['system', 'システム'],
              ['behavior', '操作設定'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                tab === id
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-white"
            aria-label="閉じる"
            title="閉じる"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {tab === 'libraries' && <LibrariesTab onChanged={onLibrariesChanged} />}
          {tab === 'connections' && <ConnectionsTab />}
          {tab === 'system' && <SystemTab onChanged={onLibrariesChanged} />}
          {tab === 'behavior' && (
            <BehaviorTab behavior={behavior} onChangeBehavior={onChangeBehavior} />
          )}
        </div>

        <div className="flex justify-end border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-300 bg-white px-4 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- ライブラリ ----

interface PathDraft {
  provider: LibraryProvider;
  path: string;
  smbConnectionId: number | null;
  enabled: boolean;
}

interface LibraryDraft {
  name: string;
  tab: string;
  extensions: string;
  enabled: boolean;
  paths: PathDraft[];
}

function toDraft(lib?: Library): LibraryDraft {
  if (!lib) {
    return {
      name: '',
      tab: '',
      extensions: '',
      enabled: true,
      paths: [{ provider: 'local', path: '', smbConnectionId: null, enabled: true }],
    };
  }
  const groups = new Map<string, PathDraft>();
  for (const p of lib.paths) {
    const key = `${p.provider}:${p.smb_connection_id ?? ''}:${p.enabled === 1 ? 1 : 0}`;
    const found = groups.get(key);
    if (found) found.path = `${found.path}\n${p.path}`;
    else
      groups.set(key, {
        provider: p.provider,
        path: p.path,
        smbConnectionId: p.smb_connection_id,
        enabled: p.enabled === 1,
      });
  }
  return {
    name: lib.name,
    tab: lib.tab_name || '画像',
    extensions: lib.extensions ?? '',
    enabled: lib.enabled === 1,
    paths: groups.size > 0 ? [...groups.values()] : toDraft().paths,
  };
}

function LibrariesTab({ onChanged }: { onChanged?: () => void }) {
  const [libs, setLibs] = useState<Library[]>([]);
  const [conns, setConns] = useState<SmbConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<LibraryDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const [scan, setScan] = useState<ScanState | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNonce, setScanNonce] = useState(0);

  const refresh = async () => {
    try {
      const [libList, connList] = await Promise.all([listLibraries(), listConnections()]);
      setLibs(libList);
      setConns(connList);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const st = await getScanStatus();
        if (!alive) return;
        setScan(st);
        if (st.running) timer = window.setTimeout(tick, 1500);
      } catch {
        if (alive) timer = window.setTimeout(tick, 3000);
      }
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [scanNonce]);

  const runScan = async (mode: ScanMode) => {
    setScanBusy(true);
    setError(null);
    try {
      const st = await startScan(mode);
      setScan(st);
      setScanNonce((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanBusy(false);
    }
  };

  const startEdit = (lib?: Library) => {
    setEditingId(lib ? lib.id : 'new');
    setDraft(toDraft(lib));
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setError('ライブラリ名を入力してください');
      return;
    }
    const paths: LibraryPathInput[] = draft.paths.flatMap((p) =>
      p.path
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((path) => ({
          provider: p.provider,
          path,
          smbConnectionId: p.provider === 'smb' ? p.smbConnectionId : null,
          enabled: p.enabled,
        })),
    );
    const tab = draft.tab.trim();
    if (!tab) {
      setError('タブ名を入力してください');
      return;
    }
    const extensions = draft.extensions
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    setSaving(true);
    setError(null);
    try {
      if (editingId === 'new' || editingId === null) {
        await createLibrary({ name, tab, extensions, enabled: draft.enabled, paths });
      } else {
        await updateLibrary(editingId, { name, tab, extensions, enabled: draft.enabled, paths });
      }
      setEditingId(null);
      setDraft(null);
      await refresh();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (lib: Library) => {
    try {
      await updateLibrary(lib.id, { enabled: lib.enabled !== 1 });
      await refresh();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (lib: Library) => {
    if (
      !window.confirm(
        `ライブラリ「${lib.name}」をアプリから削除します。\nファイルは削除されません。よろしいですか?`,
      )
    ) {
      return;
    }
    try {
      await deleteLibrary(lib.id);
      await refresh();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const move = async (index: number, delta: number) => {
    const next = [...libs];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await reorderLibraries(next.map((l) => l.id));
      setLibs(next);
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">ライブラリ</div>
        <button
          onClick={() => startEdit()}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
        >
          + ライブラリを追加
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-300">{error}</div>}

      {loading ? (
        <div className="py-6 text-center text-sm text-zinc-500">読み込み中...</div>
      ) : libs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          ライブラリがありません。ローカルフォルダまたは SMB 共有を追加してください。
        </div>
      ) : (
        <div className="space-y-1.5">
          {libs.map((lib, i) => (
            <div
              key={lib.id}
              className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{lib.name}</span>
                  <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    {lib.tab_name || lib.kind}
                  </span>
                  {lib.is_default === 1 && (
                    <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                      既定
                    </span>
                  )}
                  {lib.enabled !== 1 && (
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      無効
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                  {lib.paths.map((p) => `${p.provider === 'smb' ? 'SMB' : 'ローカル'}: ${p.path}`).join(' / ')}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => void move(i, -1)}
                  disabled={i === 0}
                  className="h-7 w-7 rounded border border-zinc-300 text-xs disabled:opacity-30 dark:border-zinc-600"
                  title="上へ"
                >
                  ↑
                </button>
                <button
                  onClick={() => void move(i, 1)}
                  disabled={i === libs.length - 1}
                  className="h-7 w-7 rounded border border-zinc-300 text-xs disabled:opacity-30 dark:border-zinc-600"
                  title="下へ"
                >
                  ↓
                </button>
                <button
                  onClick={() => void toggleEnabled(lib)}
                  className="h-7 rounded border border-zinc-300 px-2 text-[11px] dark:border-zinc-600"
                >
                  {lib.enabled === 1 ? '無効化' : '有効化'}
                </button>
                <button
                  onClick={() => startEdit(lib)}
                  className="h-7 rounded border border-zinc-300 px-2 text-[11px] dark:border-zinc-600"
                >
                  編集
                </button>
                {lib.is_default !== 1 && (
                  <button
                    onClick={() => void remove(lib)}
                    className="h-7 rounded border border-red-300 px-2 text-[11px] text-red-600 dark:border-red-800 dark:text-red-400"
                  >
                    削除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <LibraryEditor
          draft={draft}
          setDraft={setDraft}
          conns={conns}
          isNew={editingId === 'new'}
          saving={saving}
          onCancel={() => {
            setEditingId(null);
            setDraft(null);
          }}
          onSave={() => void save()}
        />
      )}

      <ScanPanel scan={scan} scanBusy={scanBusy} onScan={(m) => void runScan(m)} />
    </div>
  );
}

function LibraryEditor({
  draft,
  setDraft,
  conns,
  isNew,
  saving,
  onCancel,
  onSave,
}: {
  draft: LibraryDraft;
  setDraft: (d: LibraryDraft) => void;
  conns: SmbConnection[];
  isNew: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const updatePath = (index: number, patch: Partial<PathDraft>) => {
    const paths = draft.paths.map((p, i) => (i === index ? { ...p, ...patch } : p));
    setDraft({ ...draft, paths });
  };

  return (
    <div className="space-y-3 rounded-lg border border-sky-300 bg-sky-50/40 p-3 dark:border-sky-800 dark:bg-sky-900/10">
      <div className="text-sm font-semibold">{isNew ? 'ライブラリを追加' : 'ライブラリを編集'}</div>

      <div className="grid grid-cols-[1fr_160px] gap-2">
        <label className="block">
          <span className="text-xs text-zinc-500">ライブラリ名</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className={inputClass}
            placeholder="例: ローカル画像 / NAS写真"
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500">タブ名</span>
          <input
            value={draft.tab}
            onChange={(e) => setDraft({ ...draft, tab: e.target.value })}
            className={inputClass}
            list="library-tab-suggestions"
            placeholder="例: 画像 / コミック"
          />
          <datalist id="library-tab-suggestions">
            <option value="画像" />
            <option value="動画" />
            <option value="PDF" />
            <option value="音楽" />
          </datalist>
        </label>
      </div>

      <label className="block">
        <span className="text-xs text-zinc-500">対象の拡張子 (カンマ区切り)</span>
        <input
          value={draft.extensions}
          onChange={(e) => setDraft({ ...draft, extensions: e.target.value })}
          className={inputClass}
          placeholder="例: .cbz,.zip   (空欄なら 画像/動画/PDF/音楽 の既定拡張子)"
        />
        <span className="text-[11px] text-zinc-500">
          任意のタブ名を付ける場合は拡張子の指定が必要です
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />
        有効にする
      </label>

      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-500">パス</div>
        {draft.paths.map((p, i) => (
          <div key={i} className="space-y-1.5 rounded-md bg-white p-2 dark:bg-zinc-900/60">
            <div className="flex items-center gap-2">
              <select
                value={p.provider}
                onChange={(e) =>
                  updatePath(i, { provider: e.target.value as LibraryProvider })
                }
                className={`${inputClass} w-28`}
              >
                <option value="local">ローカル</option>
                <option value="smb">SMB</option>
              </select>
              {p.provider === 'smb' && (
                <select
                  value={p.smbConnectionId ?? ''}
                  onChange={(e) =>
                    updatePath(i, {
                      smbConnectionId: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className={inputClass}
                >
                  <option value="">接続を選択...</option>
                  {conns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.host}/{c.share})
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={() =>
                  setDraft({ ...draft, paths: draft.paths.filter((_, k) => k !== i) })
                }
                disabled={draft.paths.length === 1}
                className="ml-auto h-9 shrink-0 rounded-md border border-red-300 px-2 text-xs text-red-600 disabled:opacity-30 dark:border-red-800 dark:text-red-400"
              >
                削除
              </button>
            </div>
            <textarea
              value={p.path}
              onChange={(e) => updatePath(i, { path: e.target.value })}
              rows={2}
              className="min-h-[54px] w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-800"
              placeholder={
                p.provider === 'smb'
                  ? '共有内の相対パスを1行に1つ (例: 画像\\sub)'
                  : '絶対パスを1行に1つ (例: D:\\Media\\Pics または \\\\server\\share\\Pics)'
              }
            />
            <label className="flex items-center gap-2 text-[11px] text-zinc-500">
              <input
                type="checkbox"
                checked={p.enabled}
                onChange={(e) => updatePath(i, { enabled: e.target.checked })}
              />
              このパスを有効にする
            </label>
          </div>
        ))}
        <button
          onClick={() =>
            setDraft({
              ...draft,
              paths: [
                ...draft.paths,
                { provider: 'local', path: '', smbConnectionId: null, enabled: true },
              ],
            })
          }
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600"
        >
          + パスを追加
        </button>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-600"
        >
          キャンセル
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}

function ScanPanel({
  scan,
  scanBusy,
  onScan,
}: {
  scan: ScanState | null;
  scanBusy: boolean;
  onScan: (mode: ScanMode) => void;
}) {
  const running = scanBusy || !!scan?.running;
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">ライブラリのスキャン</div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            差分スキャンは追加・変更・削除のみ取り込みます(起動時は自動で差分実行)
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            onClick={() => onScan('full')}
            disabled={running}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          >
            全スキャン
          </button>
          <button
            onClick={() => onScan('diff')}
            disabled={running}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
          >
            差分スキャン
          </button>
        </div>
      </div>

      {scan?.running && (
        <div className="mt-2 flex items-center gap-2 text-xs text-sky-600 dark:text-sky-400">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          スキャン中... ({Math.max(0, scan.currentIndex + 1)}/{scan.totalFolders} フォルダ)
        </div>
      )}
      {!scan?.running && scan?.error && (
        <div className="mt-2 text-xs text-red-600">{scan.error}</div>
      )}
      {!scan?.running && scan && scan.results.length > 0 && (
        <div className="mt-2 space-y-0.5 rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          {scan.results.map((r) => (
            <div key={r.folder} className="flex justify-between gap-2">
              <span className="truncate">
                {r.folder}
                <span className="ml-1 text-[10px] text-zinc-400">
                  ({r.mode === 'full' ? '全' : '差分'})
                </span>
              </span>
              <span className="shrink-0">
                新規 {r.inserted} / 更新 {r.updated} / 削除 {r.removed}
              </span>
            </div>
          ))}
          <div className="pt-1 text-[10px] text-zinc-500">
            一覧へ反映するにはページを再読み込みしてください
          </div>
        </div>
      )}
    </div>
  );
}

// ---- SMB 接続 ----

interface ConnDraft {
  name: string;
  host: string;
  share: string;
  username: string;
  password: string;
  driveLetter: string;
  autoMount: boolean;
}

const emptyConn: ConnDraft = {
  name: '',
  host: '',
  share: '',
  username: '',
  password: '',
  driveLetter: '',
  autoMount: true,
};

function ConnectionsTab() {
  const [conns, setConns] = useState<SmbConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<ConnDraft>(emptyConn);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; ok: boolean; message: string } | null>(
    null,
  );

  const refresh = async () => {
    try {
      setConns(await listConnections());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const startEdit = (c?: SmbConnection) => {
    setEditingId(c ? c.id : 'new');
    setDraft(
      c
        ? {
            name: c.name,
            host: c.host,
            share: c.share,
            username: c.username,
            password: '',
            driveLetter: c.drive_letter ?? '',
            autoMount: c.auto_mount === 1,
          }
        : emptyConn,
    );
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        host: draft.host.trim(),
        share: draft.share.trim(),
        username: draft.username.trim(),
        password: draft.password || undefined,
        driveLetter: draft.driveLetter.trim() || null,
        autoMount: draft.autoMount,
      };
      if (editingId === 'new') await createConnection(payload);
      else if (editingId !== null) await updateConnection(editingId, payload);
      setEditingId(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: SmbConnection) => {
    if (!window.confirm(`接続「${c.name}」を削除しますか?`)) return;
    try {
      await deleteConnection(c.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const test = async (c: SmbConnection) => {
    setTesting(c.id);
    setTestResult(null);
    try {
      const res = await testConnection(c.id);
      setTestResult({ id: c.id, ok: res.ok, message: res.message });
    } catch (e) {
      setTestResult({ id: c.id, ok: false, message: (e as Error).message });
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">SMB 接続</div>
          <div className="text-xs text-zinc-500">
            認証情報は Windows 資格情報マネージャーに保存されます
          </div>
        </div>
        <button
          onClick={() => startEdit()}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
        >
          + 接続を追加
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-6 text-center text-sm text-zinc-500">読み込み中...</div>
      ) : conns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          SMB 接続は未設定です(ローカルのみでも利用できます)
        </div>
      ) : (
        <div className="space-y-1.5">
          {conns.map((c) => (
            <div key={c.id} className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="truncate text-[11px] text-zinc-500">
                    \\{c.host}\{c.share} ・ {c.username} ・{' '}
                    {c.drive_letter ? `${c.drive_letter} にマウント` : 'ドライブ未使用'}
                    {c.auto_mount === 1 ? ' ・ 起動時に接続' : ''}
                  </div>
                </div>
                <button
                  onClick={() => void test(c)}
                  disabled={testing === c.id}
                  className="h-7 rounded border border-zinc-300 px-2 text-[11px] disabled:opacity-50 dark:border-zinc-600"
                >
                  {testing === c.id ? 'テスト中...' : '接続テスト'}
                </button>
                <button
                  onClick={() => startEdit(c)}
                  className="h-7 rounded border border-zinc-300 px-2 text-[11px] dark:border-zinc-600"
                >
                  編集
                </button>
                <button
                  onClick={() => void remove(c)}
                  className="h-7 rounded border border-red-300 px-2 text-[11px] text-red-600 dark:border-red-800 dark:text-red-400"
                >
                  削除
                </button>
              </div>
              {testResult?.id === c.id && (
                <div
                  className={`mt-1 text-[11px] ${
                    testResult.ok ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {testResult.message}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editingId !== null && (
        <div className="space-y-2 rounded-lg border border-sky-300 bg-sky-50/40 p-3 dark:border-sky-800 dark:bg-sky-900/10">
          <div className="text-sm font-semibold">
            {editingId === 'new' ? '接続を追加' : '接続を編集'}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className={inputClass}
              placeholder="表示名 (例: 自宅NAS)"
            />
            <input
              value={draft.host}
              onChange={(e) => setDraft({ ...draft, host: e.target.value })}
              className={inputClass}
              placeholder="ホスト (192.0.2.10 など)"
            />
            <input
              value={draft.share}
              onChange={(e) => setDraft({ ...draft, share: e.target.value })}
              className={inputClass}
              placeholder="共有名 (例: media)"
            />
            <input
              value={draft.username}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              className={inputClass}
              placeholder="ユーザー名"
            />
            <input
              type="password"
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              className={inputClass}
              placeholder={editingId === 'new' ? 'パスワード' : 'パスワード (変更時のみ入力)'}
            />
            <input
              value={draft.driveLetter}
              onChange={(e) => setDraft({ ...draft, driveLetter: e.target.value })}
              className={inputClass}
              placeholder="ドライブレター (任意: Z:)"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.autoMount}
              onChange={(e) => setDraft({ ...draft, autoMount: e.target.checked })}
            />
            起動時に自動接続する
          </label>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditingId(null)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-600"
            >
              キャンセル
            </button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- システム ----

function SystemTab({ onChanged }: { onChanged?: () => void }) {
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [allowMixed, setAllowMixed] = useState(false);
  const [showUnsupported, setShowUnsupported] = useState(false);
  const [confirmShowUnsupported, setConfirmShowUnsupported] = useState(false);
  const [scanOnStartup, setScanOnStartup] = useState(true);
  const [savingScan, setSavingScan] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [serverHost, setServerHost] = useState('127.0.0.1');
  const [serverPort, setServerPort] = useState(3000);
  const [authUser, setAuthUser] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [savingServer, setSavingServer] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [hasBasicAuth, setHasBasicAuth] = useState(false);
  const [savingMixed, setSavingMixed] = useState(false);
  const [mixedMessage, setMixedMessage] = useState<string | null>(null);
  const [mixedError, setMixedError] = useState<string | null>(null);
  const [savingSupported, setSavingSupported] = useState(false);
  const [videoMessage, setVideoMessage] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [desktop, setDesktop] = useState<{
    version: string;
    portable: boolean;
    autoStart: boolean;
    packaged: boolean;
  } | null>(null);
  const [savingAutoStart, setSavingAutoStart] = useState(false);

  useEffect(() => {
    void window.kurarium?.getInfo().then(setDesktop).catch(() => undefined);
    Promise.all([getSystem(), getServerSettings()])
      .then(([s, ss]) => {
        setSystem(s);
        setAllowMixed(s.allowMixedMedia);
        setShowUnsupported(!s.onlySupportedVideos);
        setScanOnStartup(s.scanOnStartup);
        setServerHost(ss.host);
        setServerPort(ss.port);
        setAuthUser(ss.basicAuthUser);
        setHasBasicAuth(ss.hasBasicAuth);
      })
      .catch((e) => setMixedError((e as Error).message));
  }, []);

  const toggleAllowMixed = async () => {
    if (savingMixed) return;
    const next = !allowMixed;
    setAllowMixed(next);
    setSavingMixed(true);
    setMixedMessage(null);
    setMixedError(null);
    try {
      const res = await saveSystemSettings({ allowMixedMedia: next });
      setAllowMixed(res.allowMixedMedia);
      setSystem((prev) => (prev ? { ...prev, ...res } : prev));
      await startScan('diff').catch(() => undefined);
      setMixedMessage('設定を保存し、差分スキャンを開始しました');
      onChanged?.();
    } catch (e) {
      setAllowMixed(!next);
      setMixedError((e as Error).message);
    } finally {
      setSavingMixed(false);
    }
  };

  // 非対応動画の表示をオンにするときは変換処理の了解を取る
  const applyShowUnsupported = async (next: boolean) => {
    if (savingSupported) return;
    setShowUnsupported(next);
    setSavingSupported(true);
    setVideoMessage(null);
    setVideoError(null);
    try {
      const res = await saveSystemSettings({ onlySupportedVideos: !next });
      setShowUnsupported(!res.onlySupportedVideos);
      setSystem((prev) => (prev ? { ...prev, ...res } : prev));
      setVideoMessage(
        next
          ? '非対応コーデックの動画も表示するように変更しました'
          : '対応コーデックの動画のみ表示に戻しました',
      );
      onChanged?.();
    } catch (e) {
      setShowUnsupported(!next);
      setVideoError((e as Error).message);
    } finally {
      setSavingSupported(false);
    }
  };

  const requestToggleShowUnsupported = () => {
    if (savingSupported || confirmShowUnsupported) return;
    if (!showUnsupported) {
      setConfirmShowUnsupported(true);
      return;
    }
    void applyShowUnsupported(false);
  };

  const toggleScanOnStartup = async () => {
    if (savingScan) return;
    const next = !scanOnStartup;
    setScanOnStartup(next);
    setSavingScan(true);
    setScanMessage(null);
    setScanError(null);
    try {
      const res = await saveSystemSettings({ scanOnStartup: next });
      setScanOnStartup(res.scanOnStartup);
      setSystem((prev) => (prev ? { ...prev, ...res } : prev));
      setScanMessage(
        res.scanOnStartup
          ? '起動時に自動スキャンする設定に変更しました'
          : '起動時の自動スキャンを無効にしました',
      );
    } catch (e) {
      setScanOnStartup(!next);
      setScanError((e as Error).message);
    } finally {
      setSavingScan(false);
    }
  };

  const saveServer = async () => {
    const port = Number(serverPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setServerError('ポートは 1〜65535 の整数で指定してください');
      return;
    }
    setSavingServer(true);
    setServerMessage(null);
    setServerError(null);
    try {
      const saved = await saveServerSettings({
        host: serverHost.trim() || '127.0.0.1',
        port,
        basicAuthUser: authUser.trim(),
        basicAuthPassword: authPassword || undefined,
      });
      setServerHost(saved.host);
      setServerPort(saved.port);
      setAuthUser(saved.basicAuthUser);
      setHasBasicAuth(saved.hasBasicAuth);
      setAuthPassword('');
      setServerMessage('保存しました。変更はシステム再起動後に反映されます');
      onChanged?.();
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setSavingServer(false);
    }
  };

  const toggleAutoStart = async () => {
    if (!window.kurarium || !desktop || savingAutoStart) return;
    setSavingAutoStart(true);
    try {
      const enabled = await window.kurarium
        .setAutoStart(!desktop.autoStart)
        .catch(() => null);
      if (enabled !== null) {
        setDesktop((prev) => (prev ? { ...prev, autoStart: enabled } : prev));
      }
    } finally {
      setSavingAutoStart(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold">{system?.appName ?? 'Kurarium'}</div>
            <div className="text-[11px] text-zinc-500">
              バージョン {system?.version ?? desktop?.version ?? '-'}
              {desktop?.portable ? ' (ポータブル)' : ''}
            </div>
            <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              ローカル/SMBの画像・動画・PDF・音楽を閲覧するメディアビューア
            </div>
          </div>
          {desktop && (
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => void window.kurarium?.openInBrowser()}
                className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-700"
              >
                ブラウザで開く
              </button>
              <button
                onClick={() => void window.kurarium?.restart()}
                className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-700"
              >
                再起動
              </button>
            </div>
          )}
        </div>
        {desktop && (
          <>
            <div className="flex items-center justify-between gap-4 border-t border-zinc-200 pt-2 dark:border-zinc-700">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                オン: Windows へのサインイン時に自動起動します(タスクトレイに常駐)
              </div>
              <button
                role="switch"
                aria-checked={desktop.autoStart}
                aria-label="Windows 起動時に自動起動"
                disabled={!desktop.packaged || desktop.portable || savingAutoStart}
                onClick={() => void toggleAutoStart()}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                  desktop.autoStart ? 'bg-sky-600' : 'bg-zinc-300 dark:bg-zinc-700'
                } disabled:opacity-40`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    desktop.autoStart ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>
            {(desktop.portable || !desktop.packaged) && (
              <div className="text-[11px] text-zinc-500">
                {desktop.portable
                  ? 'ポータブル版では自動起動を設定できません'
                  : '開発実行中は自動起動を設定できません'}
              </div>
            )}
          </>
        )}
        <div className="break-all text-[11px] text-zinc-500">
          データフォルダ: {system?.dataDir ?? '-'}
        </div>
      </div>

      <div className="space-y-2 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
        <div className="text-sm font-medium">ライブラリのメディア種別</div>
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            オン: ライブラリ内の全種類(画像/動画/PDF/音楽)を取り込む
            <br />
            オフ: ライブラリの種別に一致するファイルのみ取り込む
          </div>
          <button
            role="switch"
            aria-checked={allowMixed}
            aria-label="メディア種別の混在を許可"
            disabled={savingMixed || !system}
            onClick={() => void toggleAllowMixed()}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              allowMixed ? 'bg-sky-600' : 'bg-zinc-300 dark:bg-zinc-700'
            } disabled:opacity-50`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                allowMixed ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
        <div className="text-[11px] text-zinc-500">
          {savingMixed
            ? '保存中...'
            : '変更するとその場で保存し、差分スキャンを開始します'}
        </div>
        {mixedMessage && <div className="text-xs text-green-600">{mixedMessage}</div>}
        {mixedError && <div className="text-xs text-red-600">{mixedError}</div>}
      </div>

      <div className="space-y-2 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
        <div className="text-sm font-medium">非対応コーデックの動画の表示</div>
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            オフ(既定): ブラウザで直接再生できる動画のみ表示(MP4/M4V/WebM/OGV + 対応コーデック)
            <br />
            オン: 非対応コーデックの動画(FLV/MKV/AVI/TS等)も一覧に表示
          </div>
          <button
            role="switch"
            aria-checked={showUnsupported}
            aria-label="非対応コーデックの動画も表示"
            disabled={savingSupported || confirmShowUnsupported}
            onClick={requestToggleShowUnsupported}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              showUnsupported ? 'bg-sky-600' : 'bg-zinc-300 dark:bg-zinc-700'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                showUnsupported ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
        <div className="text-[11px] text-zinc-500">
          非対応コーデックの動画は既定で非表示です。コーデック不明の動画は表示されます
        </div>
        {confirmShowUnsupported && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
            <div>
              非対応コーデックの動画を一覧に表示します。再生時に変換処理が入るため、開始まで時間がかかる場合があります。
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setConfirmShowUnsupported(false)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
              >
                キャンセル
              </button>
              <button
                onClick={() => {
                  setConfirmShowUnsupported(false);
                  void applyShowUnsupported(true);
                }}
                className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
              >
                了解して表示する
              </button>
            </div>
          </div>
        )}
        {videoMessage && <div className="text-xs text-green-600">{videoMessage}</div>}
        {videoError && <div className="text-xs text-red-600">{videoError}</div>}
      </div>

      <div className="space-y-2 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
        <div className="text-sm font-medium">起動時のスキャン</div>
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            オン: アプリ起動時に差分スキャンを自動実行
            <br />
            オフ: 手動で実行するまでスキャンしない
          </div>
          <button
            role="switch"
            aria-checked={scanOnStartup}
            aria-label="起動時に自動スキャンする"
            disabled={savingScan}
            onClick={() => void toggleScanOnStartup()}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              scanOnStartup ? 'bg-sky-600' : 'bg-zinc-300 dark:bg-zinc-700'
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                scanOnStartup ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
        {scanMessage && <div className="text-xs text-green-600">{scanMessage}</div>}
        {scanError && <div className="text-xs text-red-600">{scanError}</div>}
      </div>

      <div className="space-y-2 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
        <div className="text-sm font-medium">サーバー設定</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] text-zinc-500">待ち受けホスト</span>
            <input
              value={serverHost}
              onChange={(e) => setServerHost(e.target.value)}
              className={inputClass}
              placeholder="127.0.0.1"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-zinc-500">ポート</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={serverPort}
              onChange={(e) => setServerPort(Number(e.target.value))}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-zinc-500">ログインユーザー名</span>
            <input
              value={authUser}
              onChange={(e) => setAuthUser(e.target.value)}
              className={inputClass}
              placeholder="LAN公開時に必須"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-zinc-500">ログインパスワード</span>
            <input
              type="password"
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              className={inputClass}
              placeholder={hasBasicAuth ? '変更時のみ入力' : 'LAN公開時に必須'}
            />
          </label>
        </div>
        <div className="text-[11px] text-zinc-500">
          変更はシステム再起動後に反映されます。LAN公開時はログインページが表示されます。パスワードはハッシュとして保存され、平文では保持しません。設定ファイルは
          <code className="mx-0.5">data\.system</code>
          に自動保存されます。LAN公開時はHTTP通信のため、信頼できるネットワークでのみ使用してください。
        </div>
        {serverMessage && <div className="text-xs text-green-600">{serverMessage}</div>}
        {serverError && <div className="text-xs text-red-600">{serverError}</div>}
        <div className="flex justify-end gap-2">
          {system?.authRequired && (
            <button
              onClick={() => {
                void apiLogout().then(() => window.location.reload());
              }}
              className="h-8 rounded-md border border-zinc-300 px-4 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-700"
            >
              ログアウト
            </button>
          )}
          <button
            onClick={() => void saveServer()}
            disabled={savingServer}
            className="h-8 rounded-md bg-sky-600 px-4 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {savingServer ? '保存中...' : 'サーバー設定を保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- 操作設定 ----

function BehaviorTab({
  behavior,
  onChangeBehavior,
}: {
  behavior: BehaviorSettings;
  onChangeBehavior: (patch: Partial<BehaviorSettings>) => void;
}) {
  const setFolderRatio = (
    key: 'folderTileAspectW' | 'folderTileAspectH',
    raw: string,
  ) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return;
    const value = Math.min(100, Math.round(n));
    onChangeBehavior(
      key === 'folderTileAspectW' ? { folderTileAspectW: value } : { folderTileAspectH: value },
    );
  };

  return (
    <div className="space-y-2">
      {BEHAVIOR_ITEMS.map((b) => {
        const on = behavior[b.key];
        return (
          <div
            key={b.key}
            className="flex items-center justify-between gap-4 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60"
          >
            <div>
              <div className="text-sm font-medium">{b.label}</div>
              <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {b.description}
              </div>
            </div>
            <button
              role="switch"
              aria-checked={on}
              aria-label={b.label}
              onClick={() => onChangeBehavior({ [b.key]: !on } as Partial<BehaviorSettings>)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                on ? 'bg-sky-600' : 'bg-zinc-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  on ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>
        );
      })}

      <div className="mt-2 space-y-3 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
        <div className="text-sm font-medium">サムネイルの高さ</div>
        {THUMB_HEIGHT_ITEMS.map((t) => (
          <div key={t.key} className="flex items-center gap-3">
            <label
              htmlFor={`thumb-${t.key}`}
              className="w-24 shrink-0 text-xs text-zinc-500 dark:text-zinc-400"
            >
              {t.label}
            </label>
            <input
              id={`thumb-${t.key}`}
              type="range"
              min={120}
              max={400}
              step={10}
              value={behavior[t.key]}
              onChange={(e) =>
                onChangeBehavior({
                  [t.key]: Number(e.target.value),
                } as Partial<BehaviorSettings>)
              }
              className="h-1.5 flex-1 cursor-pointer accent-sky-600"
            />
            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-zinc-500">
              {behavior[t.key]}px
            </span>
          </div>
        ))}
      </div>

      <div className="mt-2 space-y-3 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
        <div className="text-sm font-medium">フォルダタイル</div>
        <div className="flex items-center gap-3">
          <label
            htmlFor="folder-tile-height"
            className="w-14 shrink-0 text-xs text-zinc-500 dark:text-zinc-400"
          >
            高さ
          </label>
          <input
            id="folder-tile-height"
            type="range"
            min={100}
            max={320}
            step={10}
            value={behavior.folderTileHeight}
            onChange={(e) => onChangeBehavior({ folderTileHeight: Number(e.target.value) })}
            className="h-1.5 flex-1 cursor-pointer accent-sky-600"
          />
          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-zinc-500">
            {behavior.folderTileHeight}px
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label
            htmlFor="folder-tile-aspect"
            className="w-14 shrink-0 text-xs text-zinc-500 dark:text-zinc-400"
          >
            形
          </label>
          <select
            id="folder-tile-aspect"
            value={behavior.folderTileAspect}
            onChange={(e) =>
              onChangeBehavior({ folderTileAspect: e.target.value as FolderTileAspect })
            }
            className="h-9 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          >
            {FOLDER_TILE_ASPECTS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {behavior.folderTileAspect === 'custom' && (
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-xs text-zinc-500 dark:text-zinc-400">比率</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={100}
                value={behavior.folderTileAspectW}
                onChange={(e) => setFolderRatio('folderTileAspectW', e.target.value)}
                className="h-9 w-16 rounded-md border border-zinc-300 bg-white px-2 text-center text-sm dark:border-zinc-600 dark:bg-zinc-800"
                aria-label="縦横比の横"
              />
              <span className="text-sm text-zinc-500">:</span>
              <input
                type="number"
                min={1}
                max={100}
                value={behavior.folderTileAspectH}
                onChange={(e) => setFolderRatio('folderTileAspectH', e.target.value)}
                className="h-9 w-16 rounded-md border border-zinc-300 bg-white px-2 text-center text-sm dark:border-zinc-600 dark:bg-zinc-800"
                aria-label="縦横比の縦"
              />
            </div>
          </div>
        )}
      </div>

      <div className="px-1 pt-2 text-xs text-zinc-500 dark:text-zinc-400">
        操作設定はこのブラウザに即時保存され、反映のために再読み込み等は不要です。
      </div>
    </div>
  );
}
