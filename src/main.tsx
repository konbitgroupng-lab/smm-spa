import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import AppRouter from './AppRouter';
import { clearLegacyBookingStorage } from './booking/legacyStorage';
import './index.css';

// Remove personal data the old booking form left in this browser.
clearLegacyBookingStorage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter search={window.location.search} />
  </StrictMode>,
);
