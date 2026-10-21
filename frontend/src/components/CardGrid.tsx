import { memo, useEffect, useRef } from 'react';
import { formatDuration, formatSize, type MediaItem } from '../api';
import { ThumbImage } from './ThumbImage';

interface CardGridProps {
  items: MediaItem[];
  loading: boolean;
  endReached: boolean;
  error: string | null;
  onLoadMore: () => void;
  onOpen: (index: number) => void;
  /** カード幅の基準(操作設定の各タブ設定に連動) */
  thumbHeight?: number;
}

/** サムネイル + 基本情報をウィンドウ幅に応じた複数列で並べる(エクスプローラーの「中アイコン」相当) */
function CardGridBase({
  items,
  loading,
  endReached,
  error,
  onLoadMore,
  onOpen,
  thumbHeight = 280,
}: CardGridProps) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || endReached) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [endReached]);

  const minCardWidth = Math.min(260, Math.max(150, Math.round(thumbHeight * 0.75)));

  return (
    <div>
      {items.length === 0 && loading && (
        <div className="py-10 text-center text-sm text-zinc-500">読み込み中...</div>
      )}
      {error && <div className="py-6 text-center text-sm text-red-500">{error}</div>}

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, 1fr))` }}
      >
        {items.map((item, index) => {
          const badge =
            item.type === 'video'
              ? formatDuration(item.duration)
              : item.type === 'music'
                ? formatDuration(item.duration)
                : '';
          const meta = [item.ext.replace('.', '').toUpperCase(), formatSize(item.size)]
            .filter(Boolean)
            .join(' ・ ');
          return (
            <button
              key={item.id}
              onClick={() => onOpen(index)}
              className="group flex flex-col overflow-hidden rounded-xl bg-white text-left ring-1 ring-black/5 transition-shadow hover:shadow-md dark:bg-zinc-900 dark:ring-white/5"
              title={item.file_name}
            >
              <div className="relative aspect-square w-full overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                <ThumbImage
                  itemId={item.id}
                  retry
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                />
                {badge !== '' && (
                  <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                    {item.type === 'music' ? '♪ ' : '▶ '}
                    {badge}
                  </span>
                )}
                {item.type === 'file' && (
                  <span className="absolute right-1.5 bottom-1.5 rounded-md bg-zinc-700/90 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                    {item.ext.replace('.', '').toUpperCase()}
                  </span>
                )}
                {item.type === 'pdf' && (
                  <span className="absolute right-1.5 bottom-1.5 rounded-md bg-red-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                    PDF
                  </span>
                )}
              </div>
              <div className="min-w-0 px-2.5 py-2">
                <div className="line-clamp-2 text-[12px] leading-tight font-medium">
                  {(item.file_name.split('\\').pop() ?? item.file_name)}
                </div>
                <div className="mt-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                  {meta}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div ref={sentinelRef} className="h-4" />
      {loading && items.length > 0 && (
        <div className="py-3 text-center text-xs text-zinc-500">読み込み中...</div>
      )}
      {endReached && items.length > 0 && (
        <div className="py-3 text-center text-xs text-zinc-400">すべて表示しました</div>
      )}
    </div>
  );
}

export const CardGrid = memo(CardGridBase);
