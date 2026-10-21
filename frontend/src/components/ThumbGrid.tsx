import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { fileUrl, formatSize, formatDuration, type MediaItem } from '../api';
import { ThumbImage } from './ThumbImage';

interface ThumbGridProps {
  items: MediaItem[];
  loading: boolean;
  endReached: boolean;
  error: string | null;
  onLoadMore: () => void;
  onOpen: (index: number) => void;
  /** 動画サムネイルのホバー自動プレビュー(操作設定) */
  hoverPreview?: boolean;
  /** サムネイルの高さ(px、広い画面での基準値) */
  thumbHeight?: number;
  /** 行の高さに ±10% のゆらぎをつけるか(操作設定) */
  rowWobble?: boolean;
}

const GAP = 12;

interface LayoutItem {
  item: MediaItem;
  index: number;
  w: number;
}

interface LayoutRow {
  h: number;
  items: LayoutItem[];
}

function ratioOf(item: MediaItem): number {
  // 縦横比(横/縦)。不明なら正方形扱い
  if (item.width !== null && item.height !== null && item.width > 0 && item.height > 0) {
    return item.width / item.height;
  }
  return 1;
}

/** 行ごとの目標高さのゆらぎ(±10%)。開始インデックスから決定論的に
 *  算出するため、後続ページの追加読み込み後でも既存行の値は変わらない。 */
function rowHeightVariation(rowStartIndex: number): number {
  const x = Math.sin(rowStartIndex * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x); // 0..1
}

/** justified rows: 読み順(左→右)を固定した行レイアウト。
 *  追加読み込みが起きても既存行は再計算されず、表示順が安定する。
 *  各セルは画像本来の縦横比で表示され(見切れ・余白なし)、
 *  wobble=true のとき行の高さに ±10% の決定論的な揺らぎを持たせる。 */
function buildLayout(
  items: MediaItem[],
  width: number,
  targetH: number,
  wobble: boolean,
): LayoutRow[] {
  // ゆらぎ無効時は全行を同じ高さで揃える(行末に余白が出ることは許容)
  if (!wobble) {
    const rows: LayoutRow[] = [];
    let row: { r: number; item: MediaItem; index: number }[] = [];
    let sum = 0;
    const flushUniform = () => {
      if (row.length === 0) return;
      const gaps = GAP * (row.length - 1);
      const h = Math.max(40, Math.min(targetH, (width - gaps) / sum));
      rows.push({
        h: Math.round(h),
        items: row.map((x) => ({
          item: x.item,
          index: x.index,
          w: Math.round(x.r * h),
        })),
      });
      row = [];
      sum = 0;
    };
    for (let i = 0; i < items.length; i++) {
      const r = ratioOf(items[i]);
      if (row.length > 0 && (sum + r) * targetH + GAP * row.length > width) {
        flushUniform();
      }
      row.push({ r, item: items[i], index: i });
      sum += r;
    }
    flushUniform();
    return rows;
  }

  const rows: LayoutRow[] = [];
  const bucket: number[] = [];
  let bucketStart = 0;
  let natural = 0;
  const rowHeight = (start: number) =>
    targetH * (0.9 + 0.2 * rowHeightVariation(start));
  let rowTargetH = rowHeight(0);

  const flush = (isLast: boolean) => {
    const sum = bucket.reduce((a, b) => a + b, 0);
    if (bucket.length === 0 || sum <= 0) {
      bucket.length = 0;
      return;
    }
    const gaps = GAP * (bucket.length - 1);
    // 幅に収める(見切れ・余白なし)。最終行(溢れていない行)は
    // 目標高さのまま右端に余白が出る
    const h = isLast ? rowTargetH : Math.min(rowTargetH, (width - gaps) / sum);
    const cellW: number[] = bucket.map((r) => r * h);
    rows.push({
      h: Math.round(h),
      items: cellW.map((w, k) => ({
        item: items[bucketStart + k],
        index: bucketStart + k,
        w: Math.round(w),
      })),
    });
    bucket.length = 0;
  };

  for (let i = 0; i < items.length; i++) {
    const r = ratioOf(items[i]);
    natural += r * rowTargetH + (bucket.length > 0 ? GAP : 0);
    bucket.push(r);
    if (natural + GAP > width) {
      flush(false);
      bucketStart = i + 1;
      natural = 0;
      // 次の行の目標高さを決定(±10% のゆらぎ / 無効時は固定)
      rowTargetH = rowHeight(bucketStart);
    }
  }
  if (bucket.length > 0) flush(width < 40);
  return rows;
}

