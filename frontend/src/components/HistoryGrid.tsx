import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { listHistory, type MediaItem } from '../api';
import { ThumbGrid } from './ThumbGrid';
import { MediaList } from './MediaList';
import { CardGrid } from './CardGrid';
import type { ListLayout } from '../hooks/useBehaviorSettings';

function HistoryGridBase({
  onOpen,
  refreshToken,
  thumbHeight,
  layout = 'thumb',
  hoverPreview = true,
  rowWobble = true,
  enabled = true,
}: {
  onOpen: (items: MediaItem[], index: number) => void;
  refreshToken: number;
  thumbHeight?: number;
  layout?: ListLayout;
  hoverPreview?: boolean;
  rowWobble?: boolean;
  enabled?: boolean;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef(0);
  const loadingRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const fetchPage = useCallback(async (cursor: number) => {
    if (!enabledRef.current || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await listHistory(cursor, 60);
      if (!enabledRef.current) return;
      setItems((prev) => {
        if (cursor === 0) return res.items;
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...res.items.filter((i) => !seen.has(i.id))];
      });
      if (res.nextCursor === null) setEndReached(true);
      else cursorRef.current = res.nextCursor;
      setError(null);
    } catch (e) {
      if (enabledRef.current) setError((e as Error).message);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cursorRef.current = 0;
    setItems([]);
    setEndReached(false);
    setError(null);
    if (!enabled) {
      loadingRef.current = false;
      setLoading(false);
      return;
    }
    void fetchPage(0);
  }, [fetchPage, refreshToken, enabled]);

  if (!enabled) return null;

  return (
    <div>
      <p className="mb-2 text-xs text-zinc-500">最近見たアイテム(新しい順)</p>
      {layout === 'detail' ? (
        <MediaList
          items={items}
          loading={loading}
          endReached={endReached}
          error={error}
          onLoadMore={() => void fetchPage(cursorRef.current)}
          onOpen={(index) => onOpen(items, index)}
          thumbHeight={thumbHeight}
        />
      ) : layout === 'cards' ? (
        <CardGrid
          items={items}
          loading={loading}
          endReached={endReached}
          error={error}
          onLoadMore={() => void fetchPage(cursorRef.current)}
          onOpen={(index) => onOpen(items, index)}
          thumbHeight={thumbHeight}
        />
      ) : (
        <ThumbGrid
          items={items}
          loading={loading}
          endReached={endReached}
          error={error}
          onLoadMore={() => void fetchPage(cursorRef.current)}
          onOpen={(index) => onOpen(items, index)}
          thumbHeight={thumbHeight}
          hoverPreview={hoverPreview}
          rowWobble={rowWobble}
        />
      )}
    </div>
  );
}

export const HistoryGrid = memo(HistoryGridBase);
