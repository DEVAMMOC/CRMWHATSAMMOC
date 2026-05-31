'use client';
import { useState, useEffect } from 'react';

/**
 * Retorna true quando a viewport tem largura ≤ breakpoint (default 768px).
 * SSR-safe: inicia false e atualiza no cliente após montar (evita mismatch de hidratação).
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);
  return isMobile;
}
