import { useCallback, useEffect, useRef, useState } from 'react';
import { listItems, type MediaItem, type SortKey, type SortOrder } from '../api';

interface GalleryState {
  items: MediaItem[];
  loading: boolean;
  endReached: boolean;
  error: string | null;
  loadMore: () => void;
  updateTags: (itemId: number, tags: string[]) => void;
}

export function useGallery(
  tab: string | undefined,
  libraryId: number | undefined,
  dir: string,
  q = '',
  tagFilter: string[] = [],
  sort: SortKey = 'id',
  order: SortOrder = 'asc',
  reloadToken = 0,
): GalleryState {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef(0);
  const loadingRef = useRef(false);
  const resetTokenRef = useRef(0);

  const fetchPage = useCallback(
    async (cursor: number) => {
      if (loadingRef.current || endReached) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const res = await listItems(tab, cursor, 60, libraryId, dir || undefined, q, tagFilter, sort, order);
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          const merged =
            cursor === 0 ? res.items : [...prev, ...res.items.filter((i) => !seen.has(i.id))];
          return merged;
        });
        if (res.nextCursor === null) {
          setEndReached(true);
        } else {
          cursorRef.current = res.nextCursor;
        }
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [tab, libraryId, dir, q, tagFilter, sort, order, endReached, reloadToken],
  );

  useEffect(() => {
    const token = ++resetTokenRef.current;
    resetTokenRef.current = token;
    setItems([]);
    setEndReached(false);
    setError(null);
    cursorRef.current = 0;
    // StrictMode の二重実行や連続フィルタ変更に耐えるよう、
    // 実行中の取得が終わるのを待ってから初期ページを取得する
    void (async () => {
      while (loadingRef.current) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (resetTokenRef.current !== token) return;
      await fetchPage(0);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, libraryId, dir, q, tagFilter, sort, order, reloadToken]);

  const loadMore = useCallback(() => {
    if (!loadingRef.current && !endReached) void fetchPage(cursorRef.current);
  }, [fetchPage, endReached]);

  const updateTags = useCallback((itemId: number, tags: string[]) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, tags } : i)));
  }, []);

  return { items, loading, endReached, error, loadMore, updateTags };
}
