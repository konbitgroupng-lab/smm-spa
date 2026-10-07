// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BookingFunnel from '../../../src/booking/components/BookingFunnel';
import { ApiError, makeApi, makeCatalog, makeHold, makePayment } from '../fixtures';

// The funnel's screens, driven the way a guest would: by clicking and typing,
// and by keyboard alone.

afterEach(cleanup);

const CALLBACK = 'http://localhost:3000/?view=payment-return';

function renderFunnel(api = makeApi(), options: { preselect?: string; catalog?: ReturnType<typeof makeCatalog> } = {}) {
  const navigate = vi.fn();
  const user = userEvent.setup();
  render(<BookingFunnel catalog={options.catalog ?? makeCatalog()} callbackUrl={CALLBACK} api={api} navigate={navigate} preselectServiceId={options.preselect} />);
  return { api, navigate, user };
}

const nextButton = (name: RegExp) => screen.getByRole('button', { name });
const heading = (name: RegExp) => screen.getByRole('heading', { level: 3, name });

/** Treatment -> therapist (any) -> first date -> times shown. */
async function toTimes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: /swedish massage/i }));
  await user.click(nextButton(/next: therapist/i));
  await user.click(nextButton(/next: date/i));
  await user.click(screen.getAllByRole('radio', { name: /2026|20\d\d/ })[1]);
  await screen.findByRole('list', { name: /available times/i });
}

/** ...through to the details form with a time held. */
async function toDetails(user: ReturnType<typeof userEvent.setup>) {
  await toTimes(user);
  const times = within(screen.getByRole('list', { name: /available times/i })).getAllByRole('button');
  await user.click(times[0]);
  await screen.findByRole('heading', { level: 3, name: /your details/i });
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/full name/i), 'Ngozi Example');
  await user.type(screen.getByLabelText(/^email/i), 'ngozi@example.com');
  await user.type(screen.getByLabelText(/^phone/i), '+234 801 234 5678');
}

describe('treatment & venue step', () => {
  it('lists treatments and packages with prices, and continues only once a treatment is chosen', async () => {
    const { user } = renderFunnel();
    expect(heading(/treatment & venue/i)).toBeTruthy();
    const treatments = screen.getAllByRole('radio', { name: /massage|therapy|escape/i });
    expect(treatments.map((r) => r.closest('label')!.textContent)).toEqual([
      expect.stringContaining('₦40,000'), expect.stringContaining('₦50,000'), expect.stringContaining('₦80,000'),
    ]);
    expect(nextButton(/next: therapist/i)).toHaveProperty('disabled', true);
    expect(screen.getByText(/choose a treatment to continue/i)).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: /hot stone/i }));
    expect(nextButton(/next: therapist/i)).toHaveProperty('disabled', false);
  });

  it('asks for an area and a full address for an in-home visit', async () => {
    const { user } = renderFunnel();
    await user.click(screen.getByRole('radio', { name: /swedish massage/i }));
    await user.click(screen.getByRole('radio', { name: /mobile in-home spa/i }));
    expect(nextButton(/next: therapist/i)).toHaveProperty('disabled', true);

    await user.selectOptions(screen.getByLabelText(/your area/i), 'zone-vi');
    expect(screen.getByRole('option', { name: /victoria island \(\+₦8,000\)/i })).toBeTruthy();
    await user.type(screen.getByLabelText(/street address/i), '12');
    expect(screen.getByText(/please enter the full address/i)).toBeTruthy();
    expect(screen.getByLabelText(/street address/i).getAttribute('aria-describedby')).toBe('booking-address-hint');

    await user.type(screen.getByLabelText(/street address/i), ' Example Street');
    expect(nextButton(/next: therapist/i)).toHaveProperty('disabled', false);
  });
});

describe('therapist step', () => {
  it('offers "any available therapist" and only therapists who do the chosen treatment', async () => {
    const { user } = renderFunnel();
    await user.click(screen.getByRole('radio', { name: /hot stone/i }));
    await user.click(nextButton(/next: therapist/i));
    const options = screen.getAllByRole('radio').map((r) => r.closest('label')!.textContent);
    expect(options).toEqual([expect.stringContaining('Any available therapist'), expect.stringContaining('Ada')]);
    expect((screen.getByRole('radio', { name: /any available therapist/i }) as HTMLInputElement).checked).toBe(true);
  });
});

