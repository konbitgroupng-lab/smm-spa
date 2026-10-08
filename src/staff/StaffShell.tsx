import { useEffect, useRef } from 'react';
import type { StaffBackend, StaffRole, WhoAmI } from './lib/backend';
import type { StaffOps } from './lib/ops';
import { parseRoute, useHash, type Route } from './router';
import { AccountScreen } from './screens/AccountScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { AgendaScreen } from './screens/AgendaScreen';
import { AppointmentDetailScreen } from './screens/AppointmentDetailScreen';
import { BookingsScreen } from './screens/BookingsScreen';
import { CatalogueScreen } from './screens/CatalogueScreen';
import { CustomerDetailScreen, CustomersScreen } from './screens/CustomersScreen';
import { HomeScreen } from './screens/HomeScreen';
import { NewBookingScreen } from './screens/NewBookingScreen';
import { PaymentsScreen } from './screens/PaymentsScreen';
import { SchedulesScreen } from './screens/SchedulesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { StaffAccountsScreen } from './screens/StaffAccountsScreen';
import { sectionFromHash, sectionsFor, type Section } from './sections';

export function StaffShell({ backend, ops, who, role, email, onRefresh, onSignOut }: {
  backend: StaffBackend;
  ops: StaffOps;
  who: WhoAmI;
  role: StaffRole;
  email: string | null;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}) {
  const hash = useHash();
  const sections = sectionsFor(role);
  const current = sectionFromHash(hash, role);
  const route = parseRoute(hash);

  // After moving to another screen, put keyboard and screen-reader focus on its heading.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => document.querySelector<HTMLElement>('main h1')?.focus(), 0);
    return () => clearTimeout(timer);
  }, [hash]);

  return (
    <div className="min-h-screen bg-spa-cream">
      <a href="#staff-main" onClick={(e) => { e.preventDefault(); document.getElementById('staff-main')?.focus(); }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:bg-white focus:px-3 focus:py-2 focus:rounded">
        Skip to content
      </a>
      <header className="bg-white border-b border-spa-taupe">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="font-serif text-lg">SMM staff</p>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-spa-clay">{who.profile?.fullName || email}</span>
            <button type="button" onClick={onSignOut} className="underline underline-offset-2 hover:text-spa-berry min-h-[32px]">
              Sign out
            </button>
          </div>
        </div>
        <nav aria-label="Staff sections" className="max-w-6xl mx-auto px-4">
          <ul className="flex flex-wrap gap-x-5 gap-y-1 pb-2 text-sm">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#/${s.id}`}
                  aria-current={s.id === current.id ? 'page' : undefined}
                  className={`inline-block py-1.5 border-b-2 ${s.id === current.id ? 'border-spa-gold font-medium' : 'border-transparent hover:border-spa-taupe'}`}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="staff-main" tabIndex={-1} className="max-w-6xl mx-auto px-4 py-8 focus:outline-none">
        <Screen section={current} route={current.id === route.section ? route : { ...route, path: [] }}
          backend={backend} ops={ops} who={who} role={role} email={email} onRefresh={onRefresh} />
      </main>
    </div>
  );
}

function Screen({ section, route, backend, ops, who, role, email, onRefresh }: {
  section: Section;
  route: Route;
  backend: StaffBackend;
  ops: StaffOps;
  who: WhoAmI;
  role: StaffRole;
  email: string | null;
  onRefresh: () => Promise<void>;
}) {
  const [sub] = route.path;
  switch (section.id) {
    case 'account':
      return <AccountScreen backend={backend} who={who} email={email} onChanged={onRefresh} />;
    case 'home':
      return <HomeScreen ops={ops} />;
    case 'agenda':
      return <AgendaScreen ops={ops} route={route} />;
    case 'bookings':
      if (sub === 'new') return <NewBookingScreen ops={ops} />;
      if (sub) return <AppointmentDetailScreen key={sub} ops={ops} id={sub} role={role} />;
      return <BookingsScreen ops={ops} route={route} />;
    case 'customers':
      if (sub) return <CustomerDetailScreen key={sub} ops={ops} id={sub} />;
      return <CustomersScreen ops={ops} route={route} />;
    case 'schedules':
      return <SchedulesScreen ops={ops} route={route} />;
    case 'catalogue':
      return <CatalogueScreen ops={ops} route={route} />;
    case 'payments':
      return <PaymentsScreen ops={ops} route={route} role={role} />;
    case 'staff':
      return <StaffAccountsScreen ops={ops} route={route} selfId={who.userId} />;
    case 'settings':
      return <SettingsScreen ops={ops} role={role} />;
    case 'activity':
      return <ActivityScreen ops={ops} route={route} />;
    default:
      return (
        <section>
          <h1 tabIndex={-1} className="font-serif text-2xl mb-3 focus:outline-none">{section.label}</h1>
          <p className="text-sm text-spa-clay">This screen arrives in a later Phase 5 checkpoint.</p>
        </section>
      );
  }
}
