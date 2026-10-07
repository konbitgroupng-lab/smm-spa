import { lazy, Suspense } from 'react';
import App from './App';
import { resolveView } from './routes';

// The confirmation and demo checkout pages load only when visited, so the
// website's own bundle stays the same size.
const BookingConfirmationPage = lazy(() => import('./booking/BookingConfirmationPage'));
const DemoCheckoutPage = lazy(() => import('./prototype/DemoCheckoutPage'));

export default function AppRouter({ search }: { search: string }) {
  const view = resolveView(search);
  if (view.page === 'site') return <App />;
  return (
    <Suspense fallback={null}>
      {view.page === 'payment-return' && <BookingConfirmationPage reference={view.reference} />}
      {view.page === 'demo-checkout' && <DemoCheckoutPage reference={view.reference} />}
    </Suspense>
  );
}
