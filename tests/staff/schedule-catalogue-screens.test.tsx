// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { StaffError } from '../../src/staff/lib/backend';
import { parseRoute } from '../../src/staff/router';
import { CatalogueScreen } from '../../src/staff/screens/CatalogueScreen';
import { HomeScreen } from '../../src/staff/screens/HomeScreen';
import { SchedulesScreen } from '../../src/staff/screens/SchedulesScreen';
import { fakeOps, V1 } from './fake-ops';

// The 5c screens against a scripted backend: what they send, and how a change
// that affects existing bookings is shown and confirmed.

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const route = (hash: string) => parseRoute(hash);
const NONE = { reason: null, confirm: false };

function conflictError(reservations = 0) {
  return new StaffError('confirmation_required', JSON.stringify({
    appointments: [{ id: 'appt-7', reference: 'SMM-CCCC3333', starts_at: '2026-10-21T09:00:00Z', service_name: 'Swedish Massage',
      therapist_name: 'Senior Massage Therapist', contact_name: 'Conflict Guest', reasons: ['outside_business_hours'] }],
    reservations,
  }));
}

describe('schedules', () => {
  it('opening hours: Monday first; a change that affects bookings lists them and needs a ticked box and a reason', async () => {
    const ops = fakeOps();
    ops.setBusinessHours.mockRejectedValueOnce(conflictError(1));
    render(<SchedulesScreen ops={ops} route={route('#/schedules')} />);
    const panel = await screen.findByRole('region', { name: 'Opening hours' });
    const days = within(panel).getAllByRole('listitem').map((li) => li.textContent?.split('Open')[0]);
    expect(days[0]).toBe('Monday');
    expect(days[6]).toBe('Sunday');
    await userEvent.click(within(panel).getAllByLabelText('Open')[2]); // Wednesday
    await userEvent.click(within(panel).getByRole('button', { name: 'Save opening hours' }));

    const warning = await within(panel).findByRole('alert');
    expect(within(warning).getByText('This change affects existing bookings')).toBeTruthy();
    expect(within(warning).getByRole('link', { name: /SMM-CCCC3333/ }).getAttribute('href')).toBe('#/bookings/appt-7');
    expect(within(warning).getByText('Outside opening hours')).toBeTruthy();
    expect(within(warning).getByText(/1 guest is part-way through booking/)).toBeTruthy();
    const saveAnyway = within(warning).getByRole('button', { name: 'Save anyway' }) as HTMLButtonElement;
    expect(saveAnyway.disabled).toBe(true);
    await userEvent.click(within(warning).getByLabelText(/keep these bookings as they are/));
    expect(saveAnyway.disabled).toBe(true); // a reason is still needed
    await userEvent.type(within(panel).getByLabelText('Reason (optional)'), 'Closed on Wednesdays');
    await userEvent.click(saveAnyway);
    await waitFor(() => expect(ops.setBusinessHours).toHaveBeenLastCalledWith(
      expect.arrayContaining([{ dayOfWeek: 3, isClosed: true, opensAt: '09:00', closesAt: '21:00' }]), 'hours-v1',
      { reason: 'Closed on Wednesdays', confirm: true }));
    expect(ops.setBusinessHours.mock.calls[0][2]).toEqual(NONE);
    expect(await within(panel).findByText('Opening hours saved.')).toBeTruthy();
  });

  it('therapist weeks: a day off and a day without a break are sent as such', async () => {
    const ops = fakeOps();
    render(<SchedulesScreen ops={ops} route={route('#/schedules?tab=therapists&therapist=t-2')} />);
    const panel = await screen.findByRole('region', { name: 'Lead Spa Therapist: weekly hours' });
    const friday = within(panel).getAllByRole('listitem')[4];
    await userEvent.click(within(friday).getByLabelText('Works'));
    const saturday = within(panel).getAllByRole('listitem')[5];
    await userEvent.click(within(saturday).getByLabelText('Break'));
    await userEvent.click(within(panel).getByRole('button', { name: 'Save weekly hours' }));
    await waitFor(() => expect(ops.setTherapistWeek).toHaveBeenCalled());
    const [therapistId, shifts, breaks, version, opts] = ops.setTherapistWeek.mock.calls[0];
    expect([therapistId, version, opts]).toEqual(['t-2', 'week-t2', NONE]);
    expect(shifts.map((s: any) => s.dayOfWeek)).toEqual([1, 2, 3, 4, 6]);
    expect(breaks.map((b: any) => b.dayOfWeek)).toEqual([1, 2, 3, 4]);
  });

  it('time off and closures: added in Lagos time, listed, removable', async () => {
    const ops = fakeOps();
    render(<SchedulesScreen ops={ops} route={route('#/schedules?tab=time-off')} />);
    const add = await screen.findByRole('region', { name: 'Add time off' });
    await userEvent.selectOptions(within(add).getByLabelText('Therapist'), 't-2');
    for (const [label, value] of [['From date', '2026-11-10'], ['From time', '09:00'], ['Until date', '2026-11-10'], ['Until time', '13:00']]) {
      await userEvent.clear(within(add).getByLabelText(label));
      await userEvent.type(within(add).getByLabelText(label), value);
    }
    await userEvent.type(within(add).getByLabelText('Note (optional)'), 'Dentist');
    await userEvent.click(within(add).getByRole('button', { name: 'Add time off' }));
    await waitFor(() => expect(ops.addTimeOff).toHaveBeenCalledWith('t-2', '2026-11-10T08:00:00.000Z', '2026-11-10T12:00:00.000Z', 'Dentist', NONE));
    const list = screen.getByRole('region', { name: 'Upcoming time off' });
    expect(within(list).getByText('Annual leave')).toBeTruthy();
    await userEvent.click(within(list).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(ops.removeTimeOff).toHaveBeenCalledWith('off-1', null));
    cleanup();

    render(<SchedulesScreen ops={ops} route={route('#/schedules?tab=blackouts')} />);
    const closures = await screen.findByRole('region', { name: 'Upcoming closures' });
    expect(within(closures).getByText('Christmas Day')).toBeTruthy();
    await userEvent.click(within(closures).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(ops.removeBlackout).toHaveBeenCalledWith('bo-1', null));
  });

  it('booking rules need a reason and are sent in minutes', async () => {
    const ops = fakeOps();
    ops.updateBookingRules.mockRejectedValueOnce(new StaffError('reason_required'));
    render(<SchedulesScreen ops={ops} route={route('#/schedules?tab=rules')} />);
    const panel = await screen.findByRole('region', { name: 'Booking rules' });
    await userEvent.clear(within(panel).getByLabelText(/Minimum notice/));
    await userEvent.type(within(panel).getByLabelText(/Minimum notice/), '3');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save booking rules' }));
    expect((await within(panel).findByRole('alert')).textContent).toBe('Give a short reason for this change.');
    await userEvent.type(within(panel).getByLabelText('Reason'), 'More notice for therapists');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save booking rules' }));
    await waitFor(() => expect(ops.updateBookingRules).toHaveBeenLastCalledWith(V1,
      { holdMinutes: 10, minLeadMinutes: 180, maxAdvanceDays: 60, slotIntervalMinutes: 30, defaultBufferMinutes: 15 }, 'More notice for therapists'));
  });

  it('conflicts are listed with their reasons and a link to each booking', async () => {
    const ops = fakeOps();
    render(<SchedulesScreen ops={ops} route={route('#/schedules?tab=conflicts')} />);
    const link = await screen.findByRole('link', { name: /SMM-CCCC3333/ });
    expect(link.getAttribute('href')).toBe('#/bookings/appt-7');
    expect(screen.getByText('Outside the therapist\'s shift; Therapist on time off')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Conflicts/ }).textContent).toContain('1');
  });

  it('the home screen counts conflicts', async () => {
    render(<HomeScreen ops={fakeOps()} />);
    const stat = (await screen.findByText('Bookings in conflict with the schedule')).closest('div')!;
    expect(within(stat).getByText('1')).toBeTruthy();
  });
});

