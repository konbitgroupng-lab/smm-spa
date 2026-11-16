import { lazy, Suspense } from 'react';
import App from './App';
import WhatsAppWidget from './components/WhatsAppWidget';
import { resolveView } from './routes';

// The confirmation, demo checkout and video pages load only when visited, so
// the website's own bundle stays the same size.
const BookingConfirmationPage = lazy(() => import('./booking/BookingConfirmationPage'));
const DemoCheckoutPage = lazy(() => import('./prototype/DemoCheckoutPage'));
const VideoGalleryPage = lazy(() => import('./videos/VideoGalleryPage'));

export default function AppRouter({ search }: { search: string }) {
  const view = resolveView(search);
  // The WhatsApp concierge is on every public page; not on the simulated
  // payment provider's checkout, which stands in for a third-party page.
  const concierge = view.page !== 'demo-checkout' && <WhatsAppWidget />;
  if (view.page === 'site') {
    return (
      <>
        <App />
        {concierge}
      </>
    );
  }
  return (
    <>
      <Suspense fallback={null}>
        {view.page === 'payment-return' && <BookingConfirmationPage reference={view.reference} />}
        {view.page === 'demo-checkout' && <DemoCheckoutPage reference={view.reference} />}
        {view.page === 'videos' && <VideoGalleryPage videoId={view.videoId} />}
      </Suspense>
      {concierge}
    </>
  );
}
