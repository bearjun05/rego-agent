'use client';
import { useEffect, useState } from 'react';
import { weekLabel, weekLabelEn } from '@/lib/week';

/** "N주차" (한국어) — 서버에서 SSR된 후 클라이언트가 갱신 */
export function WeekLabel({ en = false }: { en?: boolean }) {
  const [label, setLabel] = useState<string>(en ? 'WEEK ?' : 'N주차');
  useEffect(() => {
    setLabel(en ? weekLabelEn() : weekLabel());
  }, [en]);
  return <>{label}</>;
}
