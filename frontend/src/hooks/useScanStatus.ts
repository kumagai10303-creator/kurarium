import { useEffect, useState } from 'react';
import { getScanStatus, type ScanState } from '../api';

/**
 * スキャン状況をアプリ全体で共有するためのポーリングフック。
 * 実行中は1秒、待機中は4秒間隔(起動直後のみ700msで数回確認)。
 */
export function useScanStatus(): ScanState | null {
  const [scan, setScan] = useState<ScanState | null>(null);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    let idleChecks = 0;

    const tick = async () => {
      try {
        const st = await getScanStatus();
        if (!alive) return;
        setScan(st);
        if (st.running) {
          idleChecks = 0;
          timer = window.setTimeout(tick, 1000);
        } else if (idleChecks < 3) {
          idleChecks++;
          timer = window.setTimeout(tick, 700);
        } else {
          timer = window.setTimeout(tick, 4000);
        }
      } catch {
        if (alive) timer = window.setTimeout(tick, 5000);
      }
    };

    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  return scan;
}
