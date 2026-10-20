import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * モーダルの共通挙動:
 * - フォーカストラップ(Tab / Shift+Tab)
 * - 開く前の要素へフォーカス復帰
 * - 背面スクロールロック
 * - 任意で Esc による閉じる処理
 */
export function useModalA11y(
  open: boolean,
  onClose: () => void,
  closeOnEsc = true,
  externalRef?: React.MutableRefObject<HTMLDivElement | null>,
): React.MutableRefObject<HTMLDivElement | null> {
  const internalRef = useRef<HTMLDivElement | null>(null);
  const ref = externalRef ?? internalRef;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;

    const previousActive = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = (): HTMLElement[] =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.getClientRects().length > 0,
      );

    const first = focusable()[0];
    (first ?? el).focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEsc) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = focusable();
      if (list.length === 0) {
        event.preventDefault();
        return;
      }
      const index = list.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey) {
        if (index <= 0) {
          event.preventDefault();
          list[list.length - 1].focus();
        }
      } else if (index === list.length - 1) {
        event.preventDefault();
        list[0].focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      previousActive?.focus?.();
    };
    // ref は安定参照
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closeOnEsc]);

  return ref;
}
