import { packagesData, servicesData } from '../data';
import type { Catalog } from './catalogService';

/**
 * The static site content in catalogue form (no database ids). Separate from
 * catalogService so the page can show it without loading the Supabase client.
 */
export function staticCatalog(): Catalog {
  const extra = { dbId: null, bufferMinutes: 0, currency: 'NGN' };
  return {
    services: servicesData.map((s) => ({ ...s, ...extra })),
    packages: packagesData.map((p) => ({ ...p, ...extra })),
  };
}
