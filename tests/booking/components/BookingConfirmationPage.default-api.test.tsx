// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentOutcome } from '../../../src/services/paymentService';

// The page as the site mounts it: no `api` prop, so it uses the real payment
// service module (mocked here at the network boundary). Regression for a
// default `api` object rebuilt on every render, which re-ran the verify call
// in an endless loop and exhausted the server's rate limit.

const verifyPayment = vi.fn<(reference: string) => Promise<PaymentOutcome>>();
vi.mock('../../../src/services/paymentService', () => ({
  verifyPayment: (reference: string) => verifyPayment(reference),
  startPayment: vi.fn(),
}));

const { default: BookingConfirmationPage } = await import('../../../src/booking/BookingConfirmationPage');

afterEach(cleanup);
beforeEach(() => {
  sessionStorage.clear();
  verifyPayment.mockReset();
});

const REF = 'SMMP-ABCDEF0123456789';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('booking confirmation page with its default api', () => {
  it('asks the server once for a confirmed booking, not on every render', async () => {
    verifyPayment.mockResolvedValue({
      status: 'confirmed', demo: false,
      appointment: { reference: 'SMM-1A2B3C4D', startsAt: '2026-10-12T08:00:00Z', endsAt: '2026-10-12T09:00:00Z' },
    });
    render(<BookingConfirmationPage reference={REF} />);
    expect(await screen.findByRole('heading', { level: 1, name: /your booking is confirmed/i })).toBeTruthy();
    await wait(300);
    expect(verifyPayment).toHaveBeenCalledTimes(1);
  });

  it('stops after one call when the server is rate limiting', async () => {
    verifyPayment.mockRejectedValue(Object.assign(new Error('rate_limited'), { code: 'rate_limited' }));
    render(<BookingConfirmationPage reference={REF} />);
    expect(await screen.findByRole('heading', { level: 1, name: /could not check your payment/i })).toBeTruthy();
    await wait(300);
    expect(verifyPayment).toHaveBeenCalledTimes(1);
  });
});