describe('date & time step', () => {
  it('shows the server\'s free times for the chosen date and announces them', async () => {
    const { user, api } = renderFunnel();
    await toTimes(user);
    expect(api.getAvailableSlots).toHaveBeenCalledTimes(1);
    const times = within(screen.getByRole('list', { name: /available times/i })).getAllByRole('button');
    expect(times.map((t) => t.textContent)).toEqual(['09:00', '10:00']);
    expect(screen.getByText(/2 times available on/i)).toBeTruthy(); // live region
  });

  it('when the time was just taken: explains, and reloads the times', async () => {
    const api = makeApi({ createHold: async () => { throw new ApiError('slot_unavailable'); } });
    const { user } = renderFunnel(api);
    await toTimes(user);
    await user.click(within(screen.getByRole('list', { name: /available times/i })).getAllByRole('button')[0]);
    expect((await screen.findByRole('alert')).textContent).toMatch(/just been booked by someone else/i);
    await waitFor(() => expect(api.getAvailableSlots).toHaveBeenCalledTimes(2));
    expect(heading(/date & time/i)).toBeTruthy();
  });

  it('marks the guest\'s own reserved time when they come back to change it', async () => {
    const api = makeApi({ getAvailableSlots: async () => [] }); // the server no longer lists a held time
    api.getAvailableSlots.mockResolvedValueOnce([{ startsAt: new Date('2026-10-12T09:00:00+01:00').toISOString(), endsAt: new Date('2026-10-12T10:00:00+01:00').toISOString(), therapistIds: ['th-ada'] }]);
    const { user } = renderFunnel(api, { catalog: makeCatalog() });
    await user.click(screen.getByRole('radio', { name: /swedish massage/i }));
    await user.click(nextButton(/next: therapist/i));
    await user.click(nextButton(/next: date/i));
    await user.click(screen.getByRole('radio', { name: /monday 12 october 2026/i }).closest('label')!.querySelector('input')!);
    await user.click(await screen.findByRole('button', { name: '09:00' }));
    await screen.findByRole('heading', { level: 3, name: /your details/i });

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    const mine = await screen.findByRole('button', { name: '09:00, reserved for you' });
    expect(mine.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('holding a time', () => {
  it('shows a countdown, and explains when the reserved time runs out', async () => {
    const api = makeApi({ createHold: async (request) => makeHold(request.startsAt, 'th-ada', 1500) });
    const { user } = renderFunnel(api);
    await toDetails(user);
    expect(screen.getAllByRole('timer').length).toBeGreaterThan(0);
    expect((await screen.findByRole('alert', {}, { timeout: 4000 })).textContent).toMatch(/reserved time ran out/i);
    expect(heading(/date & time/i)).toBeTruthy();
  });

  it('"Start again" gives the reserved time back', async () => {
    const { user, api } = renderFunnel();
    await toDetails(user);
    await user.click(screen.getByRole('button', { name: /start again/i }));
    await waitFor(() => expect(api.releaseHold).toHaveBeenCalledTimes(1));
    expect(heading(/treatment & venue/i)).toBeTruthy();
  });
});

describe('details step', () => {
  it('flags invalid details on the fields themselves and sends nothing', async () => {
    const { user, api } = renderFunnel();
    await toDetails(user);
    await user.click(nextButton(/review & pay/i));
    for (const label of [/full name/i, /^email/i, /^phone/i]) {
      const field = screen.getByLabelText(label);
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(document.getElementById(field.getAttribute('aria-describedby')!)!.textContent).toMatch(/please enter/i);
    }
    expect(api.attachCustomer).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull(); // field messages, not a banner
  });

  it('hides the sticky summary while the guest is typing', async () => {
    const { user } = renderFunnel();
    await toDetails(user);
    expect(screen.getByTestId('sticky-summary')).toBeTruthy();
    await user.click(screen.getByLabelText(/full name/i));
    expect(screen.queryByTestId('sticky-summary')).toBeNull();
    await user.click(heading(/your details/i));
    expect(screen.getByTestId('sticky-summary')).toBeTruthy();
  });

  it('a hold that expired on the server sends the guest back to choose a time', async () => {
    const api = makeApi({ startPayment: async () => { throw new ApiError('hold_expired'); } });
    const { user } = renderFunnel(api);
    await toDetails(user);
    await fillDetails(user);
    await user.click(nextButton(/review & pay/i));
    expect((await screen.findByRole('alert')).textContent).toMatch(/reserved time ran out/i);
    expect(heading(/date & time/i)).toBeTruthy();
  });
});

describe('review & pay step', () => {
  it('shows an estimate first, then the server\'s amount as final', async () => {
    const api = makeApi({ startPayment: async () => makePayment({ amountMinor: 2_000_000, bookingTotalMinor: 4_000_000, kind: 'deposit', demo: false }) });
    const { user, navigate } = renderFunnel(api);
    await toDetails(user);
    expect(screen.getByTestId('estimated-amount').textContent).toBe('₦40,000');
    expect(screen.getByTestId('sticky-summary').textContent).toMatch(/estimate/i);

    await fillDetails(user);
    await user.click(nextButton(/review & pay/i));
    await screen.findByRole('heading', { level: 3, name: /review & pay/i });
    expect(screen.getByTestId('amount-due').textContent).toBe('₦20,000');
    expect(screen.getByText(/deposit towards ₦40,000/i)).toBeTruthy();
    expect(screen.getByText(/final amount, confirmed by our booking system/i)).toBeTruthy();
    expect(screen.queryByTestId('estimated-amount')).toBeNull();
    expect(screen.getByTestId('final-amount').textContent).toBe('₦20,000');

    await user.click(screen.getByRole('button', { name: /pay securely/i }));
    expect(navigate).toHaveBeenCalledWith(makePayment().checkoutUrl);
  });

  it('shows the demo notice only when the server says the payment is simulated', async () => {
    const demo = renderFunnel(makeApi({ startPayment: async () => makePayment({ demo: true }) }));
    await toDetails(demo.user);
    expect(screen.queryByText(/demo payment — no real money will be charged/i)).toBeNull(); // not before the server says so
    await fillDetails(demo.user);
    await demo.user.click(nextButton(/review & pay/i));
    expect(await screen.findByText(/demo payment — no real money will be charged/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /continue to demo payment/i })).toBeTruthy();
    cleanup();

    const real = renderFunnel(makeApi({ startPayment: async () => makePayment({ demo: false }) }));
    await toDetails(real.user);
    await fillDetails(real.user);
    await real.user.click(nextButton(/review & pay/i));
    await screen.findByRole('heading', { level: 3, name: /review & pay/i });
    expect(screen.queryByText(/demo payment/i)).toBeNull();
    expect(screen.getByRole('button', { name: /pay securely/i })).toBeTruthy();
  });
});

describe('navigation and focus', () => {
  it('moves focus to each new step\'s heading, and the step bar only goes back', async () => {
    const { user } = renderFunnel();
    expect(document.activeElement).toBe(document.body); // no focus stolen on load
    await user.click(screen.getByRole('radio', { name: /swedish massage/i }));
    await user.click(nextButton(/next: therapist/i));
    expect(document.activeElement).toBe(heading(/your therapist/i));

    const steps = within(screen.getByRole('navigation', { name: /booking steps/i })).getAllByRole('button');
    expect(steps.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, true, true, true, true]);
    expect(steps[1].getAttribute('aria-current')).toBe('step');
    await user.click(steps[0]);
    expect(document.activeElement).toBe(heading(/treatment & venue/i));
  });

  it('can be completed with the keyboard alone', async () => {
    const { user, navigate } = renderFunnel();
    // Treatment: tab into the radio group, arrow to "Hot Stone", then on to Next.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /swedish massage/i }));
    await user.keyboard('{ArrowDown}');
    expect((screen.getByRole('radio', { name: /hot stone/i }) as HTMLInputElement).checked).toBe(true);
    nextButton(/next: therapist/i).focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(heading(/your therapist/i));

    nextButton(/next: date/i).focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(heading(/date & time/i));

    // Date: first radio of the strip, arrow to the next day.
    await user.tab();
    await user.keyboard('{ArrowRight}');
    await screen.findByRole('list', { name: /available times/i });
    within(screen.getByRole('list', { name: /available times/i })).getAllByRole('button')[0].focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.activeElement).toBe(heading(/your details/i)));

    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText(/full name/i));
    await user.keyboard('Ngozi Example');
    await user.tab();
    await user.keyboard('ngozi@example.com');
    await user.tab();
    await user.keyboard('+234 801 234 5678');
    await user.keyboard('{Enter}'); // submits the form
    await waitFor(() => expect(document.activeElement).toBe(heading(/review & pay/i)));

    screen.getByRole('button', { name: /continue to demo payment/i }).focus();
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe('accessibility basics', () => {
  it('every field has a label and every control is at least 44px tall', async () => {
    const { user } = renderFunnel();
    await user.click(screen.getByRole('radio', { name: /swedish massage/i }));
    await user.click(screen.getByRole('radio', { name: /mobile in-home spa/i }));
    for (const field of document.querySelectorAll('input:not([type=radio]), select, textarea')) {
      expect(field.id && document.querySelector(`label[for="${field.id}"]`)).toBeTruthy();
    }
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toMatch(/min-h-11|h-11/);
    }
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.closest('label')!.className).toMatch(/min-h-11|py-3/);
    }
  });

  it('keeps the hidden date inputs inside the scrolling strip, so the page never widens', async () => {
    // Regression: an absolutely positioned hidden input escapes a scroll box unless an
    // ancestor inside it is positioned; in a real browser the page grew to ~4,900px.
    const { user } = renderFunnel();
    await user.click(screen.getByRole('radio', { name: /swedish massage/i }));
    await user.click(nextButton(/next: therapist/i));
    await user.click(nextButton(/next: date/i));
    for (const input of document.querySelectorAll('input[name="booking-date"]')) {
      expect(input.className).toMatch(/sr-only/);
      expect(input.closest('label')!.className.split(/\s+/)).toContain('relative');
    }
  });

  it('respects reduced motion: animations are opt-in via motion-safe only', () => {
    renderFunnel();
    const animated = [...document.querySelectorAll('[class*="animate-"]')];
    expect(animated.every((el) => /motion-safe:animate-/.test(el.className))).toBe(true);
  });

  it('announces the countdown at milestones through a polite live region, not every second', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = makeApi({ createHold: async (request) => makeHold(request.startsAt, 'th-ada', 121_500) });
      const { user } = renderFunnel(api);
      await toDetails(user);
      const live = () => [...document.querySelectorAll('[aria-live="polite"]')].map((el) => el.textContent).join(' ');
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
      expect(live()).toMatch(/reserved for 2 more minutes/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
