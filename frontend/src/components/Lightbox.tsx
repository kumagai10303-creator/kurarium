import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fileUrl, formatDuration, formatSize, listTags, type MediaItem, type TagCount } from '../api';
import { TagEditor } from './TagEditor';
import { CloseIcon } from './icons';
import { useModalA11y } from '../hooks/useModalA11y';

interface LightboxProps {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onTagsChanged?: (itemId: number, tags: string[]) => void;
  onTagClick?: (tag: string) => void;
  /** ホイールでの前後切替を許可するか(操作設定) */
  wheelNavigate?: boolean;
  /** ダブルクリックでの全画面切替を許可するか(操作設定) */
  doubleClickFullscreen?: boolean;
}

export function Lightbox({
  items,
  index,
  onClose,
  onNavigate,
  onTagsChanged,
  onTagClick,
  wheelNavigate = true,
  doubleClickFullscreen = true,
}: LightboxProps) {
  const item = items[index];
  const [loadedIds, setLoadedIds] = useState<Set<number>>(new Set());
  // 下層画像: 現在の画像が読み込み完了するまで前の画像を表示し続ける。
  // 読み込み完了(onLoad)と同時に下層を外して一点スワップするため
  // 真っ黒/白になる瞬間はない(フェードは使わない方式)
  const [bottomUid, setBottomUid] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const isVideo = item?.type === 'video';
  const [tagSuggestions, setTagSuggestions] = useState<TagCount[]>([]);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(true, onClose, false, rootRef);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const navCooldownRef = useRef(0);
  const [sceneRef, scene] = useSceneSize();

  useEffect(() => {
    listTags()
      .then(setTagSuggestions)
      .catch(() => undefined);
  }, []);

  const loaded = isVideo || (item !== undefined && loadedIds.has(item.id));

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [index]);

  // ---- 全画面表示 ----
  // ダブルクリックで切替。ブラウザの Esc/F11 でも変化するため
  // 実状態は fullscreenchange で追跡する
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFs(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void el.requestFullscreen().catch(() => undefined);
    }
  }, []);

  // 全画面の出入りで拡大状態をリセット
  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [isFs]);

  // 全画面中は 3 秒マウス操作がなければカーソルを非表示にする
  const [cursorIdle, setCursorIdle] = useState(false);
  useEffect(() => {
    if (!isFs) {
      setCursorIdle(false);
      return;
    }
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      setCursorIdle(false);
      timer = window.setTimeout(() => setCursorIdle(true), 3000);
    };
    schedule();
    window.addEventListener('mousemove', schedule);
    window.addEventListener('mousedown', schedule);
    window.addEventListener('wheel', schedule, { passive: true });
    window.addEventListener('keydown', schedule);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', schedule);
      window.removeEventListener('mousedown', schedule);
      window.removeEventListener('wheel', schedule);
      window.removeEventListener('keydown', schedule);
    };
  }, [isFs]);

  // ---- 事前読み込み・進捗(fetch に統一) ----
  // 旧実装は Image の事前読み込みと進捗 fetch で 2 回ダウンロードし、
  //さらに事前読み込み済み画像も再ダウンロードしていた(進捗バーが毎回
  // 出てちらつく原因)。統一版は「前後5件を含む現在位置の fetch 一本
  // で取得し、blob を <img> の src に渡す」。表示の切替起点は
  // <img> の onLoad(decode 完了)のみ。
  const PRELOAD_RADIUS = 5;
  const blobUrlsRef = useRef<Map<number, string>>(new Map());
  const [blobUrls, setBlobUrls] = useState<Map<number, string>>(new Map());
  const pendingRef = useRef<Map<number, AbortController>>(new Map());
  const currentIdRef = useRef<number | null>(null);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);

  const putBlobUrl = (id: number, url: string) => {
    blobUrlsRef.current.set(id, url);
    setBlobUrls(new Map(blobUrlsRef.current));
  };
  const dropBlobUrl = (id: number) => {
    const url = blobUrlsRef.current.get(id);
    if (!url) return;
    URL.revokeObjectURL(url);
    blobUrlsRef.current.delete(id);
    setBlobUrls(new Map(blobUrlsRef.current));
  };

  useEffect(() => {
    const inWindow = (id: number) => {
      const pos = ids.indexOf(id);
      return pos !== -1 && Math.abs(pos - index) <= PRELOAD_RADIUS;
    };
    currentIdRef.current = ids[index] ?? null;

    // 範囲外になった進行中の fetch と blob を解放
    for (const [id, ac] of pendingRef.current) {
      if (!inWindow(id)) {
        ac.abort();
        pendingRef.current.delete(id);
      }
    }
    for (const id of blobUrlsRef.current.keys()) {
      if (!inWindow(id)) dropBlobUrl(id);
    }
    if (isVideo) {
      setProgress(null);
      return;
    }
    setProgress(null);

    for (let d = -PRELOAD_RADIUS; d <= PRELOAD_RADIUS; d++) {
      const target = index + d;
      if (target < 0 || target >= items.length) continue;
      const id = items[target].id;
      if (pendingRef.current.has(id) || blobUrlsRef.current.has(id)) continue;
      const ac = new AbortController();
      pendingRef.current.set(id, ac);
      void (async () => {
        try {
          const res = await fetch(fileUrl(id), { signal: ac.signal });
          if (!res.ok || !res.body) {
            pendingRef.current.delete(id);
            return;
          }
          const total = Number(res.headers.get('content-length') ?? 0);
          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (currentIdRef.current === id) {
              setProgress({ received, total });
            }
          }
          pendingRef.current.delete(id);
          const blob = new Blob(chunks, { type: res.headers.get('content-type') ?? undefined });
          putBlobUrl(id, URL.createObjectURL(blob));
        } catch {
          pendingRef.current.delete(id);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, isVideo, items, ids]);

  // ライトボックスを閉じた時に全 fetch・blob URL を解放
  useEffect(() => {
    return () => {
      for (const ac of pendingRef.current.values()) ac.abort();
      pendingRef.current.clear();
      for (const url of blobUrlsRef.current.values()) URL.revokeObjectURL(url);
      blobUrlsRef.current.clear();
    };
  }, []);

  // ホイールの振り分けをライトボックス全体に統一:
  // 通常モード: 画像(または動画)の内側 → 拡大縮小(動画は無操作)、
  //             内側の外(左右ゾーン・余白を含む) → 前後切替。
  // 全画面モード(左右ゾーンは非表示): スクロール → 前後切替、
  //             Ctrl+スクロール → 拡大縮小。
  // 上部バー/情報バーでは裏スクロール防止のみ行う
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const target = e.target as Element;
      if (target.closest('[data-lb-chrome]')) return;

      const media =
        isVideo ? videoRef.current : imgRef.current;
      let inside = true;
      if (media) {
        const r = media.getBoundingClientRect();
        inside =
          e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!isFs && !inside) {
          // 通常モードで画像の外側 → 前後切替
        } else if (isFs && !e.ctrlKey) {
          // 全画面モードでは画像内もスクロールで切替
          inside = false;
        }
      }
      if (inside && (!isFs || e.ctrlKey)) {
        if (isVideo) return;
        setZoom((z) => {
          const next = Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
          if (next === 1) setOffset({ x: 0, y: 0 });
          return next;
        });
        return;
      }

      // 前後切替(操作設定でオフのときはキーボード/ボタン専用)
      if (!wheelNavigate) return;
      const now = Date.now();
      if (now - navCooldownRef.current < 30) return;
      navCooldownRef.current = now;
      const next = index + (e.deltaY > 0 ? 1 : -1);
      if (next < 0 || next > items.length - 1) return;
      onNavigate(next);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [index, items.length, onNavigate, isVideo, isFs, wheelNavigate]);

  // 前後遷移時に裏の一覧も対応するサムネイルへ追従スクロール
  const lastScrollIndexRef = useRef<number>(index);
  useEffect(() => {
    if (lastScrollIndexRef.current === index) return;
    lastScrollIndexRef.current = index;
    const el = document.querySelector(`[data-thumb-id="${ids[index] ?? ''}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, [index, ids]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      // 全画面時の Esc はブラウザが全解除に使うためライトボックスは閉じない
      if (document.fullscreenElement) return;
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        if (index > 0) onNavigate(index - 1);
      } else if (e.key === 'ArrowRight') {
        if (index < items.length - 1) onNavigate(index + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onNavigate]);

  const onDoubleClick = () => {
    if (!doubleClickFullscreen) return;
    toggleFullscreen();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1 || isVideo) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setOffset({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="画像ビューア"
      className="fixed inset-0 z-50 flex flex-col bg-black/90"
      style={{ cursor: isFs && cursorIdle ? 'none' : undefined }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 上部バー(全画面では非表示) */}
      {!isFs && (
        <div
          data-lb-chrome
          className="flex shrink-0 items-center justify-between px-4 py-2 text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium tracking-wide text-zinc-200 backdrop-blur-sm">
            {index + 1} / {items.length}
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
            aria-label="閉じる"
            title="閉じる (Esc)"
          >
            <CloseIcon className="h-[18px] w-[18px]" />
          </button>
        </div>
      )}

      {/* メインコンテンツ: 左右の遷移ゾーンは画像枠の外側(余白)に配置。
          全画面モードでは非表示(キーボード/ホイールで切替) */}
      <div className="flex min-h-0 flex-1 select-none">
        {!isFs && (
          <button
            className="group/z flex w-[8%] shrink-0 cursor-w-resize items-center justify-center bg-black/0 transition-colors duration-200 hover:bg-black/40"
            onClick={() => index > 0 && onNavigate(index - 1)}
            aria-label="前へ"
          >
            <span className="block text-4xl leading-none text-white/10 transition-colors duration-200 group-hover/z:text-white/70">
              ‹
            </span>
          </button>
        )}

        <div
          ref={sceneRef}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          {!loaded && !isVideo && (
            <div className="absolute text-sm text-zinc-500">読み込み中...</div>
          )}

          {isVideo ? (
            <video
              key={item.id}
              ref={videoRef}
              src={fileUrl(item.id)}
              className="max-h-full max-w-full"
              controls
              autoPlay
            />
          ) : (
            <LightboxImage
              key={item.id}
              imgRef={imgRef}
              src={blobUrls.get(item.id) ?? (loadedIds.has(item.id) ? fileUrl(item.id) : undefined)}
              bottomSrc={
                bottomUid !== null
                  ? blobUrls.get(bottomUid) ?? fileUrl(bottomUid)
                  : undefined
              }
              item={item}
              bottomItem={
                bottomUid !== null && bottomUid !== item.id
                  ? items.find((i) => i.id === bottomUid) ?? null
                  : null
              }
              scene={scene}
              alt={item.file_name}
              zoom={zoom}
              offset={offset}
              dragging={dragRef.current !== null}
              onReady={() => {
                setBottomUid(item.id);
                setLoadedIds((prev) => {
                  const next = new Set(prev);
                  next.add(item.id);
                  return next;
                });
                setProgress(null);
              }}
              onDoubleClick={onDoubleClick}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          )}

          {!isFs && (
            <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-white/40">
              {zoom > 1
                ? `${zoom.toFixed(1)}倍 (ダブルクリックで全画面)`
                : '画像の上:ホイールで拡大縮小 / 外側:ホイールで切替 / ダブルクリックで全画面'}
            </div>
          )}

          {/* 読み込み進捗バー: 切替先が未読み込みの間のみ右下に表示(情報バーの高さは不変) */}
          {!isVideo && progress && (
            <div className="pointer-events-none absolute right-4 bottom-3 flex items-center gap-2">
              <div className="h-1 w-64 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={
                    progress.total > 0
                      ? 'h-full bg-sky-500 transition-[width] duration-150'
                      : 'h-full w-full animate-pulse bg-sky-500/60'
                  }
                  style={
                    progress.total > 0
                      ? { width: `${Math.min(100, (progress.received / progress.total) * 100)}%` }
                      : undefined
                  }
                />
              </div>
              <span className="text-[10px] text-zinc-400">
                {progress.total > 0
                  ? `${Math.round((progress.received / progress.total) * 100)}%`
                  : '読み込み中...'}
              </span>
            </div>
          )}
        </div>

        {!isFs && (
          <button
            className="group/z flex w-[8%] shrink-0 cursor-e-resize items-center justify-center bg-black/0 transition-colors duration-200 hover:bg-black/40"
            onClick={() => index < items.length - 1 && onNavigate(index + 1)}
            aria-label="次へ"
          >
            <span className="block text-4xl leading-none text-white/10 transition-colors duration-200 group-hover/z:text-white/70">
              ›
            </span>
          </button>
        )}
      </div>

      {/* 情報バー(全画面では非表示) */}
      <div
        data-lb-chrome
        className={`shrink-0 bg-black/60 px-4 py-2 text-xs text-zinc-300 ${isFs ? 'hidden' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="truncate">{item.file_name}</div>
        <div className="text-zinc-500">
          {item.width}×{item.height} / {formatSize(item.size)}
          {item.duration !== null && formatDuration(item.duration) !== '' && (
            <> / {formatDuration(item.duration)}</>
          )}
        </div>
        <div className="mt-1.5">
          <TagEditor
            itemId={item.id}
            tags={item.tags ?? []}
            suggestions={tagSuggestions}
            onChange={(tags) => {
              item.tags = tags;
              onTagsChanged?.(item.id, tags);
            }}
          />
          {onTagClick && item.tags && item.tags.length > 0 && (
            <div className="mt-1 text-[10px] text-zinc-500">
              タグをクリックして絞り込み:{' '}
              {item.tags.map((t) => (
                <button
                  key={`search-${t}`}
                  className="mr-1 underline hover:text-sky-300"
                  onClick={() => onTagClick(t)}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** コンテナ(表示領域)の clientWidth/Height を ResizeObserver で追跡する */
function useSceneSize(initial = { w: 1200, h: 700 }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setSize({
        w: el.clientWidth || initial.w,
        h: el.clientHeight || initial.h,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [ref, size] as const;
}

/** 見切れない範囲での最大表示サイズ(container に aspect を維持して内接) */
function fitRect(item: MediaItem, cw: number, ch: number): { w: number; h: number } {
  const rw = item.width !== null && item.width > 0 ? item.width : 1;
  const rh = item.height !== null && item.height > 0 ? item.height : 1;
  const s = Math.min(cw / rw, ch / rh);
  return { w: Math.max(1, Math.round(rw * s)), h: Math.max(1, Math.round(rh * s)) };
}

/** ライトボックス本体の画像ステージ。<img> と「decode 完了まで表示し
 *  続ける下層画像」を 1 まとめのレンダーツリーにし、remount 毎に
 *  ready 状態が必ず false から始まることで、「最初の描画では下層が
 *  見えている / decode 完了の瞬間に一点スワップ」を全ケースで保証する。
 *  bottomSrc が現在と同一画像でも下層としては無害(同一内容が見えるだけ) */
interface LightboxImageProps {
  imgRef: React.RefObject<HTMLImageElement>;
  src: string | undefined;
  bottomSrc: string | undefined;
  item: MediaItem;
  bottomItem: MediaItem | null;
  scene: { w: number; h: number };
  alt: string;
  zoom: number;
  offset: { x: number; y: number };
  dragging: boolean;
  onReady: () => void;
  onDoubleClick: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
}

function LightboxImage({
  imgRef,
  src,
  bottomSrc,
  item,
  bottomItem,
  scene,
  alt,
  zoom,
  offset,
  dragging,
  onReady,
  onDoubleClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: LightboxImageProps) {
  const [ready, setReady] = useState(false);
  const fit = fitRect(item, scene.w, scene.h);
  const bottomFit = bottomItem ? fitRect(bottomItem, scene.w, scene.h) : { w: 0, h: 0 };
  return (
    <>
      {/* 下層画像: 現在の <img> が decode 完了するまで前の画像を見せ続ける */}
      {!ready && bottomSrc !== undefined && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <img
            src={bottomSrc}
            alt=""
            width={bottomFit.w}
            height={bottomFit.h}
            style={{ width: bottomFit.w, height: bottomFit.h }}
            draggable={false}
          />
        </div>
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        width={fit.w}
        height={fit.h}
        className={`${ready ? 'opacity-100' : 'opacity-0'}`}
        style={{
          width: fit.w,
          height: fit.h,
          transform: `scale(${zoom}) translate(${offset.x / zoom}px, ${offset.y / zoom}px)`,
          cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
        }}
        onLoad={() => {
          setReady(true);
          onReady();
        }}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        draggable={false}
      />
    </>
  );
}
