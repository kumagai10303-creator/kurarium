import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fileUrl, getItem, postHistory, type MediaItem } from '../api';
import { BackButton, SettingsButton, ThemeButton, iconBtnClass } from './HeaderControls';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ExternalLinkIcon,
  ListIcon,
} from './icons';

interface PdfPageProps {
  id: number;
  onBack: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenSettings?: () => void;
  keepHistory?: boolean;
}

const PAGE_PADDING = 16;
const WHEEL_COOLDOWN_MS = 30;
const THUMB_WIDTH = 128;
/** ページ一覧サムネイルの同時描画数(pdfjs の render は重いため制限する) */
const MAX_CONCURRENT_THUMB_RENDERS = 4;
let activeThumbRenders = 0;
const thumbWaiters: (() => void)[] = [];

function acquireThumbSlot(): Promise<void> {
  if (activeThumbRenders < MAX_CONCURRENT_THUMB_RENDERS) {
    activeThumbRenders++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    thumbWaiters.push(() => {
      activeThumbRenders++;
      resolve();
    });
  });
}

function releaseThumbSlot(): void {
  activeThumbRenders--;
  const next = thumbWaiters.shift();
  if (next) next();
}

/** 表示領域の実寸を ResizeObserver で追跡する */
function useSceneSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function PdfPage({
  id,
  onBack,
  theme,
  onToggleTheme,
  onOpenSettings,
  keepHistory = true,
}: PdfPageProps) {
  const [item, setItem] = useState<MediaItem | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showThumbs, setShowThumbs] = useState(true);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);
  const keepHistoryRef = useRef(keepHistory);
  keepHistoryRef.current = keepHistory;

  const [sceneRef, scene] = useSceneSize();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const wheelCooldownRef = useRef(0);

  // 文書の読み込み
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    setDoc(null);
    setNumPages(0);
    setPage(1);
    setError(null);
    setLoading(true);

    void (async () => {
      try {
        const it = await getItem(id);
        if (cancelled) return;
        setItem(it);
        if (keepHistoryRef.current) void postHistory(id);

        const res = await fetch(fileUrl(id), { signal: ac.signal });
        if (!res.ok) throw new Error(`PDF の取得に失敗しました (${res.status})`);
        const data = new Uint8Array(await res.arrayBuffer());
        // pdfjs 本体は PDF を開いたときだけ読み込む(初期表示を軽く保つ)
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        // フォント(CJK)・JPX デコーダ・色プロファイルの補助リソースは
        // public/pdfjs/ に同梱したものを使う(オフラインでも欠けずに描画)
        const assetBase = `${import.meta.env.BASE_URL}pdfjs`;
        const pdf = await pdfjs.getDocument({
          data,
          cMapUrl: `${assetBase}/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assetBase}/standard_fonts/`,
          wasmUrl: `${assetBase}/wasm/`,
          iccUrl: `${assetBase}/iccs/`,
        }).promise;
        if (cancelled) {
          void (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
          return;
        }
        setDoc(pdf);
        setNumPages(pdf.numPages);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [id]);

  // アンマウント時に文書を破棄
  useEffect(() => {
    return () => {
      const current = doc as unknown as { destroy?: () => Promise<void> } | null;
      if (current?.destroy) void current.destroy();
    };
  }, [doc]);

  // ページ描画(表示領域に fit、高 DPI 対応)
  useEffect(() => {
    if (!doc || scene.w === 0 || scene.h === 0) return;
    let cancelled = false;

    void (async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const scale = Math.max(
          0.05,
          Math.min(
            (scene.w - PAGE_PADDING * 2) / base.width,
            (scene.h - PAGE_PADDING * 2) / base.height,
          ),
        );
        const viewport = p.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        renderTaskRef.current?.cancel();
        const task = p.render({
          canvasContext: ctx,
          viewport,
          canvas,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTaskRef.current = task;
        try {
          await task.promise;
        } catch (e) {
          if ((e as { name?: string }).name !== 'RenderingCancelledException') throw e;
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, page, scene.w, scene.h]);

  const go = useCallback(
    (delta: number) => {
      setPage((p) => Math.min(numPages, Math.max(1, p + delta)));
    },
    [numPages],
  );

  // ホイールでページ送り(連続スクロールはしない)
  useEffect(() => {
    const el = sceneRef.current;
    if (!el || numPages === 0) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - wheelCooldownRef.current < WHEEL_COOLDOWN_MS) return;
      wheelCooldownRef.current = now;
      go(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [sceneRef, numPages, go]);

  // キーボード操作
  useEffect(() => {
    if (numPages === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setPage(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        setPage(numPages);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages, go]);

  // 現在ページが変わったらページ一覧内の該当サムネイルが見える位置へ
  useEffect(() => {
    if (!showThumbs) return;
    activeThumbRef.current?.scrollIntoView({ block: 'nearest' });
  }, [page, showThumbs]);

  const itemName = item ? item.file_name.split('\\').pop() : '';

  return (
    <div className="flex h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="shrink-0 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <BackButton onClick={onBack} />
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={itemName}>
            {itemName || 'PDF'}
          </h1>
          {numPages > 0 && (
            <div className="flex h-9 shrink-0 items-center overflow-hidden rounded-lg border border-zinc-300 bg-white text-sm dark:border-zinc-700 dark:bg-zinc-800">
              <button
                onClick={() => go(-1)}
                disabled={page <= 1}
                className="h-full px-2.5 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-700"
                aria-label="前のページ"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const input = (e.currentTarget.elements.namedItem('pagenum') as HTMLInputElement);
                  const n = Number(input.value);
                  if (Number.isInteger(n)) setPage(Math.min(numPages, Math.max(1, n)));
                }}
                className="h-full"
              >
                <input
                  name="pagenum"
                  key={page}
                  defaultValue={page}
                  inputMode="numeric"
                  className="h-full w-12 border-x border-zinc-300 bg-transparent px-1 text-center text-sm outline-none focus:bg-sky-50 dark:border-zinc-700 dark:focus:bg-zinc-700"
                  aria-label="ページ番号"
                />
              </form>
              <span className="px-2 text-xs text-zinc-500">/ {numPages}</span>
              <button
                onClick={() => go(1)}
                disabled={page >= numPages}
                className="h-full px-2.5 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-700"
                aria-label="次のページ"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => setShowThumbs((v) => !v)}
              disabled={numPages === 0}
              className={iconBtnClass(showThumbs)}
              title={showThumbs ? 'ページ一覧を隠す' : 'ページ一覧を表示'}
              aria-label="ページ一覧の表示切替"
            >
              <ListIcon className="h-4 w-4" />
            </button>
            <a
              href={fileUrl(id)}
              target="_blank"
              rel="noreferrer"
              className={iconBtnClass()}
              title="ブラウザ標準ビューアで別タブで開く"
              aria-label="別タブで開く"
            >
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
            <ThemeButton theme={theme} onToggle={onToggleTheme} />
            <SettingsButton onClick={onOpenSettings} />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div ref={sceneRef} className="relative min-h-0 flex-1 overflow-hidden bg-zinc-200/60 dark:bg-black">
        {error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-500">
            {error}
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            読み込み中...
          </div>
        ) : (
          <>
            <div className="flex h-full w-full items-center justify-center">
              <canvas ref={canvasRef} className="shadow-lg" />
            </div>

            {numPages > 1 && (
              <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs text-white/80">
                {page} / {numPages} ・ ホイール/←→ でページ送り
              </div>
            )}
          </>
        )}
        </div>

        {showThumbs && !error && !loading && doc && (
          <aside className="flex w-44 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <span className="text-xs font-medium text-zinc-500">
                ページ一覧 ({numPages})
              </span>
              <button
                onClick={() => setShowThumbs(false)}
                className="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="ページ一覧を閉じる"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {Array.from({ length: numPages }, (_, i) => {
                const n = i + 1;
                return (
                  <PageThumb
                    key={n}
                    doc={doc}
                    pageNumber={n}
                    active={page === n}
                    onSelect={setPage}
                    buttonRef={page === n ? activeThumbRef : undefined}
                  />
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

interface PageThumbProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  onSelect: (page: number) => void;
  buttonRef?: React.MutableRefObject<HTMLButtonElement | null>;
}

function PageThumb({ doc, pageNumber, active, onSelect, buttonRef }: PageThumbProps) {
  const holderRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  // 画面内に入ったものだけ描画する(ページ数の多いPDFでも軽い)
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    void (async () => {
      await acquireThumbSlot();
      try {
        if (cancelled) return;
        const p = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        const viewport = p.getViewport({ scale: THUMB_WIDTH / base.width });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const task = p.render({
          canvasContext: ctx,
          viewport,
          canvas,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        try {
          await task.promise;
        } catch (e) {
          if ((e as { name?: string }).name !== 'RenderingCancelledException') throw e;
        }
        if (!cancelled) setRendered(true);
      } finally {
        releaseThumbSlot();
      }
    })().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [visible, doc, pageNumber]);

  return (
    <button
      ref={(el) => {
        holderRef.current = el;
        if (buttonRef) buttonRef.current = el;
      }}
      onClick={() => onSelect(pageNumber)}
      className={`relative block w-full overflow-hidden rounded border bg-zinc-100 text-left transition dark:bg-zinc-800 ${
        active
          ? 'border-sky-500 ring-2 ring-sky-400'
          : 'border-zinc-200 hover:border-sky-400 dark:border-zinc-700'
      }`}
      aria-label={`ページ ${pageNumber} を表示`}
    >
      <span className={`flex items-center justify-center ${rendered ? '' : 'animate-pulse'}`}>
        <canvas ref={canvasRef} className="block max-w-full" />
      </span>
      <span
        className={`absolute right-0 bottom-0 rounded-tl bg-black/70 px-1.5 py-0.5 text-[10px] ${
          active ? 'text-sky-300' : 'text-white/90'
        }`}
      >
        {pageNumber}
      </span>
    </button>
  );
}
