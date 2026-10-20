export interface MediaItem {
  id: number;
  type: 'image' | 'video' | 'pdf' | 'music' | 'file';
  path: string;
  folder: string;
  file_name: string;
  ext: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  vcodec: string | null;
  mtime: number;
  thumb_status: 'pending' | 'inprogress' | 'ready' | 'failed';
  status: string;
  view_count: number;
  last_viewed_at: number | null;
  resume_position: number | null;
  library_id: number | null;
  library_path_id: number | null;
  tags?: string[];
}

export interface ItemListResponse {
  items: MediaItem[];
  nextCursor: number | null;
}

export type MediaType = 'image' | 'video' | 'pdf' | 'music' | 'file';

export interface PlayInfo {
  id: number;
  kind: 'native' | 'transcode';
  url: string;
  transcode: { status: TranscodeState; progress: number; message: string | null };
  item: MediaItem;
}

export type TranscodeState = 'none' | 'queued' | 'running' | 'ready' | 'failed' | 'not_needed';

export function thumbUrl(id: number): string {
  return `/api/items/${id}/thumbnail`;
}

export function fileUrl(id: number): string {
  return `/api/items/${id}/file`;
}

export async function getItem(id: number): Promise<MediaItem> {
  const res = await fetch(`/api/items/${id}`);
  if (!res.ok) throw new Error('動画が見つかりません');
  return (await res.json()) as MediaItem;
}

export async function getPlayInfo(id: number): Promise<PlayInfo> {
  const res = await fetch(`/api/items/${id}/play`);
  if (!res.ok) throw new Error('再生情報の取得に失敗しました');
  return (await res.json()) as PlayInfo;
}

export async function requestTranscode(
  id: number,
  force = false,
): Promise<{ status: TranscodeState; progress: number }> {
  const res = await fetch(`/api/items/${id}/transcode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(force ? { force: true } : {}),
  });
  if (!res.ok) throw new Error(`変換の要求に失敗しました (${res.status})`);
  return (await res.json()) as { status: TranscodeState; progress: number };
}

export async function getTranscodeStatus(id: number): Promise<{ status: TranscodeState; progress: number; message: string | null }> {
  const res = await fetch(`/api/items/${id}/transcode/status`);
  if (!res.ok) throw new Error('変換状況の取得に失敗しました');
  return (await res.json()) as { status: TranscodeState; progress: number; message: string | null };
}

export type SortKey = 'id' | 'name' | 'mtime' | 'size';
export type SortOrder = 'asc' | 'desc';

export async function listItems(
  tab: string | undefined,
  cursor: number,
  limit = 60,
  libraryId?: number,
  dir?: string,
  q?: string,
  tags?: string[],
  sort: SortKey = 'id',
  order: SortOrder = 'asc',
  type?: MediaType,
): Promise<ItemListResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (tab) params.set('tab', tab);
  if (type) params.set('type', type);
  if (libraryId !== undefined) params.set('library', String(libraryId));
  if (dir) params.set('dir', dir);
  if (cursor > 0) params.set('cursor', String(cursor));
  if (q && q.trim()) params.set('q', q.trim());
  if (tags && tags.length > 0) params.set('tags', tags.join(','));
  if (sort !== 'id' || order !== 'asc') {
    params.set('sort', sort);
    params.set('order', order);
  }
  const res = await fetch(`/api/items?${params.toString()}`);
  if (!res.ok) throw new Error(`一覧の取得に失敗しました (${res.status})`);
  return (await res.json()) as ItemListResponse;
}

// ---- タグ / 履歴 ----

export interface TagCount {
  id: number;
  name: string;
  count: number;
}

export async function listTags(): Promise<TagCount[]> {
  const res = await fetch('/api/tags');
  if (!res.ok) throw new Error(`タグ一覧の取得に失敗しました (${res.status})`);
  return (await res.json()) as TagCount[];
}

export async function addItemTag(id: number, name: string): Promise<string[]> {
  const res = await fetch(`/api/items/${id}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`タグの追加に失敗しました (${res.status})`);
  return ((await res.json()) as { tags: string[] }).tags;
}

export async function removeItemTag(id: number, name: string): Promise<string[]> {
  const res = await fetch(`/api/items/${id}/tags`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`タグの削除に失敗しました (${res.status})`);
  return ((await res.json()) as { tags: string[] }).tags;
}

