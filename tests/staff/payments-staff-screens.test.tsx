// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { StaffError } from '../../src/staff/lib/backend';
import { parseRoute } from '../../src/staff/router';
import { ActivityScreen } from '../../src/staff/screens/ActivityScreen';
import { PaymentsScreen } from '../../src/staff/screens/PaymentsScreen';
import { SettingsScreen } from '../../src/staff/screens/SettingsScreen';
import { StaffAccountsScreen } from '../../src/staff/screens/StaffAccountsScreen';
import { auditEntries, fakeOps, paymentDetail, V1 } from './fake-ops';

// The 5d screens against a scripted backend. Who may do what is proven in the
// database tests; these check what each screen shows and sends.

afterEach(() => {
  cleanup();
  window.location.hash = '';
});
const route = (hash: string) => parseRoute(hash);

describe('payments', () => {
  it('opens on the refund queue; other filters ask the server', async () => {
    const ops = fakeOps();
    render(<PaymentsScreen ops={ops} route={route('#/payments')} role="admin" />);
    const card = await screen.findByRole('link', { name: /₦40,000 · Paid.*Refund needed.*Demo payment.*Refund Guest.*Booking cancelled/ });
    expect(card.getAttribute('href')).toBe('#/payments/pay-1');
    expect(ops.payments).toHaveBeenCalledWith('refund_due', 50, 0);
    expect(screen.getByRole('link', { name: 'Refund needed' }).getAttribute('aria-current')).toBe('page');
    cleanup();
    render(<PaymentsScreen ops={ops} route={route('#/payments?filter=failed')} role="admin" />);
    await waitFor(() => expect(ops.payments).toHaveBeenLastCalledWith('failed', 50, 0));
  });

  it('an admin sees everything about a payment but cannot record a refund', async () => {
    const ops = fakeOps();
    render(<PaymentsScreen ops={ops} route={route('#/payments/pay-1')} role="admin" />);
    expect(await screen.findByRole('heading', { name: 'Payment SMMP-ABC123' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Booking and guest' })).getByRole('link', { name: 'SMM-AAAA1111' }).getAttribute('href')).toBe('#/bookings/appt-1');
    expect(within(screen.getByRole('region', { name: 'Provider messages' })).getByText(/charge.success/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'History' })).getByText('Status: Waiting for the provider → Paid')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'History' })).getByText(/Paid: — → ₦40,000/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Record a refund' })).getByText('Only the owner can record refunds.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record refund' })).toBeNull();
  });

  it('the owner records a refund made outside the app, with a reason and the payment\'s version', async () => {
    const ops = fakeOps();
    ops.recordRefund.mockRejectedValueOnce(new StaffError('exceeds_refundable'));
    render(<PaymentsScreen ops={ops} route={route('#/payments/pay-1')} role="owner" />);
    const panel = await screen.findByRole('region', { name: 'Record a refund' });
    expect(within(panel).getByText(/Nothing is sent to the guest or the provider/)).toBeTruthy();
    expect((within(panel).getByLabelText('Amount (₦)') as HTMLInputElement).value).toBe('40000');
    await userEvent.click(within(panel).getByLabelText('Cash'));
    await userEvent.clear(within(panel).getByLabelText('Amount (₦)'));
    await userEvent.type(within(panel).getByLabelText('Amount (₦)'), '50,000');
    await userEvent.type(within(panel).getByLabelText('Reason'), 'Booking cancelled by spa');
    await userEvent.click(within(panel).getByRole('button', { name: 'Record refund' }));
    expect((await within(panel).findByRole('alert')).textContent).toBe('That is more than is left to refund on this payment.');
    await userEvent.clear(within(panel).getByLabelText('Amount (₦)'));
    await userEvent.type(within(panel).getByLabelText('Amount (₦)'), '40,000');
    await userEvent.type(within(panel).getByLabelText('Reference (optional)'), 'RCPT-12');
    await userEvent.click(within(panel).getByRole('button', { name: 'Record refund' }));
    await waitFor(() => expect(ops.recordRefund).toHaveBeenLastCalledWith('pay-1', 4000000, 'cash', 'Booking cancelled by spa', V1, 'RCPT-12', null));
    expect(ops.paymentDetail).toHaveBeenCalledTimes(2);
  });

  it('a payment with nothing left to refund offers no form, and lists past refunds', async () => {
    const ops = fakeOps();
    const done = paymentDetail({ status: 'refunded', refundedMinor: 4000000, refundableMinor: 0, needsRefund: false });
    done.refunds = [{ id: 'r-1', amountMinor: 4000000, currency: 'NGN', method: 'bank_transfer', reference: 'TRF-1', note: null, recordedAt: '2026-10-08T10:00:00Z', recordedByName: 'Olu Owner', isDemo: true }];
    ops.paymentDetail.mockResolvedValue(done);
    render(<PaymentsScreen ops={ops} route={route('#/payments/pay-1')} role="owner" />);
    const refunds = await screen.findByRole('region', { name: 'Refunds recorded' });
    expect(within(refunds).getByText(/₦40,000 · Bank transfer · TRF-1/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Record a refund' })).toBeNull();
  });
});

describe('staff accounts (owner)', () => {
  it('lists accounts and sends invitations', async () => {
    const ops = fakeOps();
    ops.inviteStaff.mockRejectedValueOnce(new StaffError('already_registered'));
    render(<StaffAccountsScreen ops={ops} route={route('#/staff')} selfId="owner-1" />);
    expect(await screen.findByRole('link', { name: /New Person.*No access.*new.person@example.com.*Therapist/ })).toBeTruthy();
    const invite = screen.getByRole('region', { name: 'Invite someone' });
    await userEvent.type(within(invite).getByLabelText('Full name'), 'Bisi Admin');
    await userEvent.type(within(invite).getByLabelText('Email'), 'bisi@example.com');
    await userEvent.click(within(invite).getByRole('button', { name: 'Send invitation' }));
    expect((await within(invite).findByRole('alert')).textContent).toBe('This email already has an account.');
    await userEvent.click(within(invite).getByRole('button', { name: 'Send invitation' }));
    expect(await within(invite).findByText(/Invitation sent to bisi@example.com/)).toBeTruthy();
    expect(ops.inviteStaff).toHaveBeenLastCalledWith('bisi@example.com', 'Bisi Admin');
  });

  it('gives access, changes the role and moves a therapist link, each with a reason and the version', async () => {
    const ops = fakeOps();
    render(<StaffAccountsScreen ops={ops} route={route('#/staff/staff-2')} selfId="owner-1" />);
    const access = await screen.findByRole('region', { name: 'Access' });
    await userEvent.type(within(access).getByLabelText('Reason'), 'Starts today');
    await userEvent.click(within(access).getByRole('button', { name: 'Give access' }));
    await waitFor(() => expect(ops.setStaffActive).toHaveBeenCalledWith('staff-2', true, 'Starts today', 'v-staff-2'));

    const role = screen.getByRole('region', { name: 'Role' });
    await userEvent.selectOptions(within(role).getByLabelText('Role'), 'admin');
    await userEvent.type(within(role).getByLabelText('Reason'), 'Front desk');
    await userEvent.click(within(role).getByRole('button', { name: 'Change role' }));
    await waitFor(() => expect(ops.setStaffRole).toHaveBeenCalledWith('staff-2', 'admin', 'Front desk', 'v-staff-2'));
    cleanup();

    render(<StaffAccountsScreen ops={ops} route={route('#/staff/staff-3')} selfId="owner-1" />);
    const link = await screen.findByRole('region', { name: 'Therapist profile' });
    await userEvent.selectOptions(within(link).getByLabelText('Therapist profile'), 't-2');
    await userEvent.type(within(link).getByLabelText('Reason'), 'Moved to the spa team');
    await userEvent.click(within(link).getByRole('button', { name: 'Save link' }));
    await waitFor(() => expect(ops.linkTherapist).toHaveBeenCalledTimes(2));
    expect(ops.linkTherapist.mock.calls).toEqual([
      ['t-1', null, 'Moved to the spa team', 'v-t1'],
      ['t-2', 'staff-3', 'Moved to the spa team', 'v-t2'],
    ]);
  });

  it('the last-owner refusal is explained', async () => {
    const ops = fakeOps();
    ops.setStaffActive.mockRejectedValueOnce(new StaffError('last_owner'));
    render(<StaffAccountsScreen ops={ops} route={route('#/staff/owner-1')} selfId="owner-1" />);
    const access = await screen.findByRole('region', { name: 'Access' });
    expect(within(access).getByText(/This is your own account/)).toBeTruthy();
    await userEvent.type(within(access).getByLabelText('Reason'), 'Leaving');
    await userEvent.click(within(access).getByRole('button', { name: 'Remove access' }));
    expect((await within(access).findByRole('alert')).textContent).toBe('There must always be at least one active owner.');
  });
});

describe('settings', () => {
  it('the owner edits payment settings; the demo switch is shown, never editable', async () => {
    const ops = fakeOps();
    render(<SettingsScreen ops={ops} role="owner" />);
    const panel = await screen.findByRole('region', { name: 'Online payment' });
    expect(within(panel).getByText(/cannot be changed from the staff app/)).toBeTruthy();
    expect(within(panel).queryByLabelText(/demo/i)).toBeNull();
    await userEvent.click(within(panel).getByLabelText('A deposit'));
    await userEvent.clear(within(panel).getByLabelText('Deposit (% of the price)'));
    await userEvent.type(within(panel).getByLabelText('Deposit (% of the price)'), '30');
    await userEvent.type(within(panel).getByLabelText('Reason'), 'Deposits from November');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save payment settings' }));
    await waitFor(() => expect(ops.updatePaymentSettings).toHaveBeenCalledWith(V1, { onlinePaymentEnabled: true, paymentMode: 'deposit', depositPercent: 30 }, 'Deposits from November'));
  });

  it('an admin sees payment settings read-only and can rename the business', async () => {
    const ops = fakeOps();
    render(<SettingsScreen ops={ops} role="admin" />);
    const payment = await screen.findByRole('region', { name: 'Online payment' });
    expect(within(payment).getByText('Only the owner can change payment settings.')).toBeTruthy();
    expect(within(payment).queryByRole('button')).toBeNull();
    const business = screen.getByRole('region', { name: 'Business' });
    await userEvent.clear(within(business).getByLabelText('Business name'));
    await userEvent.type(within(business).getByLabelText('Business name'), 'Sweet Mobile Massage');
    await userEvent.type(within(business).getByLabelText('Reason'), 'Rebrand');
    await userEvent.click(within(business).getByRole('button', { name: 'Save business name' }));
    await waitFor(() => expect(ops.updateBusinessName).toHaveBeenCalledWith(V1, 'Sweet Mobile Massage', 'Rebrand'));
  });
});

describe('activity log', () => {
  it('shows who did what and why, links to records, filters by area and pages backwards', async () => {
    const ops = fakeOps();
    ops.auditLog.mockResolvedValueOnce(auditEntries(50, 200)).mockResolvedValueOnce(auditEntries(2, 150));
    render(<ActivityScreen ops={ops} route={route('#/activity')} />);
    const items = await screen.findAllByRole('listitem');
    expect(items.length).toBeGreaterThanOrEqual(50);
    expect(screen.getAllByText('Refund recorded').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reason: Guest called').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Contact phone: changed/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'open' })[0].getAttribute('href')).toBe('#/bookings/appt-1');
    await userEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await waitFor(() => expect(ops.auditLog).toHaveBeenLastCalledWith({ entityTypes: null, entityId: null, actionPrefix: null, beforeId: 151, limit: 50 }));
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'payments');
    expect(window.location.hash).toBe('#/activity?area=payments');
    cleanup();
    render(<ActivityScreen ops={ops} route={route('#/activity?area=payments')} />);
    await waitFor(() => expect(ops.auditLog).toHaveBeenLastCalledWith(expect.objectContaining({ entityTypes: ['payments', 'refund_records'] })));
  });
});
