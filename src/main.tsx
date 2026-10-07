import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { resolvePrototypeView } from './prototype/routes';

// Development prototype pages, selected with ?view=... and loaded on demand so
// the public site's bundle is unaffected. See src/prototype/routes.ts.
const BookingPrototypePage = lazy(() => import('./prototype/BookingPrototypePage'));
const DemoCheckoutPage = lazy(() => import('./prototype/DemoCheckoutPage'));
const PaymentReturnPage = lazy(() => import('./prototype/PaymentReturnPage'));

const view = resolvePrototypeView(window.location.search, import.meta.env.DEV || import.meta.env.VITE_ENABLE_BOOKING_PROTOTYPE === 'true');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {view.page === 'site' ? (
      <App />
    ) : (
      <Suspense fallback={null}>
        {view.page === 'booking-prototype' && <BookingPrototypePage />}
        {view.page === 'demo-checkout' && <DemoCheckoutPage reference={view.reference} />}
        {view.page === 'payment-return' && <PaymentReturnPage reference={view.reference} />}
      </Suspense>
    )}
  </StrictMode>,
);
