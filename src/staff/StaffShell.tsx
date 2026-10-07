import { useEffect, useState } from 'react';
import type { StaffBackend, StaffRole, WhoAmI } from './lib/backend';
import { AccountScreen } from './screens/AccountScreen';
import { sectionFromHash, sectionsFor } from './sections';

export function StaffShell({ backend, who, role, email, onRefresh, onSignOut }: {
  backend: StaffBackend;
  who: WhoAmI;
  role: StaffRole;
  email: string | null;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}) {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  const sections = sectionsFor(role);
  const current = sectionFromHash(hash, role);

  return (
    <div className="min-h-screen bg-spa-cream">
      <header className="bg-white border-b border-spa-taupe">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="font-serif text-lg">SMM staff</p>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-spa-clay">{who.profile?.fullName || email}</span>
            <button type="button" onClick={onSignOut} className="underline underline-offset-2 hover:text-spa-berry">
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
      <main className="max-w-6xl mx-auto px-4 py-8">
        {current.id === 'account' ? (
          <AccountScreen backend={backend} who={who} email={email} onChanged={onRefresh} />
        ) : (
          <section>
            <h1 className="font-serif text-2xl mb-3">{current.label}</h1>
            <p className="text-sm text-spa-clay">This screen arrives in a later Phase 5 checkpoint.</p>
          </section>
        )}
      </main>
    </div>
  );
}
