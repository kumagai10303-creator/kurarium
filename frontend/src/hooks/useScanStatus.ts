import { useEffect, useState } from 'react';
import { getAppStatus, type AppStatus } from '../api';

export function useScanStatus(): AppStatus | null {
  const [status, setStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    let idleChecks = 0;

    const tick = async () => {
      try {
        const st = await getAppStatus();
        if (!alive) return;
        setStatus(st);
        const active = st.scan.running || st.thumbs.running || st.thumbs.remaining > 0;
        if (active) {
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

  return status;
}
