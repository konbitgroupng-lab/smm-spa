import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  getCatalog,
  getDispatchZones,
  getTherapists,
  getTherapistServiceLinks,
  type CatalogPackage,
  type CatalogService,
  type CatalogTherapist,
  type DispatchZone,
} from '../services/catalogService';
import { getBusinessSettings, type BusinessSettings } from '../services/contentService';

// Everything the booking funnel needs to know before the guest starts, loaded
// from the database. Without a configured backend the funnel is "unavailable"
// (the rest of the site keeps rendering its static content).

export interface BookingCatalog {
  /** Only items that exist in the database (bookable). */
  services: CatalogService[];
  packages: CatalogPackage[];
  therapists: CatalogTherapist[];
  zones: DispatchZone[];
  /** therapist id -> ids of the services they offer */
  links: Map<string, Set<string>>;
  settings: BusinessSettings;
}

export type UnavailableReason = 'not_configured' | 'not_set_up' | 'payments_off';

export type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; catalog: BookingCatalog }
  | { status: 'unavailable'; reason: UnavailableReason }
  | { status: 'error' };

export interface CatalogApi {
  configured: boolean;
  getCatalog: typeof getCatalog;
  getTherapists: typeof getTherapists;
  getDispatchZones: typeof getDispatchZones;
  getTherapistServiceLinks: typeof getTherapistServiceLinks;
  getBusinessSettings: typeof getBusinessSettings;
}

export const defaultCatalogApi: CatalogApi = {
  configured: isSupabaseConfigured,
  getCatalog,
  getTherapists,
  getDispatchZones,
  getTherapistServiceLinks,
  getBusinessSettings,
};

export async function loadBookingCatalog(api: CatalogApi = defaultCatalogApi): Promise<CatalogState> {
  if (!api.configured) return { status: 'unavailable', reason: 'not_configured' };
  try {
    const [catalog, therapists, zones, links, settings] = await Promise.all([
      api.getCatalog(),
      api.getTherapists(),
      api.getDispatchZones(),
      api.getTherapistServiceLinks(),
      api.getBusinessSettings(),
    ]);
    const services = catalog.services.filter((s) => s.dbId);
    const packages = catalog.packages.filter((p) => p.dbId);
    if (!settings || services.length + packages.length === 0) return { status: 'unavailable', reason: 'not_set_up' };
    if (!settings.onlinePaymentEnabled && !settings.transferEnabled) return { status: 'unavailable', reason: 'payments_off' };
    return {
      status: 'ready',
      catalog: { services, packages, therapists: therapists.filter((t) => t.dbId), zones, links, settings },
    };
  } catch {
    return { status: 'error' };
  }
}

export function useBookingCatalog(api: CatalogApi = defaultCatalogApi): CatalogState & { retry: () => void } {
  const [state, setState] = useState<CatalogState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    void loadBookingCatalog(api).then((result) => {
      if (current) setState(result);
    });
    return () => {
      current = false;
    };
  }, [api, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
