interface LogoProps {
  /** アイコンの表示サイズ(px) */
  size?: number;
  /** 「MEDIA SOFTWARE」のサブタイトルを表示する */
  showSubtitle?: boolean;
  className?: string;
}

/** アプリロゴ(ブラウザ窓 + キューブのアイコンとワードマーク) */
export function Logo({ size = 32, showSubtitle = false, className = '' }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img
        src="/brand/logo.svg"
        width={size}
        height={size}
        alt=""
        className="shrink-0"
        draggable={false}
      />
      <span className="flex min-w-0 flex-col leading-none">
        <span
          className="font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100"
          style={{ fontSize: Math.round(size * 0.46) }}
        >
          Kurarium
        </span>
        {showSubtitle && (
          <span
            className="mt-1 font-semibold tracking-[0.24em] text-zinc-500 dark:text-zinc-400"
            style={{ fontSize: Math.max(8, Math.round(size * 0.11)) }}
          >
            MEDIA SOFTWARE
          </span>
        )}
      </span>
    </span>
  );
}
