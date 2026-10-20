import { useState } from 'react';
import { login } from '../api';
import { Logo } from './Logo';

interface LoginPageProps {
  onLoggedIn: () => void;
}

/** LAN公開時のログインページ */
export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      onLoggedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-10 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <form
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 dark:bg-zinc-900 dark:ring-white/10"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex justify-center">
          <Logo size={56} showSubtitle />
        </div>
        <div className="mt-6 text-center text-sm font-semibold">ログイン</div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs text-zinc-500">ユーザー名</span>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-800"
              autoComplete="username"
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-500">パスワード</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm outline-none focus:border-sky-500 dark:border-zinc-600 dark:bg-zinc-800"
              autoComplete="current-password"
            />
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="mt-5 h-9 w-full rounded-md bg-sky-600 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
        >
          {busy ? 'ログイン中...' : 'ログイン'}
        </button>
      </form>
    </div>
  );
}
