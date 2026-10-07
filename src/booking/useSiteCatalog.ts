import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../lib/env';
import type { Catalog } from '../services/catalogService';
import { staticCatalog } from '../services/staticCatalog';

// Loaded on demand, so the Supabase client is not part of the page's first download.
const loadFromDatabase = (): Promise<Catalog> => import('../services/catalogService').then((m) => m.getCatalog());

/**
 * Treatments and packages for the site's service and package cards. The page
 * renders the static content immediately, then switches to the database
 * catalogue (same names and prices, plus database ids so "Book" can preselect
 * the treatment). If the database cannot be reached the static content stays.
 */
export function useSiteCatalog(load: () => Promise<Catalog> = loadFromDatabase, configured = isSupabaseConfigured): Catalog {
  const [catalog, setCatalog] = useState<Catalog>(staticCatalog);
  useEffect(() => {
    if (!configured) return;
    let current = true;
    load()
      .then((fromDatabase) => {
        if (current && fromDatabase.services.length + fromDatabase.packages.length > 0) setCatalog(fromDatabase);
      })
      .catch(() => undefined); // keep the static content
    return () => {
      current = false;
    };
  }, [load, configured]);
  return catalog;
}