describe('catalogue', () => {
  it('lists treatments, packages, therapists and areas', async () => {
    const ops = fakeOps();
    render(<CatalogueScreen ops={ops} route={route('#/catalogue')} />);
    expect(await screen.findByRole('link', { name: /Swedish Massage.*Active.*3 upcoming bookings/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Thai Massage.*Inactive/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Essential Escape/ })).toBeNull();
    cleanup();
    render(<CatalogueScreen ops={ops} route={route('#/catalogue?tab=packages')} />);
    expect(await screen.findByRole('link', { name: /Essential Escape.*Swedish Massage/ })).toBeTruthy();
    cleanup();
    render(<CatalogueScreen ops={ops} route={route('#/catalogue?tab=therapists')} />);
    expect(await screen.findByRole('link', { name: /Senior Massage Therapist.*2 treatments · 4 upcoming · Has a staff account/ })).toBeTruthy();
    cleanup();
    render(<CatalogueScreen ops={ops} route={route('#/catalogue?tab=areas')} />);
    expect(await screen.findByRole('link', { name: /Surulere \/ Yaba.*Travel fee ₦3,000/ })).toBeTruthy();
  });

  it('editing a treatment: booked terms are kept (and said so); deactivating with bookings is confirmed', async () => {
    const ops = fakeOps();
    ops.saveService.mockRejectedValueOnce(conflictError());
    render(<CatalogueScreen ops={ops} route={route('#/catalogue/service/s-1')} />);
    const panel = await screen.findByRole('region', { name: 'Treatment details' });
    await userEvent.clear(within(panel).getByLabelText('Price (₦)'));
    await userEvent.type(within(panel).getByLabelText('Price (₦)'), '45,000');
    expect(within(panel).getByText(/3 upcoming bookings keep their current length, buffer and price/)).toBeTruthy();
    await userEvent.click(within(panel).getByLabelText('Active (offered for booking)'));
    await userEvent.type(within(panel).getByLabelText('Reason (optional)'), 'Season over');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    const warning = await within(panel).findByRole('alert');
    await userEvent.click(within(warning).getByLabelText(/keep these bookings as they are/));
    await userEvent.click(within(warning).getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(ops.saveService).toHaveBeenLastCalledWith('s-1', V1, expect.objectContaining({
      priceMinor: 4500000, isActive: false, durationMinutes: 60, bufferMinutes: 15, isPackage: false, slug: 'swedish-massage',
    }), { reason: 'Season over', confirm: true }));
  });

  it('a new treatment gets its web address from its name, then opens', async () => {
    const ops = fakeOps();
    render(<CatalogueScreen ops={ops} route={route('#/catalogue/service/new')} />);
    const panel = await screen.findByRole('region', { name: 'Treatment details' });
    await userEvent.type(within(panel).getByLabelText('Name'), 'Couples Massage');
    await userEvent.clear(within(panel).getByLabelText('Length (minutes)'));
    await userEvent.type(within(panel).getByLabelText('Length (minutes)'), '90');
    await userEvent.type(within(panel).getByLabelText('Price (₦)'), '90000');
    await userEvent.click(within(panel).getByRole('button', { name: 'Add treatment' }));
    await waitFor(() => expect(ops.saveService).toHaveBeenCalledWith(null, null, expect.objectContaining({
      slug: 'couples-massage', name: 'Couples Massage', durationMinutes: 90, priceMinor: 9000000, isPackage: false,
    }), NONE));
    expect(window.location.hash).toBe('#/catalogue/service/s-new');
  });

  it('a package\'s contents are saved in catalogue order with their version', async () => {
    const ops = fakeOps();
    render(<CatalogueScreen ops={ops} route={route('#/catalogue/service/p-1')} />);
    const items = await screen.findByRole('region', { name: 'Treatments in this package' });
    await userEvent.click(within(items).getByLabelText('Hot Stone Therapy'));
    await userEvent.click(within(items).getByRole('button', { name: 'Save contents' }));
    await waitFor(() => expect(ops.setPackageItems).toHaveBeenCalledWith('p-1', ['s-1', 's-2'], 'items-v1', null));
    expect(screen.getByRole('region', { name: 'Package details' })).toBeTruthy();
  });

  it('a therapist\'s details and treatments are saved separately, with their versions', async () => {
    const ops = fakeOps();
    render(<CatalogueScreen ops={ops} route={route('#/catalogue/therapist/t-1')} />);
    const offered = await screen.findByRole('region', { name: 'Treatments offered' });
    await userEvent.click(within(offered).getByLabelText('Hot Stone Therapy'));
    await userEvent.click(within(offered).getByRole('button', { name: 'Save treatments' }));
    await waitFor(() => expect(ops.setTherapistServices).toHaveBeenCalledWith('t-1', ['s-1'], 'svc-t1', NONE));
    const details = screen.getByRole('region', { name: 'Details' });
    expect(within(details).getByText(/4 upcoming bookings stay booked if you deactivate/)).toBeTruthy();
    await userEvent.clear(within(details).getByLabelText('Title'));
    await userEvent.type(within(details).getByLabelText('Title'), 'Senior therapist');
    await userEvent.click(within(details).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ops.saveTherapist).toHaveBeenCalledWith('t-1', V1, expect.objectContaining({ title: 'Senior therapist', isActive: true }), NONE));
    expect(screen.getByRole('link', { name: 'Edit weekly hours' }).getAttribute('href')).toBe('#/schedules?tab=therapists&therapist=t-1');
  });

  it('an area\'s fee is entered in naira and kept on existing bookings', async () => {
    const ops = fakeOps();
    ops.saveZone.mockRejectedValueOnce(new StaffError('key_in_use'));
    render(<CatalogueScreen ops={ops} route={route('#/catalogue/area/z-1')} />);
    const panel = await screen.findByRole('region', { name: 'Area details' });
    expect(within(panel).getByText('Upcoming bookings keep the fee they were made with.')).toBeTruthy();
    await userEvent.clear(within(panel).getByLabelText('Travel fee (₦)'));
    await userEvent.type(within(panel).getByLabelText('Travel fee (₦)'), '4500');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    expect((await within(panel).findByRole('alert')).textContent).toBe('Another area already uses this short name.');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(ops.saveZone).toHaveBeenLastCalledWith('z-1', V1, { name: 'Surulere / Yaba', key: 'mainland', feeMinor: 450000, isActive: true, sortOrder: 1 }, NONE));
  });
});
