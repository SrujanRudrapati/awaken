'use client';
/** Today's date, read after mount so prerendered HTML never bakes in a stale day. Null until then. */
import { useEffect, useState } from 'react';

export function useToday(): Date | null {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => {
    setToday(new Date()); // eslint-disable-line react-hooks/set-state-in-effect -- browser clock, read once after hydration
  }, []);
  return today;
}
