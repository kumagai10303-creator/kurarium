import type { ReactNode } from 'react';
import { ArrowLeftIcon, CloseIcon, GearIcon, MoonIcon, SunIcon } from './icons';

/** ヘッダーで共通利用するボタン群(配置と見た目の統一用) */

export function iconBtnClass(active = false): string {
  return `inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none ${
    active
      ? 'border-sky-500 bg-sky-50 text-sky-600 dark:border-sky-500 dark:bg-sky-500/15 dark:text-sky-400'
      : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-white'
  }`;
}

export function IconButton({
  onClick,
  title,
  active = false,
  disabled = false,
  children,
}: {
  onClick?: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`${iconBtnClass(active)} disabled:pointer-events-none disabled:opacity-40`}
      title={title}
      aria-label={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-zinc-100 px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      title="戻る"
    >
      <ArrowLeftIcon className="h-4 w-4" />
      <span className="hidden sm:inline">戻る</span>
    </button>
  );
}

export function ThemeButton({
  theme,
  onToggle,
}: {
  theme: 'light' | 'dark';
  onToggle: () => void;
}) {
  const label = theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え';
  return (
    <IconButton onClick={onToggle} title={label}>
      {theme === 'dark' ? <SunIcon className="h-[18px] w-[18px]" /> : <MoonIcon className="h-[18px] w-[18px]" />}
    </IconButton>
  );
}

export function SettingsButton({ onClick }: { onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <IconButton onClick={onClick} title="設定">
      <GearIcon className="h-[18px] w-[18px]" />
    </IconButton>
  );
}

export function CloseButton({ onClick, title = '閉じる' }: { onClick: () => void; title?: string }) {
  return (
    <IconButton onClick={onClick} title={title}>
      <CloseIcon className="h-[18px] w-[18px]" />
    </IconButton>
  );
}
