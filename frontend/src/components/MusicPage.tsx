import { useEffect, useRef, useState } from 'react';
import {
  fileUrl,
  formatDuration,
  formatSize,
  getItem,
  listItems,
  postHistory,
  type MediaItem,
} from '../api';
import { BackButton, SettingsButton, ThemeButton } from './HeaderControls';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { ThumbImage } from './ThumbImage';

interface MusicPageProps {
  id: number;
  onBack: () => void;
  onNavigate: (id: number) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenSettings?: () => void;
  keepHistory?: boolean;
}

export function MusicPage({
  id,
  onBack,
  onNavigate,
  theme,
  onToggleTheme,
  onOpenSettings,
  keepHistory = true,
}: MusicPageProps) {
  const [item, setItem] = useState<MediaItem | null>(null);
  const [queue, setQueue] = useState<MediaItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const keepHistoryRef = useRef(keepHistory);
  keepHistoryRef.current = keepHistory;

  useEffect(() => {
    let alive = true;
    setItem(null);
    setQueue([]);
    setError(null);
    void (async () => {
      try {
        const it = await getItem(id);
        if (!alive) return;
        setItem(it);
        if (keepHistoryRef.current) void postHistory(id);
        // 同ライブラリ内の曲を再生キューとして取得
        const dirParts = it.file_name.split('\\');
        dirParts.pop();
        const res = await listItems(
          undefined,
          0,
          200,
          it.library_id ?? undefined,
          dirParts.join('\\') || undefined,
          undefined,
          undefined,
          'id',
          'asc',
          'music',
        );
        if (alive) setQueue(res.items);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const index = queue.findIndex((q) => q.id === id);
  const prev = index > 0 ? queue[index - 1] : null;
  const next = index >= 0 && index < queue.length - 1 ? queue[index + 1] : null;

  const title = item ? (item.file_name.split('\\').pop() ?? item.file_name) : '';
  const coverWidth =
    item?.width && item?.height
      ? `min(20rem, ${((item.width / item.height) * 20).toFixed(2)}rem)`
      : '20rem';

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/85 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/85">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5">
          <BackButton onClick={onBack} />
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={item?.file_name}>
            {title || '音楽'}
          </h1>
          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeButton theme={theme} onToggle={onToggleTheme} />
            <SettingsButton onClick={onOpenSettings} />
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8">
        {error ? (
          <div className="text-sm text-zinc-500">{error}</div>
        ) : !item ? (
          <div className="text-sm text-zinc-500">読み込み中...</div>
        ) : (
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10">
            <div className="flex justify-center">
              <ThumbImage
                itemId={item.id}
                alt=""
                className="rounded-xl object-cover shadow-md ring-1 ring-black/10 dark:ring-white/10"
                style={{ width: coverWidth, height: '20rem' }}
              />
            </div>

            <div className="mt-5 truncate text-center text-base font-semibold" title={title}>
              {title}
            </div>
            <div className="mt-1 text-center text-xs text-zinc-500">
              {formatDuration(item.duration) !== '' && (
                <span className="mr-2">{formatDuration(item.duration)}</span>
              )}
              <span>{formatSize(item.size)}</span>
              {index >= 0 && (
                <span className="ml-2">
                  {index + 1} / {queue.length}
                </span>
              )}
            </div>

            <audio
              key={item.id}
              src={fileUrl(item.id)}
              controls
              autoPlay
              className="mt-5 w-full"
              onEnded={() => next && onNavigate(next.id)}
            />

            <div className="mt-4 flex items-center justify-between">
              <button
                onClick={() => prev && onNavigate(prev.id)}
                disabled={!prev}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-zinc-100 px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                <ChevronLeftIcon className="h-4 w-4" />
                前へ
              </button>
              <button
                onClick={() => next && onNavigate(next.id)}
                disabled={!next}
                className="inline-flex h-9 items-center gap-1 rounded-lg bg-zinc-100 px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                次へ
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
