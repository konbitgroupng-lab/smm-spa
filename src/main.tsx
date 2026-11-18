import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import AppRouter from './AppRouter';
import { clearLegacyBookingStorage } from './booking/legacyStorage';
import './index.css';

// Remove personal data the old booking form left in this browser.
clearLegacyBookingStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Guests who ask their phone or computer for less motion get no slide-in or float animations. */}
    <MotionConfig reducedMotion="user">
      <AppRouter search={window.location.search} />
    </MotionConfig>
  </StrictMode>,
);
