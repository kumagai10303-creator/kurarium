import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Lightbox } from './components/Lightbox';
import { ThumbGrid } from './components/ThumbGrid';
import { WatchPage } from './components/WatchPage';
import { HistoryGrid } from './components/HistoryGrid';
import { SettingsModal } from './components/SettingsModal';
import { PdfPage } from './components/PdfPage';
import { SetupWizard } from './components/SetupWizard';
import { LoginPage } from './components/LoginPage';
import { Logo } from './components/Logo';
import { ThumbImage } from './components/ThumbImage';
import { MusicPage } from './components/MusicPage';
import { MediaList } from './components/MediaList';
import { CardGrid } from './components/CardGrid';
import { useBehaviorSettings, type ListLayout } from './hooks/useBehaviorSettings';
import type { BehaviorSettings } from './hooks/useBehaviorSettings';
import { IconButton, SettingsButton, ThemeButton } from './components/HeaderControls';
import { SearchIcon } from './components/icons';
import { ArrowUpIcon, FolderIcon, ListIcon } from './components/icons';
import {
  LayoutCardsIcon,
  LayoutGridIcon,
  LayoutListIcon,
} from './components/icons';
import { useGallery } from './hooks/useGallery';
import { useTheme } from './hooks/useTheme';
import { useScanStatus } from './hooks/useScanStatus';
import { fileUrl, listFolders, listLibraries, listTags, getSystem, getAuthStatus, postHistory, type FolderEntry, type Library, type MediaItem, type MediaType, type SortKey, type SortOrder, type TagCount } from './api';

/** タブ名(任意文字列)または履歴 */
type Tab = string | 'history' | undefined;

const TAB_KIND: Record<string, MediaType> = {
  '画像': 'image',
  '動画': 'video',
  'PDF': 'pdf',
  '音楽': 'music',
};

const FOLDER_LIST_EXPANDED_KEY = 'nmv-folder-list-expanded';