export async function deleteTag(id: number): Promise<void> {
  const res = await fetch(`/api/tags/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`タグの削除に失敗しました (${res.status})`);
}

export async function postHistory(id: number): Promise<void> {
  try {
    await fetch(`/api/items/${id}/history`, { method: 'POST' });
  } catch {
    // 履歴の記録失敗は致命的ではない
  }
}

export async function postResume(id: number, position: number): Promise<void> {
  try {
    await fetch(`/api/items/${id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position }),
    });
  } catch {
    // ignore
  }
}

export interface HistoryView {
  items: MediaItem[];
  nextCursor: number | null;
}

export async function listHistory(cursor: number, limit = 60): Promise<HistoryView> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor > 0) params.set('cursor', String(cursor));
  const res = await fetch(`/api/history?${params.toString()}`);
  if (!res.ok) throw new Error(`履歴の取得に失敗しました (${res.status})`);
  return (await res.json()) as HistoryView;
}

export interface FolderEntry {
  /** ライブラリID */
  libraryId: number;
  /** ライブラリ表示名(ルート) */
  name: string;
  /** ライブラリ種別 */
  kind: MediaType;
  /** 所属タブ名 */
  tab: string;
  /** ライブラリルートからの相対ディレクトリ。ルート自体は '' */
  sub: string;
  /** そのディレクトリ以下(サブディレクトリ含む)の active 件数 */
  count: number;
  /** 種別ごとの件数 */
  counts: Partial<Record<MediaType, number>>;
  /** 配下に存在するメディア種別 */
  types: MediaType[];
  /** フォルダタイル用の代表サムネイル(未生成なら null) */
  sampleId: number | null;
  /** 代表サムネイルの元解像度(タイルのアスペクト比決定用) */
  sampleWidth: number | null;
  sampleHeight: number | null;
}

export async function listFolders(): Promise<FolderEntry[]> {
  const res = await fetch('/api/folders');
  if (!res.ok) throw new Error(`フォルダ一覧の取得に失敗しました (${res.status})`);
  return (await res.json()) as FolderEntry[];
}

// ---- ライブラリ / SMB接続 / システム ----

export type LibraryProvider = 'local' | 'smb';

export interface LibraryPath {
  id: number;
  library_id: number;
  provider: LibraryProvider;
  path: string;
  smb_connection_id: number | null;
  enabled: number;
  sort_order: number;
}

export interface Library {
  id: number;
  name: string;
  kind: string;
  tab_name: string;
  extensions: string | null;
  is_default: number;
  enabled: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
  paths: LibraryPath[];
}

export interface LibraryPathInput {
  provider: LibraryProvider;
  path: string;
  smbConnectionId?: number | null;
  enabled?: boolean;
}

