// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffError } from '../../src/staff/lib/backend';
import { parseRoute } from '../../src/staff/router';
import { AgendaScreen } from '../../src/staff/screens/AgendaScreen';
import { AppointmentDetailScreen } from '../../src/staff/screens/AppointmentDetailScreen';
import { BookingsScreen } from '../../src/staff/screens/BookingsScreen';
import { CustomerDetailScreen, CustomersScreen } from '../../src/staff/screens/CustomersScreen';
import { HomeScreen } from '../../src/staff/screens/HomeScreen';
import { NewBookingScreen } from '../../src/staff/screens/NewBookingScreen';
import { agendaItem, appointmentDetail, appointmentRow, fakeOps, V1 } from './fake-ops';

// Every new 5b screen against a scripted backend: what it shows, what it
// sends, and how it reports the server's answers.

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const route = (hash: string) => parseRoute(hash);

describe('home (owner/admin)', () => {
  it('shows today\'s figures and appointments', async () => {
    const ops = fakeOps();
    render(<HomeScreen ops={ops} />);
    expect(await screen.findByText('Bookings today')).toBeTruthy();
    const stats = screen.getByText('Online payments flagged for refund').closest('div')!;
    expect(within(stats).getByText('2')).toBeTruthy();
    expect(await screen.findByRole('link', { name: /10:00–11:00/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New phone booking' }).getAttribute('href')).toBe('#/bookings/new');
  });

  it('reports a failure and retries', async () => {
    const ops = fakeOps();
    ops.dashboard.mockRejectedValueOnce(new StaffError('not_authorized'));
    render(<HomeScreen ops={ops} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Your account is not allowed to do this.');
    await userEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]);
    expect(await screen.findByText('Bookings today')).toBeTruthy();
  });
});

describe('bookings: list, day by therapist, week', () => {
  it('the list asks for seven days from the chosen date, in Lagos time', async () => {
    const ops = fakeOps();
    render(<BookingsScreen ops={ops} route={route('#/bookings?date=2026-10-12')} />);
    await screen.findByRole('link', { name: /10:00–11:00/ });
    expect(ops.appointments).toHaveBeenCalledWith('2026-10-11T23:00:00.000Z', '2026-10-18T23:00:00.000Z', null);
    expect(screen.getByRole('heading', { name: /Mon 12 Oct – Sun 18 Oct · 1 appointment/ })).toBeTruthy();
  });

  it('the day view has a column per therapist, empty ones included', async () => {
    const ops = fakeOps();
    render(<BookingsScreen ops={ops} route={route('#/bookings?view=day&date=2026-10-12')} />);
    const senior = await screen.findByRole('region', { name: 'Senior Massage Therapist' });
    expect(within(senior).getByRole('link', { name: /10:00–11:00/ })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Lead Spa Therapist' })).getByText('Nothing booked.')).toBeTruthy();
    expect(ops.appointments).toHaveBeenCalledWith('2026-10-11T23:00:00.000Z', '2026-10-12T23:00:00.000Z', null);
  });

  it('the week view runs Monday to Sunday and can be filtered by therapist', async () => {
    const ops = fakeOps();
    render(<BookingsScreen ops={ops} route={route('#/bookings?view=week&date=2026-10-15&therapist=t-2')} />);
    await screen.findByRole('region', { name: 'Monday 12 October 2026' });
    expect(screen.getAllByRole('region')).toHaveLength(7);
    expect(ops.appointments).toHaveBeenCalledWith('2026-10-11T23:00:00.000Z', '2026-10-18T23:00:00.000Z', 't-2');
  });

  it('cancelled bookings are hidden unless asked for; date controls move the period', async () => {
    const ops = fakeOps();
    ops.appointments.mockResolvedValue([appointmentRow(), appointmentRow({ id: 'appt-2', status: 'cancelled', startsAt: '2026-10-12T11:00:00Z', endsAt: '2026-10-12T12:00:00Z' })]);
    render(<BookingsScreen ops={ops} route={route('#/bookings?date=2026-10-12')} />);
    await screen.findByRole('link', { name: /10:00–11:00/ });
    expect(screen.queryByRole('link', { name: /12:00–13:00/ })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'cancelled');
    expect(window.location.hash).toContain('status=cancelled');
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(window.location.hash).toContain('date=2026-10-19');
  });
});

describe('appointment detail', () => {
  it('shows the booking contact apart from the customer record, and its history', async () => {
    const ops = fakeOps();
    render(<AppointmentDetailScreen ops={ops} id="appt-1" role="admin" />);
    const guest = await screen.findByRole('region', { name: 'Guest' });
    expect(within(guest).getByText(/Ada Contact · \+2348030000001/)).toBeTruthy();
    expect(within(guest).getByRole('link', { name: 'Ada Master' }).getAttribute('href')).toBe('#/customers/c-1');
    expect(within(guest).getByText('Side entrance')).toBeTruthy();
    const history = screen.getByRole('region', { name: 'History' });
    expect(within(history).getByText('Booked by staff')).toBeTruthy();
    expect(within(history).getByText('Reason: Called to book')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Online payments' })).getByText(/settled outside the online payment system/)).toBeTruthy();
  });

  it('cancelling needs a reason and reports a flagged refund', async () => {
    const ops = fakeOps();
    ops.appointmentDetail.mockResolvedValue(appointmentDetail({ source: 'online', settlement: 'online_payment', paymentState: 'paid' }));
    ops.cancel.mockResolvedValue({ refundFlagged: 1, settlement: 'online_payment' });
    render(<AppointmentDetailScreen ops={ops} id="appt-1" role="owner" />);
    const panel = await screen.findByRole('region', { name: 'Cancel booking' });
    expect(within(panel).getByText(/flagged for a refund; no money is returned automatically/)).toBeTruthy();
    await userEvent.type(within(panel).getByLabelText('Reason for cancelling'), 'Guest is unwell');
    await userEvent.click(within(panel).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => expect(ops.cancel).toHaveBeenCalledWith('appt-1', 'Guest is unwell', V1));
    expect(await screen.findByText('Booking cancelled. The online payment is flagged for a refund.')).toBeTruthy();
    expect(ops.appointmentDetail).toHaveBeenCalledTimes(2);
  });

  it('rescheduling outside the rules offers an explicit override, then sends it', async () => {
    const ops = fakeOps();
    ops.reschedule.mockRejectedValueOnce(new StaffError('schedule_rule', 'on_break'));
    render(<AppointmentDetailScreen ops={ops} id="appt-1" role="admin" />);
    const panel = await screen.findByRole('region', { name: 'Reschedule' });
    await userEvent.clear(within(panel).getByLabelText('New start time'));
    await userEvent.type(within(panel).getByLabelText('New start time'), '13:00');
    await userEvent.type(within(panel).getByLabelText('Reason'), 'Guest asked');
    await userEvent.click(within(panel).getByRole('button', { name: 'Move booking' }));
    expect((await within(panel).findByRole('alert')).textContent).toBe('That time is outside the booking rules: it falls in the therapist\'s break.');
    await userEvent.click(within(panel).getByLabelText('Book anyway, overriding this booking rule'));
    await userEvent.click(within(panel).getByRole('button', { name: 'Move, overriding the rule' }));
    await waitFor(() => expect(ops.reschedule).toHaveBeenLastCalledWith('appt-1', '2030-10-14T12:00:00.000Z', 'Guest asked', V1, null, true));
    expect(await screen.findByText('Booking moved.')).toBeTruthy();
  });

  it('a stale edit is explained', async () => {
    const ops = fakeOps();
    ops.updateBookingDetails.mockRejectedValueOnce(new StaffError('stale_record'));
    render(<AppointmentDetailScreen ops={ops} id="appt-1" role="admin" />);
    const panel = await screen.findByRole('region', { name: 'Booking contact and notes' });
    await userEvent.clear(within(panel).getByLabelText('Contact name'));
    await userEvent.type(within(panel).getByLabelText('Contact name'), 'Driver Musa');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save booking details' }));
    expect((await within(panel).findByRole('alert')).textContent).toBe('Someone else changed this since you opened it. Reload and try again.');
    expect(ops.updateBookingDetails).toHaveBeenCalledWith('appt-1', V1, {
      contactName: 'Driver Musa', contactPhone: '+2348030000001', serviceAddress: null, bookingNotes: 'Side entrance', reason: null,
    });
  });

  it('in-home bookings edit their address; phone bookings record settlement', async () => {
    const ops = fakeOps();
    ops.appointmentDetail.mockResolvedValue(appointmentDetail({ locationType: 'mobile', zoneName: 'Surulere / Yaba', serviceAddress: '1 First Street' }));
    render(<AppointmentDetailScreen ops={ops} id="appt-1" role="admin" />);
    const details = await screen.findByRole('region', { name: 'Booking contact and notes' });
    await userEvent.clear(within(details).getByLabelText('Address for the visit'));
    await userEvent.type(within(details).getByLabelText('Address for the visit'), '2 Second Street');
    await userEvent.click(within(details).getByRole('button', { name: 'Save booking details' }));
    await waitFor(() => expect(ops.updateBookingDetails).toHaveBeenCalledWith('appt-1', V1, expect.objectContaining({ serviceAddress: '2 Second Street' })));
    const settlement = screen.getByRole('region', { name: 'Settlement' });
    await userEvent.click(within(settlement).getByLabelText('Paid offline'));
    await userEvent.type(within(settlement).getByLabelText('Reason'), 'Bank transfer received');
    await userEvent.click(within(settlement).getByRole('button', { name: 'Save settlement' }));
    await waitFor(() => expect(ops.setSettlement).toHaveBeenCalledWith('appt-1', 'paid_offline', 'Bank transfer received', V1));
  });

  it('outcome buttons appear only once the appointment has started; corrections need a reason', async () => {
    const ops = fakeOps();
    render(<AppointmentDetailScreen ops={ops} id="appt-1" role="admin" />);
    expect(await screen.findByText('Can be marked completed or no-show once it has started.')).toBeTruthy();
    cleanup();
    ops.appointmentDetail.mockResolvedValue(appointmentDetail({ startsAt: '2026-01-05T09:00:00Z', endsAt: '2026-01-05T10:00:00Z' }));
    render(<AppointmentDetailScreen ops={ops} id="appt-1" role="admin" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark no-show' }));
    await waitFor(() => expect(ops.setStatus).toHaveBeenCalledWith('appt-1', 'no_show', V1));
    expect(screen.queryByRole('region', { name: 'Reschedule' })).toBeNull(); // started: cannot be moved
    cleanup();
    ops.appointmentDetail.mockResolvedValue(appointmentDetail({ status: 'completed', startsAt: '2026-01-05T09:00:00Z', endsAt: '2026-01-05T10:00:00Z' }));
    render(<AppointmentDetailScreen ops={ops} id="appt-1" role="admin" />);
    const correct = await screen.findByRole('region', { name: 'Correct the outcome' });
    await userEvent.type(within(correct).getByLabelText('Reason'), 'Guest never came');
    await userEvent.click(within(correct).getByRole('button', { name: 'Correct status' }));
    await waitFor(() => expect(ops.setStatus).toHaveBeenLastCalledWith('appt-1', 'no_show', V1, 'Guest never came'));
    expect(screen.queryByRole('region', { name: 'Cancel booking' })).toBeNull();
  });
});

describe('new phone or WhatsApp booking', () => {
  it('books a new customer into a free time and opens the booking', async () => {
    const ops = fakeOps();
    render(<NewBookingScreen ops={ops} />);
    await userEvent.click(await screen.findByLabelText('WhatsApp'));
    await userEvent.click(screen.getByLabelText('Already paid offline'));
    await userEvent.type(screen.getByLabelText('Full name'), 'Ngozi Caller');
    await userEvent.type(screen.getByLabelText('Phone number'), '+2348031112222');
    await userEvent.clear(screen.getByLabelText('Date'));
    await userEvent.type(screen.getByLabelText('Date'), '2026-10-12');
    await userEvent.click(screen.getByRole('button', { name: 'Find free times' }));
    expect(ops.availableSlots).toHaveBeenCalledWith('s-1', '2026-10-12', null);
    await userEvent.click(await screen.findByRole('button', { name: '11:30 · Lead Spa Therapist' }));
    await userEvent.type(screen.getByLabelText('Reason'), 'Messaged to book');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() => expect(ops.createBooking).toHaveBeenCalledWith({
      source: 'whatsapp', settlement: 'paid_offline', serviceId: 's-1', startsAt: '2026-10-12T10:30:00Z', therapistId: 't-2',
      locationType: 'sanctuary', dispatchZoneId: null, serviceAddress: null, customerId: null, customerName: 'Ngozi Caller',
      customerEmail: null, customerPhone: '+2348031112222', contactName: null, contactPhone: null, bookingNotes: null, reason: 'Messaged to book',
    }));
    expect(window.location.hash).toBe('#/bookings/appt-new');
  });

  it('can book an existing customer, in-home, and shows the server\'s refusal', async () => {
    const ops = fakeOps();
    ops.createBooking.mockRejectedValueOnce(new StaffError('slot_unavailable', 'slot_taken'));
    render(<NewBookingScreen ops={ops} />);
    await userEvent.click(await screen.findByLabelText('Find existing'));
    await userEvent.type(screen.getByLabelText('Name, email or phone'), 'ada');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(await screen.findByRole('button', { name: /Ada Master/ }));
    await userEvent.click(screen.getByLabelText('In-home'));
    await userEvent.type(screen.getByLabelText('Address for the visit'), '4 Allen Avenue');
    expect(screen.getByText('Price: ₦43,000')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Reason'), 'Called to book');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Choose one of the free times.');
    await userEvent.click(screen.getByRole('button', { name: 'Find free times' }));
    await userEvent.click(await screen.findByRole('button', { name: /10:00/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That time cannot be booked: it overlaps another booking or a guest reservation.');
    expect(ops.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'c-1', customerName: null, locationType: 'mobile', dispatchZoneId: 'z-1', serviceAddress: '4 Allen Avenue',
    }));
  });
});

describe('customers', () => {
  it('lists, searches, pages and adds customers', async () => {
    const ops = fakeOps();
    ops.customers.mockResolvedValueOnce({ rows: [(await ops.customers('', 1, 0)).rows[0]], total: 2 });
    render(<CustomersScreen ops={ops} route={route('#/customers')} />);
    expect(await screen.findByRole('link', { name: 'Ada Master' })).toBeTruthy();
    expect(screen.getByText('2 customers')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('link', { name: 'Bola Walkin' })).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Search by name, email or phone'), '0803');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(window.location.hash).toBe('#/customers?q=0803');

    await userEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    const form = screen.getByRole('region', { name: 'New customer' });
    await userEvent.type(within(form).getByLabelText('Full name'), 'Walk In');
    await userEvent.type(within(form).getByLabelText('Phone'), '+2348030001234');
    ops.createCustomer.mockRejectedValueOnce(new StaffError('email_in_use'));
    await userEvent.click(within(form).getByRole('button', { name: 'Add customer' }));
    expect((await within(form).findByRole('alert')).textContent).toBe('Another customer already has this email address.');
    await userEvent.click(within(form).getByRole('button', { name: 'Add customer' }));
    await waitFor(() => expect(window.location.hash).toBe('#/customers/c-new'));
    expect(ops.createCustomer).toHaveBeenLastCalledWith({ fullName: 'Walk In', email: null, phone: '+2348030001234', staffNotes: null });
  });

  it('the customer record is edited with its version, apart from booking contacts', async () => {
    const ops = fakeOps();
    render(<CustomerDetailScreen ops={ops} id="c-1" />);
    const record = await screen.findByRole('region', { name: 'Customer record' });
    expect(within(record).getByText(/Each booking keeps the contact details given for it/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Bookings (1)' })).getByText(/Contact given: Ada Contact/)).toBeTruthy();
    await userEvent.clear(within(record).getByLabelText('Staff notes'));
    await userEvent.type(within(record).getByLabelText('Staff notes'), 'VIP');
    await userEvent.click(within(record).getByRole('button', { name: 'Save customer record' }));
    await waitFor(() => expect(ops.updateCustomer).toHaveBeenCalledWith('c-1', V1, {
      fullName: 'Ada Master', email: 'ada@example.com', phone: '+2348030000009', staffNotes: 'VIP', reason: null,
    }));
    expect(await screen.findByText('Customer record saved.')).toBeTruthy();
  });
});

describe('therapist agenda', () => {
  it('shows what the visit needs, and marks it completed', async () => {
    const ops = fakeOps();
    render(<AgendaScreen ops={ops} route={route('#/agenda')} />);
    const card = await screen.findByRole('article');
    expect(within(card).getByText('4 Allen Avenue')).toBeTruthy();
    expect(within(card).getByRole('link', { name: '+234 803 000 0002' }).getAttribute('href')).toBe('tel:+2348030000002');
    expect(within(card).getByText('Collect payment')).toBeTruthy();
    expect(within(card).getByText(/Bring the big table/)).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Completed' }));
    await waitFor(() => expect(ops.setStatus).toHaveBeenCalledWith('appt-9', 'completed', V1));
    expect(await screen.findByText('Marked completed.')).toBeTruthy();
  });

  it('no outcome buttons before the start; the week view asks for Monday to Sunday', async () => {
    const ops = fakeOps();
    ops.agenda.mockResolvedValue([agendaItem({ startsAt: '2030-01-07T09:00:00Z', endsAt: '2030-01-07T10:00:00Z', paymentState: 'deposit_paid' })]);
    render(<AgendaScreen ops={ops} route={route('#/agenda?view=week&date=2030-01-09')} />);
    const card = await screen.findByRole('article');
    expect(within(card).queryByRole('button')).toBeNull();
    expect(within(card).getByText('Deposit paid: collect the balance')).toBeTruthy();
    expect(ops.agenda).toHaveBeenCalledWith('2030-01-06T23:00:00.000Z', '2030-01-13T23:00:00.000Z');
  });

  it('a refusal from the server is shown on the card', async () => {
    const ops = fakeOps();
    ops.setStatus.mockRejectedValueOnce(new StaffError('stale_record'));
    render(<AgendaScreen ops={ops} route={route('#/agenda')} />);
    await userEvent.click(await screen.findByRole('button', { name: 'No-show' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Someone else changed this since you opened it. Reload and try again.');
    expect(vi.isMockFunction(ops.setStatus)).toBe(true);
  });
});
