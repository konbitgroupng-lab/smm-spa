import type { StaffRole } from './lib/backend';
import { isAuthFragment } from './lib/authLink';

// The staff app's sections and who sees them. Hiding a section is only a
// convenience: the database refuses the same people whatever the app shows.

export interface Section {
  id: string;
  label: string;
  roles: StaffRole[];
  /** False until the checkpoint that builds the screen. */
  built: boolean;
}

const ALL: StaffRole[] = ['owner', 'admin', 'therapist'];
const MANAGERS: StaffRole[] = ['owner', 'admin'];

export const SECTIONS: Section[] = [
  { id: 'home', label: 'Today', roles: MANAGERS, built: true },
  { id: 'agenda', label: 'My agenda', roles: ['therapist'], built: true },
  { id: 'bookings', label: 'Bookings', roles: MANAGERS, built: true },
  { id: 'customers', label: 'Customers', roles: MANAGERS, built: true },
  { id: 'schedules', label: 'Schedules', roles: MANAGERS, built: true },
  { id: 'catalogue', label: 'Services & therapists', roles: MANAGERS, built: true },
  { id: 'payments', label: 'Payments', roles: MANAGERS, built: true },
  { id: 'staff', label: 'Staff accounts', roles: ['owner'], built: true },
  { id: 'settings', label: 'Settings', roles: MANAGERS, built: true },
  { id: 'activity', label: 'Activity log', roles: MANAGERS, built: true },
  { id: 'account', label: 'My account', roles: ALL, built: true },
];

export function sectionsFor(role: StaffRole): Section[] {
  return SECTIONS.filter((s) => s.roles.includes(role));
}

/** The section named by a "#/id" fragment, or the role's first section. */
export function sectionFromHash(hash: string, role: StaffRole): Section {
  const allowed = sectionsFor(role);
  const id = isAuthFragment(hash) ? '' : hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return allowed.find((s) => s.id === id) ?? allowed[0];
}
