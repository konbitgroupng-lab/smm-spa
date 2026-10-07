import { lazy, Suspense } from 'react';
import type { BookingSectionProps } from './BookingSection';

// The booking funnel (and the Supabase client it needs) is downloaded separately
// from the rest of the page, so phone visitors get the site first.
const BookingSection = lazy(() => import('./BookingSection'));

function Loading() {
  return (
    <div className="space-y-5 rounded border border-spa-taupe bg-white p-6 text-center shadow-2xl sm:p-10">
      <p role="status" className="text-sm text-spa-clay">
        Loading treatments and availability…
      </p>
    </div>
  );
}

export default function LazyBookingSection(props: BookingSectionProps) {
  return (
    <Suspense fallback={<Loading />}>
      <BookingSection {...props} />
    </Suspense>
  );
}
