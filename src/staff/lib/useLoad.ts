import { useCallback, useEffect, useRef, useState } from 'react';
import { messageFor } from './backend';

/**
 * Loads data for a screen. `reload` fetches again (after a change, or to
 * pick up someone else's). An older, slower answer never replaces a newer one.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const call = ++latest.current;
    setLoading(true);
    try {
      const result = await load();
      if (call === latest.current) {
        setData(result);
        setError('');
      }
    } catch (err) {
      if (call === latest.current) setError(messageFor(err));
    } finally {
      if (call === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