function initialFolderListExpanded(): boolean {
  try {
    return localStorage.getItem(FOLDER_LIST_EXPANDED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** #/watch/123 のようなハッシュパスを解釈する最小限ルータ */
function parseHash():
  | { page: 'gallery' }
  | { page: 'watch'; id: number }
  | { page: 'pdf'; id: number }
  | { page: 'music'; id: number } {
  const h = window.location.hash.replace(/^#/, '');
  const watchMatch = /^\/watch\/(\d+)$/.exec(h);
  if (watchMatch) return { page: 'watch', id: Number(watchMatch[1]) };
  const pdfMatch = /^\/pdf\/(\d+)$/.exec(h);
  if (pdfMatch) return { page: 'pdf', id: Number(pdfMatch[1]) };
  const musicMatch = /^\/music\/(\d+)$/.exec(h);
  if (musicMatch) return { page: 'music', id: Number(musicMatch[1]) };
  return { page: 'gallery' };
}

export default function App() {
  const [route, setRoute] = useState(parseHash);
  const [tab, setTab] = useState<Tab>(undefined);
  const { theme, toggleTheme } = useTheme();
  const [libraryId, setLibraryId] = useState<number | null>(null);
  const [dir, setDir] = useState('');
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [appName, setAppName] = useState('Kurarium');
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [openSource, setOpenSource] = useState<'gallery' | 'history'>('gallery');
  const [historyItems, setHistoryItems] = useState<MediaItem[]>([]);
  const [historyToken, setHistoryToken] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [tagList, setTagList] = useState<TagCount[]>([]);
  const [behavior, setBehavior] = useBehaviorSettings();
  const keepHistoryRef = useRef(behavior.keepHistory);
  keepHistoryRef.current = behavior.keepHistory;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'libraries' | 'connections' | 'system' | 'behavior'>(
    'libraries',
  );
  const [dataVersion, setDataVersion] = useState(0);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [setupSkipped, setSetupSkipped] = useState(false);
  const [folderListExpanded, setFolderListExpanded] = useState(initialFolderListExpanded);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerRef = useRef<HTMLElement | null>(null);
  const [authStatus, setAuthStatus] = useState<{
    required: boolean;
    authenticated: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(Math.ceil(el.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [route.page]);
  const openSettings = useCallback((nextTab?: 'libraries' | 'connections' | 'system' | 'behavior') => {
    if (nextTab) setSettingsTab(nextTab);
    setSettingsOpen(true);
  }, []);

  const setFolderListMode = useCallback((expanded: boolean) => {
    setFolderListExpanded(expanded);
    try {
      localStorage.setItem(FOLDER_LIST_EXPANDED_KEY, String(expanded));
    } catch {
      // 保存できない環境でも実行中の表示は変更する
    }
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setDataVersion((v) => v + 1);
  }, []);

  const settingsModal = (
    <SettingsModal
      open={settingsOpen}
      onClose={closeSettings}
      behavior={behavior}
      onChangeBehavior={setBehavior}
      initialTab={settingsTab}
      onLibrariesChanged={() => setDataVersion((v) => v + 1)}
    />
  );

  const gallery = useGallery(
    tab === 'history' ? undefined : tab,
    libraryId ?? undefined,
    dir,
    searchQ,
    tagFilter,
    sortKey,
    sortOrder,
    dataVersion,
  );

  useEffect(() => {
    let alive = true;
    Promise.all([listFolders(), listLibraries(), getSystem()])
      .then(([folderList, libraryList, system]) => {
        if (!alive) return;
        setFolders(folderList);
        setLibraries(libraryList);
        setAppName(system.appName);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setDataLoaded(true);
      });
    listTags().then(setTagList).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [dataVersion]);

  useEffect(() => {
    document.title = appName;
  }, [appName]);

  // 検索語のデバウンス
  useEffect(() => {
    const t = window.setTimeout(() => setSearchQ(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((hash: string) => {
    window.location.hash = hash;
    setRoute(parseHash());
  }, []);

  const backToGallery = useCallback(() => {
    navigate('/');
    // 戻った時にギャラリーのスクロール位置を復元
    window.setTimeout(() => window.scrollTo(0, scrollTop), 0);
  }, [navigate, scrollTop]);

  // ロゴクリック: トップ(すべての一覧)へ戻る
  const goHome = useCallback(() => {
    setOpenIndex(null);
    setTab(undefined);
    setLibraryId(null);
    setDir('');
    setSearchInput('');
    setSearchQ('');
    setTagFilter([]);
    navigate('/');
    window.scrollTo(0, 0);
  }, [navigate]);

  const handleOpen = useCallback(
    (source: 'gallery' | 'history', items: { type: string; id: number }[], index: number) => {
      const item = items[index];
      if (!item) return;
      if (item.type === 'video') {
        setScrollTop(window.scrollY);
        setHistoryToken((t) => t + 1);
        navigate(`/watch/${item.id}`);
      } else if (item.type === 'pdf') {
        setScrollTop(window.scrollY);
        setHistoryToken((t) => t + 1);
        navigate(`/pdf/${item.id}`);
      } else if (item.type === 'music') {
        setScrollTop(window.scrollY);
        setHistoryToken((t) => t + 1);
        navigate(`/music/${item.id}`);
      } else if (item.type === 'file') {
        window.open(fileUrl(item.id), '_blank', 'noopener');
      } else {
        if (keepHistoryRef.current) void postHistory(item.id);
        setOpenSource(source);
        setOpenIndex(index);
      }
    },
    [navigate],
  );

  const openGalleryItem = useCallback(
    (index: number) => handleOpen('gallery', gallery.items, index),
    [handleOpen, gallery.items],
  );

  const openHistoryItem = useCallback(
    (items: MediaItem[], index: number) => {
      setHistoryItems(items);
      handleOpen('history', items, index);
    },
    [handleOpen],
  );

  const toggleTag = (name: string) => {
    setTagFilter((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  };

  const lightboxItems = openSource === 'gallery' ? gallery.items : historyItems;

  // 有効なライブラリ(現在のタブで表示対象になるもの)
  const enabledLibraries = useMemo(() => libraries.filter((l) => l.enabled === 1), [libraries]);

  // タブ順はライブラリの並び順(設定画面)からタブ名の初出順で決める
  const tabOrder = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const lib of libraries) {
      const name = lib.tab_name || lib.kind;
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        order.push(name);
      }
    }
    return order;
  }, [libraries]);

  // ライブラリ構成が変わって存在しなくなったタブは「すべて」に戻す
  useEffect(() => {
    if (
      tab !== undefined &&
      tab !== 'history' &&
      !tabOrder.some((name) => name.toLowerCase() === tab.toLowerCase())
    ) {
      setTab(undefined);
    }
  }, [tab, tabOrder]);

  // 履歴を残さない設定では履歴タブ自体を表示しない
  useEffect(() => {
    if (!behavior.keepHistory && tab === 'history') {
      setTab(undefined);
    }
  }, [behavior.keepHistory, tab]);

  const rootFolderByLibrary = useMemo(() => {
    const map = new Map<number, FolderEntry>();
    for (const f of folders) {
      if (f.sub === '') map.set(f.libraryId, f);
    }
    return map;
  }, [folders]);

  // 現在のタブに属するライブラリ
  const tabLibraries = useMemo(() => {
    if (tab === 'history') return [];
    if (tab === undefined) return enabledLibraries;
    return enabledLibraries.filter(
      (l) => (l.tab_name || l.kind).toLowerCase() === tab.toLowerCase(),
    );
  }, [enabledLibraries, tab]);

  const currentLibrary = useMemo(
    () => (libraryId === null ? undefined : enabledLibraries.find((l) => l.id === libraryId)),
    [enabledLibraries, libraryId],
  );

  const parentOfSub = (sub: string): string => {
    const idx = sub.lastIndexOf('\\');
    return idx === -1 ? '' : sub.slice(0, idx);
  };

  // 現在の階層に表示するサブフォルダ(ライブラリ内のみ)
  const childFolders = useMemo(() => {
    if (libraryId === null) return [] as FolderEntry[];
    return folders
      .filter(
        (f) =>
          f.libraryId === libraryId &&
          f.sub !== '' &&
          parentOfSub(f.sub) === dir,
      )
      .sort((a, b) => a.sub.localeCompare(b.sub, 'ja'));
  }, [folders, libraryId, dir]);

  const folderCount = libraryId === null ? tabLibraries.length : childFolders.length;
  const fileSectionTitle = searchQ || tagFilter.length > 0 ? '検索結果' : 'ファイル';
  const fileCount = gallery.endReached ? gallery.items.length : null;

  // タブ切替で現在のライブラリが対象外になったらルートへ戻す
  useEffect(() => {
    if (libraryId === null) return;
    if (tab === 'history') {
      setLibraryId(null);
      setDir('');
      return;
    }
    const lib = libraries.find((l) => l.id === libraryId);
    if (!lib || lib.enabled !== 1) {
      setLibraryId(null);
      setDir('');
      return;
    }
    if (tab !== undefined) {
      if ((lib.tab_name || lib.kind).toLowerCase() !== tab.toLowerCase()) {
        setLibraryId(null);
        setDir('');
      }
    }
  }, [tab, libraryId, libraries]);

  // ライブラリ削除などで無効になったら選択解除
  useEffect(() => {
    if (libraryId !== null && !libraries.some((l) => l.id === libraryId)) {
      setLibraryId(null);
      setDir('');
    }
  }, [libraries, libraryId]);

  // フォルダタイル上ではホイール(縦回転)を横スクロールとして扱う。
  // 行は条件付きでマウントされるため、effectではなくrefで確実に購読する。
  const folderWheelCleanupRef = useRef<(() => void) | null>(null);
  const setFolderRowRef = useCallback(
    (el: HTMLDivElement | null) => {
      folderWheelCleanupRef.current?.();
      folderWheelCleanupRef.current = null;
      if (!el || folderListExpanded) return;
      const onWheel = (e: WheelEvent) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        const max = el.scrollWidth - el.clientWidth;
        if (max <= 0) return;
        if (e.deltaY < 0 ? el.scrollLeft <= 0 : el.scrollLeft >= max - 1) return;
        e.preventDefault();
        el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      folderWheelCleanupRef.current = () => el.removeEventListener('wheel', onWheel);
    },
    [folderListExpanded],
  );

  // フォルダタイルは操作設定の高さ・形(アスペクト)に従う
  const folderAspectOf = (f?: FolderEntry): number => {
    if (behavior.folderTileAspect === 'thumb') {
      if (!f?.sampleWidth || !f?.sampleHeight) return 1.5;
      return Math.min(2.4, Math.max(0.6, f.sampleWidth / f.sampleHeight));
    }
    if (behavior.folderTileAspect === 'custom') {
      const wRatio = Math.min(100, Math.max(1, behavior.folderTileAspectW || 4));
      const hRatio = Math.min(100, Math.max(1, behavior.folderTileAspectH || 3));
      return Math.min(5, Math.max(0.2, wRatio / hRatio));
    }
    const [a, b] = behavior.folderTileAspect.split(':').map(Number);
    return a / b;
  };
  const folderTileWidth = (f: FolderEntry): number =>
    Math.round(behavior.folderTileHeight * folderAspectOf(f));
  const folderTileFallbackWidth = Math.round(behavior.folderTileHeight * 1.5);

  // 「上へ」タイルは直下の先頭タイルと同じ幅・形に揃える
  const firstRootFolder = tabLibraries[0]
    ? rootFolderByLibrary.get(tabLibraries[0].id)
    : undefined;
  const firstTileFolder = libraryId === null ? firstRootFolder : childFolders[0];
  const firstTileWidth = firstTileFolder
    ? folderTileWidth(firstTileFolder)
    : folderTileFallbackWidth;
  const folderGridMinWidth = Math.max(
    120,
    Math.round(behavior.folderTileHeight * folderAspectOf(firstTileFolder)),
  );

  // タブ名から既定種別を引く(カスタムタブは種別なし)
  const activeKind: MediaType | undefined =
    tab !== undefined && tab !== 'history' ? TAB_KIND[tab] : undefined;

  // タブごとにサムネイルの高さを切り替える(すべて/履歴/カスタムは共通設定)
  const activeThumbHeight =
    activeKind === 'image'
      ? behavior.thumbHeightImage
      : activeKind === 'video'
        ? behavior.thumbHeightVideo
        : activeKind === 'pdf'
          ? behavior.thumbHeightPdf
          : activeKind === 'music'
            ? behavior.thumbHeightMusic
            : behavior.thumbHeight;

  // タブごとの一覧レイアウト
  const layoutKey:
    | 'layoutAll'
    | 'layoutImage'
    | 'layoutVideo'
    | 'layoutPdf'
    | 'layoutMusic'
    | 'layoutHistory' =
    tab === 'history'
      ? 'layoutHistory'
      : activeKind === 'image'
        ? 'layoutImage'
        : activeKind === 'video'
          ? 'layoutVideo'
          : activeKind === 'pdf'
            ? 'layoutPdf'
            : activeKind === 'music'
              ? 'layoutMusic'
              : 'layoutAll';
  const activeLayout: ListLayout = behavior[layoutKey];
  const setLayout = (layout: ListLayout) => {
    setBehavior({ [layoutKey]: layout } as Partial<BehaviorSettings>);
  };

  const appStatus = useScanStatus();
  const scanState = appStatus?.scan ?? null;
  const thumbState = appStatus?.thumbs ?? null;
  const thumbCounts = useMemo(() => {
    const processed = thumbState?.processed ?? 0;
    const failed = thumbState?.failed ?? 0;
    const remaining = thumbState?.remaining ?? 0;
    return {
      failed,
      total: thumbState?.total ?? 0,
      completed: processed + failed,
      active: Boolean(thumbState?.running) || remaining > 0,
    };
  }, [thumbState]);
  const [splashDismissed, setSplashDismissed] = useState(false);
  const [overlayMounted, setOverlayMounted] = useState(false);
  const [overlayFading, setOverlayFading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const overlayMountedRef = useRef(false);
  const scanWasRunningRef = useRef(false);
  const thumbWasRunningRef = useRef(false);
  const lastScanFinishedRef = useRef<number | null>(null);
  const splashShownRef = useRef(false);
  const toastTimerRef = useRef(0);
  overlayMountedRef.current = overlayMounted;

  // 起動直後のスキャンのみスプラッシュを表示し、以降のスキャンはヘッダーで示す
  useEffect(() => {
    if (!scanState) return;
    if (scanState.running) {
      scanWasRunningRef.current = true;
      if (!splashDismissed && !splashShownRef.current) {
        splashShownRef.current = true;
        setOverlayMounted(true);
        setOverlayFading(false);
      }
    } else if (scanWasRunningRef.current) {
      scanWasRunningRef.current = false;
      if (overlayMountedRef.current) {
        setOverlayFading(true);
        window.setTimeout(() => setOverlayMounted(false), 500);
      }
      if (scanState.results.length > 0) {
        const total = scanState.results.reduce(
          (acc: { inserted: number; updated: number; removed: number }, r) => ({
            inserted: acc.inserted + r.inserted,
            updated: acc.updated + r.updated,
            removed: acc.removed + r.removed,
          }),
          { inserted: 0, updated: 0, removed: 0 },
        );
        setToast(
          `スキャン完了 新規${total.inserted} / 更新${total.updated} / 削除${total.removed}`,
        );
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
      }
    }
    if (
      scanState.lastFinishedAt !== null &&
      scanState.lastFinishedAt !== lastScanFinishedRef.current
    ) {
      lastScanFinishedRef.current = scanState.lastFinishedAt;
      setDataVersion((v) => v + 1);
    }
  }, [scanState, splashDismissed]);

  useEffect(() => {
    if (!thumbState) return;
    if (thumbState.running) {
      thumbWasRunningRef.current = true;
      return;
    }
    if (thumbWasRunningRef.current && thumbState.remaining === 0) {
      thumbWasRunningRef.current = false;
      setDataVersion((v) => v + 1);
    }
  }, [thumbState]);

  const dismissSplash = () => {
    setSplashDismissed(true);
    setOverlayFading(true);
    window.setTimeout(() => setOverlayMounted(false), 500);
  };

  const scanProgress = scanState?.running
    ? {
        current: Math.max(0, scanState.currentIndex + 1),
        total: scanState.totalFolders,
        folder: scanState.currentFolder,
        mode: scanState.mode,
      }
    : null;

  const toastElement = toast ? (
    <div className="fixed right-4 bottom-4 z-[110] rounded-lg bg-zinc-900/95 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
      {toast}
    </div>
  ) : null;
  const startupOverlay = overlayMounted ? (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-zinc-50 transition-opacity duration-500 dark:bg-zinc-950 ${
        overlayFading ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="w-full max-w-sm px-6 text-center">
        <img src="/logo.svg" alt="" className="mx-auto mb-4 h-16 w-16" />
        <div className="text-base font-semibold">
          {scanProgress ? 'ライブラリをスキャンしています' : '準備が完了しました'}
        </div>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {scanProgress?.mode === 'full'
            ? '初回スキャン(全ファイルを登録中)'
            : '前回からの変更点を確認しています'}
        </div>
        <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full bg-sky-500 transition-[width] duration-500 ${
              scanProgress && scanProgress.total > 0 ? '' : 'w-1/3 animate-pulse'
            }`}
            style={
              scanProgress && scanProgress.total > 0
                ? {
                    width: `${Math.round(
                      (scanProgress.current / scanProgress.total) * 100,
                    )}%`,
                  }
                : undefined
            }
          />
        </div>
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {scanProgress?.folder && <span className="truncate">{scanProgress.folder}</span>}
          {scanProgress && scanProgress.total > 0 && (
            <span className="shrink-0 tabular-nums">
              {scanProgress.current} / {scanProgress.total}
            </span>
          )}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-zinc-400">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-sky-500 dark:border-zinc-600 dark:border-t-sky-400" />
          完了後に自動で切り替わります
        </div>
        <button
          onClick={dismissSplash}
          className="mt-4 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          バックグラウンドで続ける
        </button>
      </div>
    </div>
  ) : null;

  // 認証状態(ログイン要否)の監視
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const check = async () => {
      try {
        const st = await getAuthStatus();
        if (!alive) return;
        setAuthStatus(st);
        timer = window.setTimeout(check, st.required ? 30000 : 60000);
      } catch {
        if (alive) timer = window.setTimeout(check, 10000);
      }
    };
    void check();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  if (authStatus === null) {
    return <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950" />;
  }

  if (authStatus.required && !authStatus.authenticated) {
    return (
      <LoginPage
        onLoggedIn={() => {
          setAuthStatus({ required: true, authenticated: true });
          setDataVersion((v) => v + 1);
        }}
      />
    );
  }
  // ライブラリ未設定(初回起動)時はセットアップ画面を表示
  if (!setupSkipped && dataLoaded && libraries.length === 0) {
    return (
      <SetupWizard
        onComplete={() => setDataVersion((v) => v + 1)}
        onSkip={() => setSetupSkipped(true)}
      />
    );
  }

  if (route.page === 'watch') {
    return (
      <>
        <WatchPage
          id={route.id}
        onBack={backToGallery}
        onHome={goHome}
        onOpenVideo={(id) => {
          setScrollTop(window.scrollY);
          setHistoryToken((t) => t + 1);
          navigate(`/watch/${id}`);
          window.scrollTo(0, 0);
        }}
        sortKey={sortKey}
        sortOrder={sortOrder}
        theme={theme}
        onToggleTheme={toggleTheme}
        onTagsChanged={() => {
          setHistoryToken((t) => t);
        }}
        onTagClick={(tag) => {
          setTab(undefined);
          setTagFilter((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
          navigate('/');
          window.scrollTo(0, 0);
        }}
        keepHistory={behavior.keepHistory}
        onOpenSettings={() => openSettings()}
        />
        {settingsModal}
        {startupOverlay}
        {toastElement}
      </>
    );
  }

  if (route.page === 'pdf') {
    return (
      <>
        <PdfPage
          id={route.id}
          onBack={backToGallery}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenSettings={() => openSettings()}
          keepHistory={behavior.keepHistory}
        />
        {settingsModal}
        {startupOverlay}
        {toastElement}
      </>
    );
  }

  if (route.page === 'music') {
    return (
      <>
        <MusicPage
          id={route.id}
          onBack={backToGallery}
          onNavigate={(musicId) => navigate(`/music/${musicId}`)}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenSettings={() => openSettings()}
          keepHistory={behavior.keepHistory}
        />
        {settingsModal}
        {startupOverlay}
        {toastElement}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header
        ref={headerRef}
        className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/85 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/85"
      >
        {/* 上段: ブランド / 検索 / テーマ・設定 */}
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5">
          <h1 className="flex shrink-0 items-center">
            <button
              onClick={goHome}
              className="flex items-center rounded-lg transition-opacity hover:opacity-80"
              title="トップページへ"
              aria-label="トップページへ"
            >
              <Logo size={40} />
            </button>
          </h1>

          <div className="relative w-full max-w-xl">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              className="h-9 w-full rounded-full border border-zinc-200 bg-zinc-100/70 pr-3 pl-9 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-sky-500 focus:bg-white dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-100 dark:focus:border-sky-500 dark:focus:bg-zinc-800"
              placeholder="ファイル名を検索"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {scanState?.running && (
              <button
                onClick={() => openSettings('libraries')}
                title="スキャン中(クリックで設定)"
                className="flex h-9 items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50"
              >
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                {Math.max(0, scanState.currentIndex + 1)}/{scanState.totalFolders}
              </button>
            )}
            <ThemeButton theme={theme} onToggle={toggleTheme} />
            <SettingsButton onClick={() => openSettings()} />
          </div>
        </div>

        {/* 下段: タブ(下線) / 並び替え・フォルダ */}
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4">
          <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <TabButton active={tab === undefined} onClick={() => setTab(undefined)}>
              すべて
            </TabButton>
            {tabOrder.map((name) => (
              <TabButton key={name} active={tab === name} onClick={() => setTab(name)}>
                {name}
              </TabButton>
            ))}
            {behavior.keepHistory && (
              <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
                履歴
              </TabButton>
            )}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 pb-1">
            <select
              className="h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-700 outline-none transition-colors hover:bg-zinc-50 focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              title="並び替え"
            >
              <option value="id">追加順</option>
              <option value="name">ファイル名</option>
              <option value="mtime">更新日時</option>
              <option value="size">サイズ</option>
            </select>
            <IconButton
              onClick={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
              title={sortOrder === 'asc' ? '昇順(クリックで降順)' : '降順(クリックで昇順)'}
            >
              <span className="text-xs font-semibold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
            </IconButton>
            <IconButton
              title={
                activeLayout === 'thumb'
                  ? 'レイアウト: サムネのみ(クリックで詳細リストへ)'
                  : activeLayout === 'detail'
                    ? 'レイアウト: サムネ + 詳細情報(クリックで基本情報カードへ)'
                    : 'レイアウト: サムネ + 基本情報(クリックでサムネのみへ)'
              }
              onClick={() =>
                setLayout(
                  activeLayout === 'thumb'
                    ? 'detail'
                    : activeLayout === 'detail'
                      ? 'cards'
                      : 'thumb',
                )
              }
            >
              {activeLayout === 'thumb' ? (
                <LayoutGridIcon className="h-[18px] w-[18px]" />
              ) : activeLayout === 'detail' ? (
                <LayoutListIcon className="h-[18px] w-[18px]" />
              ) : (
                <LayoutCardsIcon className="h-[18px] w-[18px]" />
              )}
            </IconButton>
          </div>
        </div>

        {/* タグフィルタチップ */}
        <div className="mx-auto flex max-w-[1600px] items-center gap-1.5 overflow-x-auto px-4 py-2">
          {tagFilter.length > 0 && (
            <span className="mr-1 shrink-0 text-xs font-medium text-zinc-500">
              タグで絞り込み:
            </span>
          )}
          {tagFilter.map((t) => (
            <button
              key={`active-${t}`}
              onClick={() => toggleTag(t)}
              className="shrink-0 rounded-full bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700"
            >
              #{t} ✕
            </button>
          ))}
          {tagList
            .filter((t) => !tagFilter.includes(t.name))
            .slice(0, 30)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => toggleTag(t.name)}
                className="shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                #{t.name} ({t.count})
              </button>
            ))}
        </div>
      </header>

      {thumbCounts.active && thumbCounts.total > 0 && (
        <div
          className="border-b border-sky-200/70 bg-sky-50/80 dark:border-sky-900/50 dark:bg-sky-950/30"
          aria-live="polite"
        >
          <div className="mx-auto max-w-[1600px] px-4 py-2">
            <div className="flex items-center justify-between gap-4 text-xs">
              <div className="flex min-w-0 items-center gap-2 font-medium text-sky-800 dark:text-sky-200">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                <span className="truncate">
                  サムネイル作成中 {thumbCounts.completed.toLocaleString()} /{' '}
                  {thumbCounts.total.toLocaleString()}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sky-700 dark:text-sky-300">
                {thumbCounts.failed > 0 && (
                  <span className="text-amber-700 dark:text-amber-400">
                    失敗 {thumbCounts.failed.toLocaleString()}
                  </span>
                )}
                <span className="font-semibold">
                  {Math.min(
                    100,
                    Math.round((thumbCounts.completed / thumbCounts.total) * 100),
                  )}
                  %
                </span>
              </div>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sky-200/80 dark:bg-sky-900/60">
              <div
                className="h-full rounded-full bg-sky-500 transition-[width] duration-500"
                style={{
                  width: `${Math.min(
                    100,
                    Math.round((thumbCounts.completed / thumbCounts.total) * 100),
                  )}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1600px] px-4 py-6">
        {libraries.length === 0 && (
          <div className="mx-auto mb-6 max-w-xl rounded-xl border border-dashed border-zinc-300 bg-white/60 px-6 py-8 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
            <div className="text-sm font-semibold">ライブラリがまだありません</div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              ローカルフォルダや SMB 共有をライブラリとして追加すると、ここにメディアが表示されます。
            </p>
            <button
              onClick={() => openSettings('libraries')}
              className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700"
            >
              ライブラリを追加
            </button>
          </div>
        )}

        {/* 現在地のパンくず */}
        {tab !== 'history' && libraryId !== null && currentLibrary && (
          <nav
            aria-label="フォルダ階層"
            className="mb-2 flex flex-wrap items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400"
          >
            <button
              onClick={() => {
                setLibraryId(null);
                setDir('');
              }}
              className="rounded px-1.5 py-0.5 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              すべて
            </button>
            <span className="text-zinc-300 dark:text-zinc-600">/</span>
            <button
              onClick={() => setDir('')}
              className={
                dir === ''
                  ? 'px-1.5 py-0.5 font-semibold text-zinc-900 dark:text-white'
                  : 'rounded px-1.5 py-0.5 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white'
              }
            >
              {currentLibrary.name}
            </button>
            {dir.split('\\').filter(Boolean).map((segment, index, segments) => {
              const target = segments.slice(0, index + 1).join('\\');
              const active = index === segments.length - 1;
              return (
                <span key={target} className="flex items-center gap-1">
                  <span className="text-zinc-300 dark:text-zinc-600">/</span>
                  <button
                    onClick={() => setDir(target)}
                    className={
                      active
                        ? 'truncate px-1.5 py-0.5 font-semibold text-zinc-900 dark:text-white'
                        : 'max-w-[200px] truncate rounded px-1.5 py-0.5 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white'
                    }
                    title={segment}
                  >
                    {segment}
                  </button>
                </span>
              );
            })}
          </nav>
        )}

        {/* フォルダ棚(1行/全件を切り替え、ファイル一覧とは別セクションとして扱う) */}
        {tab !== 'history' && (libraryId !== null || tabLibraries.length > 0) && (
          <section
            aria-labelledby="folders-heading"
            className="mb-6 border-b border-zinc-200/80 pb-5 dark:border-zinc-800/80"
          >
            <div
              data-folder-toolbar
              style={{ top: headerHeight }}
              className="sticky z-30 mb-3 flex min-h-11 items-center gap-2.5 border-b border-zinc-200/80 bg-zinc-50/90 py-2 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/90"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400">
                <FolderIcon className="h-4 w-4" />
              </span>
              <h2
                id="folders-heading"
                className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
              >
                フォルダ
              </h2>
              <span
                title={`${folderCount}件`}
                className="rounded-full bg-zinc-200/70 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {folderCount}
              </span>
              <div
                role="group"
                aria-label="フォルダ一覧の表示"
                className="ml-auto flex items-center gap-0.5 rounded-full bg-zinc-200/60 p-0.5 dark:bg-zinc-800/80"
              >
                <button
                  type="button"
                  onClick={() => setFolderListMode(false)}
                  aria-pressed={!folderListExpanded}
                  aria-controls="folder-tiles"
                  aria-label="1行で表示"
                  title="1行で表示"
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    !folderListExpanded
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  <ListIcon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">1行</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFolderListMode(true)}
                  aria-pressed={folderListExpanded}
                  aria-controls="folder-tiles"
                  aria-label="すべて表示"
                  title="すべて表示"
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    folderListExpanded
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  <LayoutGridIcon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">すべて</span>
                </button>
              </div>
            </div>
            <div
              id="folder-tiles"
              key={`${libraryId ?? 'root'}:${dir}`}
              ref={setFolderRowRef}
              data-expanded={folderListExpanded}
              style={
                folderListExpanded
                  ? {
                      gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${folderGridMinWidth}px), 1fr))`,
                    }
                  : undefined
              }
              className={
                folderListExpanded
                  ? 'grid gap-3 pt-1 pb-1'
                  : 'flex gap-2.5 overflow-x-auto overscroll-x-contain pt-1 pb-2'
              }
            >
              {libraryId !== null && (
                <button
                  onClick={() => {
                    if (dir !== '') setDir(parentOfSub(dir));
                    else setLibraryId(null);
                  }}
                  style={
                    folderListExpanded
                      ? { aspectRatio: folderAspectOf(firstTileFolder) }
                      : { width: firstTileWidth, height: behavior.folderTileHeight }
                  }
                  className="group flex w-full max-w-full shrink-0 self-start flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-zinc-300 bg-white/40 text-zinc-500 transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-600 dark:border-zinc-700 dark:bg-zinc-900/30 dark:text-zinc-400 dark:hover:border-sky-700 dark:hover:bg-sky-950/30 dark:hover:text-sky-400"
                  title="一つ上の階層へ"
                  aria-label="一つ上の階層へ"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-zinc-200 transition-colors group-hover:ring-sky-200 dark:bg-zinc-800 dark:ring-zinc-700">
                    <ArrowUpIcon className="h-4 w-4" />
                  </span>
                  <span className="text-[11px] font-medium">上へ</span>
                </button>
              )}

              {libraryId === null
                ? tabLibraries.map((lib) => {
                    const f = rootFolderByLibrary.get(lib.id);
                    const count = f ? f.count : 0;
                    const width = f ? folderTileWidth(f) : folderTileFallbackWidth;
                    return (
                      <button
                        key={`lib-${lib.id}`}
                        onClick={() => {
                          setLibraryId(lib.id);
                          setDir('');
                        }}
                        title={lib.name}
                        style={
                          folderListExpanded
                            ? { aspectRatio: folderAspectOf(f) }
                            : { width, height: behavior.folderTileHeight }
                        }
                        className="group relative w-full max-w-full shrink-0 self-start overflow-hidden rounded-2xl bg-zinc-200 text-left shadow-sm ring-1 ring-black/5 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-2 hover:ring-sky-400/80 active:translate-y-0 active:scale-[0.99] dark:bg-zinc-800 dark:ring-white/5"
                      >
                        {f?.sampleId != null ? (
                          <ThumbImage
                            itemId={f.sampleId}
                            alt=""
                            loading="eager"
                            decoding="async"
                            className="h-full w-full object-cover opacity-90 transition duration-300 group-hover:scale-[1.03] group-hover:opacity-100"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-zinc-400 dark:text-zinc-500">
                            <FolderIcon className="h-10 w-10" />
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2.5 pt-8 pb-2">
                          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-white">
                            <FolderIcon className="h-4 w-4 shrink-0 text-white/75" />
                            <span className="min-w-0 flex-1 truncate">{lib.name}</span>
                            <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white/90 ring-1 ring-white/15 backdrop-blur-sm">
                              {count}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                : childFolders.map((f) => {
                    const label = f.sub.split('\\').pop() ?? f.sub;
                    const count = f.count;
                    return (
                      <button
                        key={`${f.libraryId}-${f.sub}`}
                        onClick={() => setDir(f.sub)}
                        title={`${currentLibrary?.name ?? ''}\\${f.sub}`}
                        style={
                          folderListExpanded
                            ? { aspectRatio: folderAspectOf(f) }
                            : { width: folderTileWidth(f), height: behavior.folderTileHeight }
                        }
                        className="group relative w-full max-w-full shrink-0 self-start overflow-hidden rounded-2xl bg-zinc-200 text-left shadow-sm ring-1 ring-black/5 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:ring-2 hover:ring-sky-400/80 active:translate-y-0 active:scale-[0.99] dark:bg-zinc-800 dark:ring-white/5"
                      >
                        {f.sampleId !== null ? (
                          <ThumbImage
                            itemId={f.sampleId}
                            alt=""
                            loading="eager"
                            decoding="async"
                            className="h-full w-full object-cover opacity-90 transition duration-300 group-hover:scale-[1.03] group-hover:opacity-100"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-zinc-400 dark:text-zinc-500">
                            <FolderIcon className="h-10 w-10" />
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-2.5 pt-8 pb-2">
                          <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-white">
                            <FolderIcon className="h-4 w-4 shrink-0 text-white/75" />
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                            <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white/90 ring-1 ring-white/15 backdrop-blur-sm">
                              {count}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
            </div>
          </section>
        )}
        {tab === 'history' ? (
          <HistoryGrid
            refreshToken={historyToken + dataVersion}
            onOpen={openHistoryItem}
            thumbHeight={behavior.thumbHeight}
            layout={behavior.layoutHistory}
            hoverPreview={behavior.hoverPreview}
            rowWobble={behavior.rowWobble}
            enabled={behavior.keepHistory}
          />
        ) : (
          <section aria-labelledby="files-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2
                id="files-heading"
                className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
              >
                {fileSectionTitle}
              </h2>
              {fileCount !== null && (
                <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  全 {fileCount.toLocaleString('ja-JP')} 件
                </span>
              )}
            </div>
            {activeLayout === 'detail' ? (
              <MediaList
                items={gallery.items}
                loading={gallery.loading}
                endReached={gallery.endReached}
                error={gallery.error}
                onLoadMore={gallery.loadMore}
                onOpen={openGalleryItem}
                thumbHeight={activeThumbHeight}
              />
            ) : activeLayout === 'cards' ? (
              <CardGrid
                items={gallery.items}
                loading={gallery.loading}
                endReached={gallery.endReached}
                error={gallery.error}
                onLoadMore={gallery.loadMore}
                onOpen={openGalleryItem}
                thumbHeight={activeThumbHeight}
              />
            ) : (
              <ThumbGrid
                items={gallery.items}
                loading={gallery.loading}
                endReached={gallery.endReached}
                error={gallery.error}
                onLoadMore={gallery.loadMore}
                onOpen={openGalleryItem}
                hoverPreview={behavior.hoverPreview}
                thumbHeight={activeThumbHeight}
                rowWobble={behavior.rowWobble}
              />
            )}
          </section>
        )}
      </main>

      {openIndex !== null && lightboxItems && lightboxItems[openIndex] && (
        <Lightbox
          items={lightboxItems}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNavigate={(next) => {
            setOpenIndex(next);
            const nextItem = lightboxItems[next];
            if (nextItem && keepHistoryRef.current) void postHistory(nextItem.id);
          }}
          onTagClick={(tag) => {
            setOpenIndex(null);
            toggleTag(tag);
          }}
          onTagsChanged={(itemId, tags) => {
            if (openSource === 'gallery') gallery.updateTags(itemId, tags);
            else setHistoryItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, tags } : i)));
          }}
          wheelNavigate={behavior.wheelNavigate}
          doubleClickFullscreen={behavior.doubleClickFullscreen}
        />
      )}
      {settingsModal}
      {startupOverlay}
        {toastElement}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative shrink-0 px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? 'text-zinc-900 dark:text-white'
          : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
      }`}
    >
      {children}
      <span
        className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-opacity ${
          active ? 'bg-sky-500 opacity-100' : 'opacity-0'
        }`}
      />
    </button>
  );
}