export interface LibraryInput {
  name: string;
  tab: string;
  extensions: string[];
  enabled?: boolean;
  paths: LibraryPathInput[];
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${fallback} (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function listLibraries(): Promise<Library[]> {
  const res = await fetch('/api/libraries');
  const body = await jsonOrThrow<{ libraries: Library[] }>(res, 'ライブラリの取得に失敗しました');
  return body.libraries;
}

export async function createLibrary(input: LibraryInput): Promise<Library> {
  const res = await fetch('/api/libraries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<Library>(res, 'ライブラリの作成に失敗しました');
}

export async function updateLibrary(id: number, patch: Partial<LibraryInput>): Promise<Library> {
  const res = await fetch(`/api/libraries/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<Library>(res, 'ライブラリの更新に失敗しました');
}

export async function deleteLibrary(id: number): Promise<void> {
  const res = await fetch(`/api/libraries/${id}`, { method: 'DELETE' });
  await jsonOrThrow<{ ok: boolean }>(res, 'ライブラリの削除に失敗しました');
}

export async function reorderLibraries(ids: number[]): Promise<void> {
  const res = await fetch('/api/libraries/order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  await jsonOrThrow<{ ok: boolean }>(res, '並び替えに失敗しました');
}

export interface SmbConnection {
  id: number;
  name: string;
  host: string;
  share: string;
  username: string;
  drive_letter: string | null;
  auto_mount: number;
  created_at: number;
}

export interface SmbConnectionInput {
  name: string;
  host: string;
  share: string;
  username: string;
  password?: string;
  driveLetter?: string | null;
  autoMount?: boolean;
}

export async function listConnections(): Promise<SmbConnection[]> {
  const res = await fetch('/api/smb-connections');
  const body = await jsonOrThrow<{ connections: SmbConnection[] }>(
    res,
    'SMB 接続一覧の取得に失敗しました',
  );
  return body.connections;
}

export async function createConnection(input: SmbConnectionInput): Promise<SmbConnection> {
  const res = await fetch('/api/smb-connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<SmbConnection>(res, 'SMB 接続の作成に失敗しました');
}

export async function updateConnection(
  id: number,
  input: Partial<SmbConnectionInput>,
): Promise<SmbConnection> {
  const res = await fetch(`/api/smb-connections/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return jsonOrThrow<SmbConnection>(res, 'SMB 接続の更新に失敗しました');
}

export async function deleteConnection(id: number): Promise<void> {
  const res = await fetch(`/api/smb-connections/${id}`, { method: 'DELETE' });
  await jsonOrThrow<{ ok: boolean }>(res, 'SMB 接続の削除に失敗しました');
}

export async function testConnection(
  id: number,
): Promise<{ ok: boolean; basePath: string | null; message: string }> {
  const res = await fetch(`/api/smb-connections/${id}/test`, { method: 'POST' });
  return jsonOrThrow(res, '接続テストに失敗しました');
}

export interface SystemInfo {
  appName: string;
  version: string;
  allowMixedMedia: boolean;
  onlySupportedVideos: boolean;
  scanOnStartup: boolean;
  port: number;
  host: string;
  basicAuthUser: string;
  hasBasicAuth: boolean;
  authRequired: boolean;
  dataDir: string;
}

export async function getSystem(): Promise<SystemInfo> {
  const res = await fetch('/api/system');
  return jsonOrThrow<SystemInfo>(res, 'システム情報の取得に失敗しました');
}

export async function saveSystemSettings(patch: {
  appName?: string;
  allowMixedMedia?: boolean;
  onlySupportedVideos?: boolean;
  scanOnStartup?: boolean;
}): Promise<{
  appName: string;
  version: string;
  allowMixedMedia: boolean;
  onlySupportedVideos: boolean;
  scanOnStartup: boolean;
}> {
  const res = await fetch('/api/system', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<{
    appName: string;
    version: string;
    allowMixedMedia: boolean;
    onlySupportedVideos: boolean;
    scanOnStartup: boolean;
  }>(res, '設定の保存に失敗しました');
}

// ---- 認証 ----

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status');
  if (!res.ok) throw new Error(`認証状態の取得に失敗しました (${res.status})`);
  return (await res.json()) as AuthStatus;
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'ログインに失敗しました');
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}
// ---- サーバー設定 ----

export interface ServerSettings {
  host: string;
  port: number;
  basicAuthUser: string;
  hasBasicAuth: boolean;
}

export interface ServerSettingsInput {
  host: string;
  port: number;
  basicAuthUser: string;
  basicAuthPassword?: string;
}

export async function getServerSettings(): Promise<ServerSettings> {
  const res = await fetch('/api/server-settings');
  return jsonOrThrow<ServerSettings>(res, 'サーバー設定の取得に失敗しました');
}

export async function saveServerSettings(
  input: ServerSettingsInput,
): Promise<{ ok: boolean; restartRequired: boolean } & ServerSettings> {
  const res = await fetch('/api/server-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `保存に失敗しました (${res.status})`);
  }
  return (await res.json()) as { ok: boolean; restartRequired: boolean } & ServerSettings;
}
// ---- スキャン ----

export type ScanMode = 'full' | 'diff';

export interface ScanResultInfo {
  folder: string;
  media: 'image' | 'video' | 'pdf';
  mode: ScanMode;
  total: number;
  inserted: number;
  updated: number;
  removed: number;
  durationMs: number;
}

export interface ScanState {
  running: boolean;
  mode: ScanMode;
  currentIndex: number;
  currentFolder: string | null;
  totalFolders: number;
  results: ScanResultInfo[];
  lastFinishedAt: number | null;
  error: string | null;
}

export interface ThumbQueueState {
  running: boolean;
  processed: number;
  failed: number;
  remaining: number;
  currentIds: number[];
}

export interface ScanCountRow {
  type: string;
  status: string;
  thumb_status: string;
  count: number;
}

export interface AppStatus {
  scan: ScanState;
  thumbs: ThumbQueueState;
  counts: ScanCountRow[];
}

export async function startScan(mode: ScanMode): Promise<ScanState> {
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`スキャンの開始に失敗しました (${res.status})`);
  const body = (await res.json()) as { scan: ScanState };
  return body.scan;
}

export async function getAppStatus(): Promise<AppStatus> {
  const res = await fetch('/api/scan/status');
  if (!res.ok) throw new Error(`スキャン状況の取得に失敗しました (${res.status})`);
  return (await res.json()) as AppStatus;
}

export async function getScanStatus(): Promise<ScanState> {
  return (await getAppStatus()).scan;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 || m > 0 ? String(m).padStart(2, '0') : '0';
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
