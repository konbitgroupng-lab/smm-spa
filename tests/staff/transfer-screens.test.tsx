// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { StaffError } from '../../src/staff/lib/backend';
import { HomeScreen } from '../../src/staff/screens/HomeScreen';
import { SettingsScreen } from '../../src/staff/screens/SettingsScreen';
import { fakeOps, SETTINGS, V1 } from './fake-ops';

// Guest bank transfers in the staff app: what the screens send.

afterEach(cleanup);

describe('bank transfers to check (Today)', () => {
  it('lists each transfer with amount, reference and deadline; confirming asks first, then sends the version', async () => {
    const ops = fakeOps();
    render(<HomeScreen ops={ops} />);
    const panel = await screen.findByRole('region', { name: 'Bank transfers to check' });
    expect(within(panel).getByText(/₦40,000 · reference/)).toBeTruthy();
    expect(within(panel).getByText('SMM-TTTT1111')).toBeTruthy();
    expect(within(panel).getByText(/Bisi Transfer/)).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Open booking' }).getAttribute('href')).toBe('#/bookings/appt-t1');

    await userEvent.click(within(panel).getByRole('button', { name: 'Transfer received' }));
    expect(ops.confirmTransfer).not.toHaveBeenCalled();
    await userEvent.type(within(panel).getByLabelText('Note (optional)'), 'Seen at 10:42');
    await userEvent.click(within(panel).getByRole('button', { name: 'Yes, transfer received' }));
    await waitFor(() => expect(ops.confirmTransfer).toHaveBeenCalledWith('appt-t1', V1, 'Seen at 10:42'));
  });

  it('a refused confirmation says why; with nothing waiting the panel is not shown', async () => {
    const ops = fakeOps();
    ops.confirmTransfer.mockRejectedValueOnce(new StaffError('invalid_status'));
    render(<HomeScreen ops={ops} />);
    const panel = await screen.findByRole('region', { name: 'Bank transfers to check' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Transfer received' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Yes, transfer received' }));
    expect((await within(panel).findByRole('alert')).textContent).toMatch(/can no longer be changed/);
    cleanup();

    const none = fakeOps();
    none.transfers.mockResolvedValue([]);
    render(<HomeScreen ops={none} />);
    await screen.findByRole('region', { name: "Today's appointments" });
    expect(screen.queryByRole('region', { name: 'Bank transfers to check' })).toBeNull();
  });
});

describe('bank transfer settings', () => {
  it('owner: edits the account with a reason', async () => {
    const ops = fakeOps();
    render(<SettingsScreen ops={ops} role="owner" />);
    const panel = await screen.findByRole('region', { name: 'Bank transfer' });
    expect((within(panel).getByLabelText('Account number') as HTMLInputElement).value).toBe('0013819712');
    const number = within(panel).getByLabelText('Account number');
    await userEvent.clear(number);
    await userEvent.type(number, '0123456789');
    await userEvent.type(within(panel).getByLabelText('Reason'), 'Client confirmed GTBank account');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save bank transfer details' }));
    await waitFor(() => expect(ops.updateTransferSettings).toHaveBeenCalledWith(V1, {
      enabled: true, bankName: 'Standard Chartered Bank', accountNumber: '0123456789', accountName: 'Sweet Mobile Massage and Spa Limited',
    }, 'Client confirmed GTBank account'));
  });

  it('admin: sees the account but cannot change it', async () => {
    const ops = fakeOps();
    ops.settings.mockResolvedValue({ ...SETTINGS });
    render(<SettingsScreen ops={ops} role="admin" />);
    const panel = await screen.findByRole('region', { name: 'Bank transfer' });
    expect(within(panel).getByText('0013819712')).toBeTruthy();
    expect(within(panel).getByText('Only the owner can change the bank details.')).toBeTruthy();
    expect(within(panel).queryByRole('button')).toBeNull();
  });
});
