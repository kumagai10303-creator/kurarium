import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPlayInfo,
  getTranscodeStatus,
  getItem,
  listItems,
  listTags,
  postHistory,
  postResume,
  requestTranscode,
  thumbUrl,
  formatDuration,
  formatSize,
  type MediaItem,
  type PlayInfo,
  type SortKey,
  type SortOrder,
  type TagCount,
} from '../api';
import { TagEditor } from './TagEditor';
import { BackButton, SettingsButton, ThemeButton } from './HeaderControls';
import { Logo } from './Logo';

interface WatchPageProps {
  id: number;
  onBack: () => void;
  onHome: () => void;
  onOpenVideo: (id: number) => void;
  sortKey: SortKey;
  sortOrder: SortOrder;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onTagsChanged?: (itemId: number, tags: string[]) => void;
  onTagClick?: (tag: string) => void;
  /** 閲覧履歴を残すか(操作設定) */
  keepHistory?: boolean;
  /** 設定モーダルを開く */
  onOpenSettings?: () => void;
}

export function WatchPage({
  id,
  onBack,
  onHome,
  onOpenVideo,
  sortKey,
  sortOrder,
  theme,
  onToggleTheme,
  onTagsChanged,
  onTagClick,
  keepHistory = true,
  onOpenSettings,
}: WatchPageProps) {
  const [item, setItem] = useState<MediaItem | null>(null);
  const [play, setPlay] = useState<PlayInfo | null>(null);
  const [related, setRelated] = useState<MediaItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<TagCount[]>([]);
  const pollRef = useRef<number | null>(null);
  const aliveRef = useRef(false);
  // 操作設定は参照のみで再初期化を引き起こさないように ref 経由で使う
  const keepHistoryRef = useRef(keepHistory);
  keepHistoryRef.current = keepHistory;

  const pollIfNeeded = useCallback(
    (pi: PlayInfo, vid: number) => {
      if (pi.kind === 'native' || pi.transcode.status === 'ready') return;
      const tick = async () => {
        try {
          const st = await getTranscodeStatus(vid);
          if (!aliveRef.current) return;
          setPlay((p) =>
            p
              ? { ...p, transcode: { status: st.status, progress: st.progress, message: st.message } }
              : p,
          );
          if (st.status === 'ready' || st.status === 'failed') return;
          pollRef.current = window.setTimeout(tick, 2000);
        } catch {
          if (!aliveRef.current) return;
          pollRef.current = window.setTimeout(tick, 3000);
        }
      };
      if (pi.transcode.status === 'queued' || pi.transcode.status === 'running') {
        pollRef.current = window.setTimeout(tick, 2000);
      } else {
        // 未要求なら自動で変換を開始
        void requestTranscode(vid)
          .then((res) => {
            if (!aliveRef.current) return;
            setPlay((p) =>
              p ? { ...p, transcode: { status: res.status, progress: 0, message: null } } : p,
            );
            pollRef.current = window.setTimeout(tick, 2000);
          })
          .catch((e) => aliveRef.current && setError((e as Error).message));
      }
    },
    [],
  );

  // プレイヤー情報の初期取得+変換待ちポーリング
  useEffect(() => {
    aliveRef.current = true;
    setItem(null);
    setPlay(null);
    setError(null);

    void (async () => {
      try {
        const it = await getItem(id);
        if (!aliveRef.current) return;
        setItem(it);
        const pi = await getPlayInfo(id);
        if (!aliveRef.current) return;
        setPlay(pi);
        pollIfNeeded(pi, id);
        // 閲覧履歴を記録(操作設定でオフなら記録しない)
        if (keepHistoryRef.current) void postHistory(id);
      } catch (e) {
        if (aliveRef.current) setError((e as Error).message);
      }
    })();

    return () => {
      aliveRef.current = false;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 関連動画: 同ライブラリの動画を指定並び順で並べ、再生中の動画に近い順にする
  useEffect(() => {
    let alive = true;
    if (item === null) return;
    const libraryId = item.library_id ?? undefined;
    const dirParts = item.file_name.split('\\');
    dirParts.pop();
    const dir = dirParts.join('\\');
    void (async () => {
      try {
        const all: MediaItem[] = [];
        let cursor = 0;
        for (;;) {
          const res = await listItems(
            undefined,
            cursor,
            200,
            libraryId,
            dir || undefined,
            undefined,
            undefined,
            sortKey,
            sortOrder,
            'video',
          );
          const ids = new Set(all.map((v) => v.id));
          all.push(...res.items.filter((v) => !ids.has(v.id)));
          const foundAt = all.findIndex((v) => v.id === id);
          // 現在の動画の前後十分な範囲が取れたら打ち止め
          if (foundAt >= 0 && all.length - foundAt > 60) break;
          if (res.nextCursor === null || all.length > 600) break;
          cursor = res.nextCursor;
        }
        const foundAt = all.findIndex((v) => v.id === id);
        const related: MediaItem[] = [];
        if (foundAt >= 0) {
          const maxDist = Math.max(foundAt, all.length - 1 - foundAt);
          for (let d = 1; d <= maxDist && related.length < 40; d++) {
            if (foundAt - d >= 0) related.push(all[foundAt - d]);
            if (related.length >= 40) break;
            if (foundAt + d < all.length) related.push(all[foundAt + d]);
          }
        } else {
          // 見つけられなかった場合は並び順の先頭から(従来互換)
          related.push(...all.filter((v) => v.id !== id).slice(0, 40));
        }
        if (alive) setRelated(related);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item !== null, item?.folder, id, sortKey, sortOrder]);

  // タグ候補
  useEffect(() => {
    listTags()
      .then(setTagSuggestions)
      .catch(() => undefined);
  }, [item === null]);

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-200">
        <div className="mx-auto max-w-[1400px] px-4 py-8">
          <button
            onClick={onBack}
            className="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
          >
            ← 戻る
          </button>
          <p className="mt-4 text-red-500 dark:text-red-400">{error}</p>
        </div>
      </div>
    );
  }
  if (!item || !play) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-400 dark:bg-zinc-950 dark:text-zinc-400">
        読み込み中...
      </div>
    );
  }

  const playerReady =
    play.kind === 'native' || play.transcode.status === 'ready';

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5">
          <BackButton onClick={onBack} />
          <h1 className="shrink-0">
            <button
              onClick={onHome}
              className="flex items-center rounded-lg transition-opacity hover:opacity-80"
              title="トップページへ"
              aria-label="トップページへ"
            >
              <Logo size={34} />
            </button>
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <ThemeButton theme={theme} onToggle={onToggleTheme} />
            <SettingsButton onClick={onOpenSettings} />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1400px] grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          {/* プレイヤー: 実動画のアスペクト比に枠を追随させ、縦長動画でも
              縮小率が最小になるようにする(高さは 80vh で上限) */}
          <div
            className="mx-auto w-full overflow-hidden rounded-2xl bg-black shadow-sm ring-1 ring-black/5 dark:ring-white/10"
            style={{
              aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : '16 / 9',
              maxHeight: '80vh',
            }}
          >
            {playerReady ? (
              <PlayerWithFallback
                src={play.url}
                poster={thumbUrl(item.id)}
                resumePosition={item.resume_position}
                onProgress={(pos) => void postResume(item.id, pos)}
                onPlaybackError={() => {
                  // vcodec 判定が甘かった場合(hevc など)に変換へフォールバック
                  void requestTranscode(id, true).then(() =>
                    getPlayInfo(id).then((p) => {
                      setPlay(p);
                      pollIfNeeded(p, id);
                    }),
                  );
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <div className="text-4xl">🎬</div>
                <div className="text-sm text-zinc-300">
                  {play.transcode.status === 'failed' ? (
                    <>変換に失敗しました。この形式は再生できません。</>
                  ) : (
                    <>
                      ブラウザ再生できない形式 ({item.ext}) のため、MP4 に変換しています...
                    </>
                  )}
                </div>
                {play.transcode.status !== 'failed' && (
                  <div className="w-64">
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full bg-sky-500 transition-all duration-500"
                        style={{ width: `${Math.max(3, play.transcode.progress)}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-zinc-400">
                      {play.transcode.progress}% 完了
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 情報 */}
          <div className="mt-4">
            <h2 className="text-lg font-semibold leading-snug">{item.file_name}</h2>
            {item.tags && (
              <div className="mt-1">
                <TagEditor
                  itemId={item.id}
                  tags={item.tags}
                  suggestions={tagSuggestions}
                  onChange={(tags) => {
                    setItem((prev) => (prev ? { ...prev, tags } : prev));
                    onTagsChanged?.(id, tags);
                  }}
                />
                  {onTagClick && item.tags.length > 0 && (
                  <div className="mt-1 text-[10px] text-zinc-500">
                    タグをクリックして絞り込み:{' '}
                    {item.tags.map((t) => (
                      <button
                        key={`search-${t}`}
                        className="mr-1 underline hover:text-sky-700 dark:hover:text-sky-300"
                        onClick={() => onTagClick(t)}
                      >
                        #{t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="rounded bg-zinc-200 px-2 py-0.5 dark:bg-zinc-800">フォルダ: {item.folder}</span>
              <span className="rounded bg-zinc-200 px-2 py-0.5 dark:bg-zinc-800">{item.ext}</span>
              {play.kind === 'native' && (
                <span className="rounded bg-emerald-600/20 px-2 py-0.5 text-emerald-700 dark:bg-emerald-800/60 dark:text-emerald-300">
                  直接再生
                </span>
              )}
              {play.kind === 'transcode' && play.transcode.status === 'ready' && (
                <span className="rounded bg-amber-600/20 px-2 py-0.5 text-amber-700 dark:bg-amber-800/60 dark:text-amber-300">
                  変換済み配信
                </span>
              )}
              {(item.width ?? 0) > 0 && (
                <span className="rounded bg-zinc-200 px-2 py-0.5 dark:bg-zinc-800">
                  {item.width}×{item.height}
                </span>
              )}
              {item.duration !== null && formatDuration(item.duration) !== '' && (
                <span className="rounded bg-zinc-200 px-2 py-0.5 dark:bg-zinc-800">{formatDuration(item.duration)}</span>
              )}
              {item.vcodec && <span className="rounded bg-zinc-200 px-2 py-0.5 dark:bg-zinc-800">{item.vcodec}</span>}
              <span className="rounded bg-zinc-200 px-2 py-0.5 dark:bg-zinc-800">{formatSize(item.size)}</span>
            </div>
          </div>
        </div>

        {/* 関連動画 */}
        <aside>
          <h3 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
            関連動画 (同じフォルダ・近い順)
          </h3>
          <div className="flex flex-col gap-3">
            {related.slice(0, 40).map((v) => (
              <button
                key={v.id}
                className="flex gap-3 rounded-lg bg-zinc-100 p-2 text-left transition hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                onClick={() => onOpenVideo(v.id)}
              >
                <img
                  src={thumbUrl(v.id)}
                  alt=""
                  className="h-14 w-24 shrink-0 rounded object-cover"
                  loading="lazy"
                />
                <div className="min-w-0">
                  <div className="line-clamp-2 text-xs text-zinc-800 dark:text-zinc-200">{v.file_name}</div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    {formatDuration(v.duration) || `${v.width}×${v.height}`}
                  </div>
                </div>
              </button>
            ))}
            {related.length === 0 && (
              <div className="text-xs text-zinc-500">関連動画はありません</div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

function PlayerWithFallback({
  src,
  poster,
  resumePosition,
  onProgress,
  onPlaybackError,
}: {
  src: string;
  poster: string;
  resumePosition: number | null;
  onProgress: (position: number) => void;
  onPlaybackError: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSavedRef = useRef(0);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (failed) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400">
        再生できません。変換を開始します...
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      key={src}
      src={src}
      poster={poster}
      controls
      autoPlay
      className="h-full w-full"
      onLoadedMetadata={() => {
        const v = videoRef.current;
        if (v && resumePosition !== null && resumePosition > 30 && !Number.isNaN(v.duration)) {
          if (resumePosition < v.duration - 20) {
            v.currentTime = resumePosition;
          }
        }
      }}
      onTimeUpdate={() => {
        const v = videoRef.current;
        if (!v) return;
        const now = Date.now();
        if (now - lastSavedRef.current >= 10000 && v.currentTime > 0) {
          lastSavedRef.current = now;
          onProgress(v.currentTime);
        }
      }}
      onEnded={() => {
        const v = videoRef.current;
        if (v) onProgress(0);
      }}
      onError={() => {
        setFailed(true);
        onPlaybackError();
      }}
    />
  );
}