function useContainerWidth(initial = 1200): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function ThumbGridBase({ items, loading, endReached, error, onLoadMore, onOpen, hoverPreview = true, thumbHeight = 280, rowWobble = true }: ThumbGridProps) {
  const [containerRef, width] = useContainerWidth(1400);
  // 画面幅が狭いときは設定値から自動で縮小する
  const targetH =
    width < 700
      ? Math.max(100, Math.round(thumbHeight * 0.6))
      : width < 1100
        ? Math.max(120, Math.round(thumbHeight * 0.8))
        : thumbHeight;

  const rows = useMemo(
    () => buildLayout(items, Math.max(320, width), targetH, rowWobble),
    [items, width, targetH, rowWobble],
  );

  return (
    <div ref={containerRef} className="min-w-0">
      {rows.map((row, ri) => (
        <div
          key={ri}
          className="flex justify-center"
          style={{
            gap: GAP,
            height: row.h,
            marginBottom: GAP,
            contentVisibility: 'auto',
            containIntrinsicSize: `${row.h}px`,
          }}
        >
          {row.items.map(({ item, index, w }) => (
            <ThumbCard
              key={item.id}
              item={item}
              index={index}
              width={w}
              height={row.h}
              onOpen={onOpen}
              hoverPreview={hoverPreview}
            />
          ))}
        </div>
      ))}
      <div className="py-6 text-center text-sm text-zinc-400">
        {error ? (
          <span className="text-red-500">{error}</span>
        ) : loading ? (
          '読み込み中...'
        ) : endReached ? (
          items.length > 0 ? (
            `全 ${items.length} 件`
          ) : (
            '該当するファイルがありません'
          )
        ) : (
          <InfiniteSentinel onLoadMore={onLoadMore} />
        )}
      </div>
    </div>
  );
}

function InfiniteSentinel({ onLoadMore }: { onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          loadMoreRef.current();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref}>▼</div>;
}

interface ThumbCardProps {
  item: MediaItem;
  index: number;
  width: number;
  height: number;
  onOpen: (index: number) => void;
  hoverPreview?: boolean;
}

const ThumbCard = memo(function ThumbCard({ item, index, width, height, onOpen, hoverPreview = true }: ThumbCardProps) {
  const isVideo = item.type === 'video';
  // 動画サムネイルのホバー自動再生(インライン)。再生開始まで
  // サムネイル画像を見せ続けるため黒いフレームは出ない
  const [previewing, setPreviewing] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const startPreview = () => {
    if (!isVideo || !hoverPreview) return;
    setPreviewReady(false);
    setPreviewing(true);
  };
  const stopPreview = () => {
    setPreviewing(false);
    setPreviewReady(false);
  };
  return (
    <button
      data-thumb-id={item.id}
      className="group relative shrink-0 overflow-hidden rounded-xl bg-zinc-100 shadow-sm ring-1 ring-black/5 transition hover:shadow-md dark:bg-zinc-800 dark:ring-white/5"
      style={{ width, height }}
      onClick={() => onOpen(index)}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      title={previewing ? undefined : `${item.file_name} (${formatSize(item.size)})`}
    >
      <ThumbImage
        itemId={item.id}
        retry={item.thumb_status !== 'failed'}
        alt={item.file_name}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
      />
      {previewing && (
        <video
          src={fileUrl(item.id)}
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${
            previewReady ? 'opacity-100' : 'opacity-0'
          }`}
          autoPlay
          loop
          muted
          playsInline
          onPlaying={() => setPreviewReady(true)}
        />
      )}
      {item.thumb_status === 'failed' && (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
          サムネイル生成不可
        </span>
      )}
      {isVideo && (
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          ▶ {formatDuration(item.duration)}
        </span>
      )}
      {item.type === 'pdf' && (
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-red-600/90 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          PDF
        </span>
      )}
      {item.type === 'file' && (
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-zinc-700/90 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          {item.ext.replace('.', '').toUpperCase()}
        </span>
      )}
      {item.type === 'music' && (
        <span className="absolute right-1.5 bottom-1.5 rounded-md bg-emerald-600/90 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          ♪ {formatDuration(item.duration)}
        </span>
      )}
      {!previewReady && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/60 to-transparent p-2 text-left text-[11px] leading-tight text-white line-clamp-2 group-hover:block">
          {item.file_name}
        </span>
      )}
    </button>
  );
});

export const ThumbGrid = memo(ThumbGridBase);
