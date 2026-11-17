// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TransferBookingPage from '../../src/booking/TransferBookingPage';
import { resolveView, transferPageUrl } from '../../src/routes';
import { BookingError, type TransferBooking } from '../../src/services/bookingService';

// The guest's own page for a booking paid by bank transfer.

afterEach(cleanup);

const TOKEN = '6f1c2a9e-8b3d-4c5e-9f00-112233445566';
const awaiting: TransferBooking = {
  token: TOKEN, reference: 'SMM-ABCD1234', status: 'awaiting', expired: false,
  startsAt: '2030-10-14T09:00:00Z', endsAt: '2030-10-14T10:00:00Z', amountMinor: 1_600_000, bookingTotalMinor: 4_000_000,
  currency: 'NGN', dueAt: '2030-10-13T11:00:00Z',
  bank: { name: 'Standard Chartered Bank', accountNumber: '0013819712', accountName: 'Sweet Mobile Massage and Spa Limited' },
};
const page = (booking: Partial<TransferBooking> | Error) =>
  render(<TransferBookingPage token={TOKEN} api={{ getTransferBooking: vi.fn(async () => { if (booking instanceof Error) throw booking; return { ...awaiting, ...booking }; }) }} />);

describe('transfer booking page', () => {
  it('only a well-formed token opens it', () => {
    expect(resolveView(transferPageUrl(TOKEN).slice(1))).toEqual({ page: 'transfer', token: TOKEN });
    expect(resolveView('?view=transfer&token=SMM-ABCD1234')).toEqual({ page: 'site' });
  });

  it('awaiting: the account, the deposit amount, the reference and a proof-of-payment WhatsApp message', async () => {
    page({});
    expect(await screen.findByRole('heading', { level: 1, name: /your time is reserved/i })).toBeTruthy();
    expect(screen.getByText('Deposit to transfer')).toBeTruthy();
    expect(screen.getByText('0013819712')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy account number' })).toBeTruthy();
    const proof = screen.getByRole('link', { name: /send proof on whatsapp/i }).getAttribute('href')!;
    expect(decodeURIComponent(proof)).toContain('booking SMM-ABCD1234');
    expect(decodeURIComponent(proof)).toContain('₦16,000');
  });

  it('expired: says the transfer did not arrive in time, offers WhatsApp and booking again; no account shown', async () => {
    page({ status: 'cancelled', expired: true, bank: null });
    expect(await screen.findByRole('heading', { level: 1, name: /this booking has been cancelled/i })).toBeTruthy();
    expect(screen.getByText(/did not receive the transfer for SMM-ABCD1234 in time/)).toBeTruthy();
    expect(screen.queryByText('0013819712')).toBeNull();
    expect(screen.getByRole('link', { name: /book again/i }).getAttribute('href')).toBe('/#booking');
  });

  it('confirmed, and a link that matches no booking', async () => {
    page({ status: 'confirmed', bank: null });
    expect(await screen.findByRole('heading', { level: 1, name: /your booking is confirmed/i })).toBeTruthy();
    cleanup();
    page(new BookingError('transfer_not_found'));
    expect(await screen.findByRole('heading', { level: 1, name: /could not open this booking/i })).toBeTruthy();
    expect(screen.getByText(/could not find this booking/i)).toBeTruthy();
  });
});
