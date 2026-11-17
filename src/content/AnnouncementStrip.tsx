import { Megaphone, Sparkles } from 'lucide-react';
import type { Announcement } from '../services/contentService';

/**
 * The owner's current announcements and promotions, in a light band under
 * the homepage banner. Nothing is shown when there are none. Plain text only.
 */
export default function AnnouncementStrip({ announcements }: { announcements: Announcement[] }) {
  if (!announcements.length) return null;
  return (
    <section aria-label="Announcements" className="bg-spa-linen border-b border-spa-taupe">
      <ul className="max-w-5xl mx-auto px-6 py-4 space-y-3">
        {announcements.slice(0, 3).map((a) => {
          const Icon = a.kind === 'promotion' ? Sparkles : Megaphone;
          return (
            <li key={a.id} className="flex items-start justify-center gap-3 text-center sm:text-left">
              <Icon className="w-4 h-4 mt-0.5 text-spa-gold-dark flex-shrink-0" aria-hidden="true" />
              <p className="text-sm text-spa-charcoal">
                <span className="sr-only">{a.kind === 'promotion' ? 'Promotion: ' : 'Announcement: '}</span>
                <strong className="font-semibold">{a.title}</strong>
                {a.body && <span className="text-spa-clay-text"> — {a.body}</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
