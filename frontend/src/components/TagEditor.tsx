import { useState } from 'react';
import { addItemTag, removeItemTag, type TagCount } from '../api';

const MAX_TAGS = 50;

export function TagEditor({
  itemId,
  tags,
  suggestions,
  onChange,
}: {
  itemId: number;
  tags: string[];
  suggestions: TagCount[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = suggestions
    .filter((t) => !tags.includes(t.name))
    .filter((t) => input.trim() === '' || t.name.toLowerCase().includes(input.trim().toLowerCase()))
    .slice(0, 8);

  const add = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    if (tags.length >= MAX_TAGS) {
      setError('タグが多すぎます');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await addItemTag(itemId, trimmed);
      onChange(next);
      setInput('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await removeItemTag(itemId, name);
      onChange(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="group flex items-center gap-1 rounded-full bg-sky-600/15 px-2.5 py-0.5 text-xs text-sky-700 dark:bg-sky-900/60 dark:text-sky-200"
        >
          #{t}
          <button
            className="text-sky-700/60 hover:text-sky-900 dark:text-sky-400/60 dark:hover:text-white"
            aria-label={`タグ ${t} を削除`}
            disabled={busy}
            onClick={() => void remove(t)}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        className="w-32 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-900 placeholder-zinc-400 outline-none focus:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:bg-zinc-700"
        placeholder="タグを追加..."
        value={input}
        disabled={busy}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            void add(input);
          }
        }}
      />
      {input.trim() !== '' && filtered.length > 0 && (
        <span className="flex flex-wrap items-center gap-1">
          {filtered.map((t) => (
            <button
              key={t.id}
              className="rounded-full bg-zinc-200/70 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-700/60 dark:text-zinc-300 dark:hover:bg-zinc-600"
              disabled={busy}
              onClick={() => void add(t.name)}
            >
              +{t.name}
            </button>
          ))}
        </span>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
