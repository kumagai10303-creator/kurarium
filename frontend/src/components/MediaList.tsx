import { memo, useEffect, useRef } from 'react';
import { formatDuration, formatSize, thumbUrl, type MediaItem } from '../api';
import { PlayIcon } from './icons';

interface MediaListProps {
  items: MediaItem[];
  loading: boolean;
  endReached: boolean;
  error: string | null;
  onLoadMore: () => void;
  onOpen: (index: number) => void;
  /** サムネイル高さの基準値(操作設定の各タブ設定) */
  thumbHeight?: number;
}

/** サムネイル + 詳細情報の縦1列リスト(エクスプローラーの「詳細」相当) */
function MediaListBase({
  items,
  loading,
  endReached,
  error,
  onLoadMore,
  onOpen,
  thumbHeight = 280,
}: MediaListProps) {
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

  // 行レイアウトではサムネイルをやや控えめなサイズにする(設定値に連動)
  const thumbH = Math.min(200, Math.max(64, Math.round(thumbHeight * 0.5)));

  return (
    <div>
      {items.length === 0 && loading && (
        <div className="py-10 text-center text-sm text-zinc-500">読み込み中...</div>
      )}
      {error && <div className="py-6 text-center text-sm text-red-500">{error}</div>}

      <div className="space-y-2">
        {items.map((item, index) => {
          const aspect =
            item.width && item.height
              ? Math.min(2.4, Math.max(0.6, item.width / item.height))
              : 1;
          const width = Math.round(thumbH * aspect);
          const parts = item.file_name.split('\\');
          const fileName = parts.pop() ?? item.file_name;
          const subDir = parts.join('\\');
          const folderLabel = subDir ? `${item.folder}\\${subDir}` : item.folder;
          const playable = item.type === 'video' || item.type === 'music';

          return (
            <button
              key={item.id}
              onClick={() => onOpen(index)}
              className="group flex w-full items-center gap-4 rounded-xl bg-white p-2.5 text-left ring-1 ring-black/5 transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:ring-white/5 dark:hover:bg-zinc-800/70"
              title={`${fileName} (${formatSize(item.size)})`}
            >
              <div
                className="relative shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800"
                style={{ width, height: thumbH }}
              >
                <img
                  src={thumbUrl(item.id)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                {playable && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                    <PlayIcon className="h-7 w-7 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{fileName}</div>
                <div
                  className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400"
                  title={folderLabel}
                >
                  {folderLabel}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {formatDuration(item.duration) !== '' && (
                    <span>
                      {item.type === 'music' ? '♪ ' : '▶ '}
                      {formatDuration(item.duration)}
                    </span>
                  )}
                  <span>{formatSize(item.size)}</span>
                  <span className="uppercase">{item.ext.replace('.', '')}</span>
                  {item.view_count > 0 && <span>再生 {item.view_count} 回</span>}
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

export const MediaList = memo(MediaListBase);
