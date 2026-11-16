// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsAppEnquiryLink from '../../src/components/WhatsAppEnquiryLink';
import WhatsAppWidget from '../../src/components/WhatsAppWidget';
import { announceBookingEngaged } from '../../src/components/widgetEvents';
import {
  BUSINESS_NAME,
  serviceEnquiryMessage,
  WHATSAPP_DEFAULT_ENQUIRY,
  WHATSAPP_NUMBER,
  whatsappUrl,
} from '../../src/config/business';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const textOf = (url: string) => new URL(url).searchParams.get('text');

describe('business WhatsApp configuration', () => {
  it('uses an international number with digits only', () => {
    expect(WHATSAPP_NUMBER).toMatch(/^[1-9]\d{7,14}$/);
  });

  it('builds a click-to-chat link with the message encoded', () => {
    const url = whatsappUrl('Hello & welcome? 50% off #1 👋');
    expect(url.startsWith(`https://wa.me/${WHATSAPP_NUMBER}?text=`)).toBe(true);
    expect(url).not.toMatch(/[ &#?](?!text=)[^=]*$/); // nothing unencoded after text=
    expect(textOf(url)).toBe('Hello & welcome? 50% off #1 👋');
  });

  it('falls back to the default enquiry for an empty or blank message', () => {
    expect(textOf(whatsappUrl(''))).toBe(WHATSAPP_DEFAULT_ENQUIRY);
    expect(textOf(whatsappUrl('   '))).toBe(WHATSAPP_DEFAULT_ENQUIRY);
    expect(WHATSAPP_DEFAULT_ENQUIRY).toBe('Hello! 👋 I would like to make an enquiry. Please assist me.');
  });

  it('writes service enquiries with their details', () => {
    expect(serviceEnquiryMessage('Swedish Massage', ['60 mins', '₦40,000', null])).toBe(
      'Hello, I am interested in Swedish Massage (60 mins · ₦40,000). Kindly provide me with more information.',
    );
    expect(serviceEnquiryMessage('Gift cards')).toBe('Hello, I am interested in Gift cards. Kindly provide me with more information.');
  });
});

describe('WhatsApp chat concierge', () => {
  let opened: string[];
  beforeEach(() => {
    opened = [];
    vi.spyOn(window, 'open').mockImplementation((url) => {
      opened.push(String(url));
      return {} as Window;
    });
  });

  it('starts closed, opens with the brand, greeting and a focused message box, and closes', async () => {
    const user = userEvent.setup();
    render(<WhatsAppWidget />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const toggle = screen.getByRole('button', { name: /chat with us on whatsapp/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await user.click(toggle);
    const dialog = screen.getByRole('dialog', { name: BUSINESS_NAME });
    expect(dialog.textContent).toContain('Chat with us on WhatsApp');
    expect(dialog.textContent).toContain(`Hello! 👋 Welcome to ${BUSINESS_NAME}.`);
    expect(dialog.textContent).toContain('How can we assist you today?');
    expect(document.activeElement).toBe(screen.getByLabelText(/your message/i));

    await user.click(screen.getByRole('button', { name: /close chat/i }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(toggle);
  });

  it('sends the typed message to the business number and closes', async () => {
    const user = userEvent.setup();
    render(<WhatsAppWidget />);
    await user.click(screen.getByRole('button', { name: /chat with us on whatsapp/i }));
    await user.type(screen.getByLabelText(/your message/i), 'Do you do couples massage?');
    await user.click(screen.getByRole('button', { name: /send on whatsapp/i }));
    expect(opened).toHaveLength(1);
    expect(opened[0].startsWith(`https://wa.me/${WHATSAPP_NUMBER}?text=`)).toBe(true);
    expect(textOf(opened[0])).toBe('Do you do couples massage?');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Enter sends, Shift+Enter adds a line', async () => {
    const user = userEvent.setup();
    render(<WhatsAppWidget />);
    await user.click(screen.getByRole('button', { name: /chat with us on whatsapp/i }));
    await user.type(screen.getByLabelText(/your message/i), 'Line one{Shift>}{Enter}{/Shift}Line two{Enter}');
    expect(textOf(opened[0])).toBe('Line one\nLine two');
  });

  it('an empty message sends the default enquiry', async () => {
    const user = userEvent.setup();
    render(<WhatsAppWidget />);
    await user.click(screen.getByRole('button', { name: /chat with us on whatsapp/i }));
    await user.click(screen.getByRole('button', { name: /send on whatsapp/i }));
    expect(textOf(opened[0])).toBe(WHATSAPP_DEFAULT_ENQUIRY);
  });

  it('falls back to this tab when a pop-up blocker refuses the new tab', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign } as Location);
    const user = userEvent.setup();
    render(<WhatsAppWidget />);
    await user.click(screen.getByRole('button', { name: /chat with us on whatsapp/i }));
    await user.click(screen.getByRole('button', { name: /send on whatsapp/i }));
    expect(assign).toHaveBeenCalledWith(whatsappUrl(WHATSAPP_DEFAULT_ENQUIRY));
  });

  it('Escape closes it, and so does starting a booking', async () => {
    const user = userEvent.setup();
    render(<WhatsAppWidget />);
    await user.click(screen.getByRole('button', { name: /chat with us on whatsapp/i }));
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: /chat with us on whatsapp/i }));
    announceBookingEngaged();
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('never opens by itself', async () => {
    render(<WhatsAppWidget />);
    await new Promise((r) => setTimeout(r, 2500));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('service enquiry link', () => {
  it('opens WhatsApp in a new tab asking about that service', () => {
    render(<WhatsAppEnquiryLink name="Hot Stone Therapy" details={['60 mins', '₦50,000']} />);
    const link = screen.getByRole('link', { name: /ask about hot stone therapy on whatsapp/i });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(textOf(link.getAttribute('href')!)).toBe('Hello, I am interested in Hot Stone Therapy (60 mins · ₦50,000). Kindly provide me with more information.');
  });
});
