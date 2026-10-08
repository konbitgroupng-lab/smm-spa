// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BookingConfirmationPage, { type ConfirmationApi } from '../../../src/booking/BookingConfirmationPage';
import { rememberPendingPayment } from '../../../src/booking/pendingPayment';
import type { PaymentOutcome } from '../../../src/services/paymentService';
import { ApiError, makePayment } from '../fixtures';

// Every outcome the backend can report, as the guest sees it on returning from checkout.

afterEach(cleanup);
beforeEach(() => sessionStorage.clear());

const REF = 'SMMP-ABCDEF0123456789';
const confirmed: PaymentOutcome = {
  status: 'confirmed', demo: false,
  appointment: { reference: 'SMM-1A2B3C4D', startsAt: '2026-10-12T08:00:00Z', endsAt: '2026-10-12T09:00:00Z' },
};

function renderPage(outcomes: (PaymentOutcome | Error)[], options: { startPayment?: ConfirmationApi['startPayment'] } = {}) {
  const queue = [...outcomes];
  const api: ConfirmationApi = {
    verifyPayment: vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (next instanceof Error) throw next;
      return next;
    }),
    startPayment: options.startPayment ?? vi.fn(async () => makePayment({ reference: 'SMMP-RETRY0001', checkoutUrl: 'https://checkout.example/retry' })),
  };
  const navigate = vi.fn();
  render(<BookingConfirmationPage reference={REF} api={api} navigate={navigate} pollEveryMs={50} />);
  return { api, navigate };
}

describe('booking confirmation page', () => {
  it('confirmed: the appointment in Lagos time, its reference, and focus on the result', async () => {
    const { api } = renderPage([confirmed]);
    const title = await screen.findByRole('heading', { level: 1, name: /your booking is confirmed/i });
    expect(api.verifyPayment).toHaveBeenCalledWith(REF);
    expect(screen.getByText('Monday 12 October 2026')).toBeTruthy();
    expect(screen.getByText('09:00 – 10:00')).toBeTruthy(); // 08:00 UTC is 09:00 in Lagos
    expect(screen.getByText('SMM-1A2B3C4D')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.queryByText(/demo payment/i)).toBeNull();
  });

  it('pending: says the booking is not confirmed yet and keeps checking until it is', async () => {
    const pending: PaymentOutcome = { status: 'pending', demo: false, appointment: null };
    const { api } = renderPage([pending, pending, confirmed]);
    expect(await screen.findByRole('heading', { level: 1, name: /waiting for payment confirmation/i })).toBeTruthy();
    expect(screen.getByText(/confirmed only once it does/i)).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 1, name: /your booking is confirmed/i }, { timeout: 3000 })).toBeTruthy();
    expect((api.verifyPayment as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('failed: nothing charged, and "try again" restarts payment for the same reserved time', async () => {
    rememberPendingPayment(REF, { holdToken: 'hold-123', demo: false });
    const { api, navigate } = renderPage([{ status: 'failed', demo: false, appointment: null }]);
    expect(await screen.findByRole('heading', { level: 1, name: /your payment did not go through/i })).toBeTruthy();
    expect(screen.getByText(/have not been charged/i)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: /try paying again/i }));
    expect(api.startPayment).toHaveBeenCalledWith('hold-123', { callbackUrl: `${window.location.origin}/?view=payment-return` });
    expect(navigate).toHaveBeenCalledWith('https://checkout.example/retry');
  });

  it('failed without a remembered reservation offers a new booking instead', async () => {
    renderPage([{ status: 'failed', demo: false, appointment: null }]);
    await screen.findByRole('heading', { level: 1, name: /did not go through/i });
    expect(screen.queryByRole('button', { name: /try paying again/i })).toBeNull();
    expect(screen.getByRole('link', { name: /start a new booking/i }).getAttribute('href')).toBe('/#booking');
  });

  it('a retry whose reserved time has expired explains what happened', async () => {
    rememberPendingPayment(REF, { holdToken: 'hold-123', demo: false });
    renderPage([{ status: 'failed', demo: false, appointment: null }], { startPayment: vi.fn(async () => { throw new ApiError('hold_expired'); }) });
    await screen.findByRole('heading', { level: 1, name: /did not go through/i });
    await userEvent.setup().click(screen.getByRole('button', { name: /try paying again/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/reserved time ran out/i);
  });

  it('refund required: explains why in plain words and promises a full refund', async () => {
    renderPage([{ status: 'refund_required', reason: 'slot_retaken', demo: false, appointment: null }]);
    expect(await screen.findByRole('heading', { level: 1, name: /received your payment, but could not complete the booking/i })).toBeTruthy();
    expect(screen.getByText(/booked by another guest/i)).toBeTruthy();
    expect(screen.getByText(/refunded in full/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /whatsapp/i }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\//);
  });

  it('cancelled (Phase 5e): a booking the business cancelled is never shown as confirmed', async () => {
    renderPage([{ ...confirmed, status: 'cancelled' }]);
    expect(await screen.findByRole('heading', { level: 1, name: /this booking has been cancelled/i })).toBeTruthy();
    expect(screen.getByText('SMM-1A2B3C4D')).toBeTruthy();
    expect(screen.getByText(/Monday 12 October 2026 at 09:00/)).toBeTruthy();
    expect(screen.getByText(/refund due on your payment will be arranged by us/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /confirmed/i })).toBeNull();
  });

  it('shows the demo notice only when the server says the payment was simulated', async () => {
    renderPage([{ ...confirmed, demo: true }]);
    expect(await screen.findByText(/demo payment — no real money will be charged/i)).toBeTruthy();
    cleanup();
    renderPage([confirmed]);
    await screen.findByRole('heading', { level: 1, name: /confirmed/i });
    expect(screen.queryByText(/demo payment/i)).toBeNull();
  });

  it('an unknown payment reference is reported, without offering to check again', async () => {
    renderPage([new ApiError('payment_not_found')]);
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not find this payment/i);
    expect(screen.queryByRole('button', { name: /check again/i })).toBeNull();
  });

  it('is part of the site: logo and a way back to the website', async () => {
    renderPage([confirmed]);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('img', { name: /sweet mobile massage and spa/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to website/i }).getAttribute('href')).toBe('/');
  });
});
