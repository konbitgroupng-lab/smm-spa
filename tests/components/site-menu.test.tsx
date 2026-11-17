// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import SiteMenu, { type SiteMenuLink } from '../../src/components/SiteMenu';

afterEach(cleanup);

const LINKS: SiteMenuLink[] = [
  { href: '#about', label: 'About Us' },
  { href: '#booking', label: 'Book Online', emphasis: true },
  { href: '#faqs', label: 'FAQs' },
];

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <SiteMenu links={LINKS} open={open} onOpenChange={setOpen} />
      <p>Outside the menu</p>
    </div>
  );
}

const toggle = () => screen.getByRole('button', { name: /menu/i });
const panel = () => document.getElementById('site-menu-panel')!;

describe('header Menu button (phones, tablets, small laptops)', () => {
  it('starts closed and opens to list every section link', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(panel().hidden).toBe(true);

    await user.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe('Close menu');
    expect(panel().hidden).toBe(false);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#about', '#booking', '#faqs']);
    expect(links.map((a) => a.textContent)).toEqual(['About Us', 'Book Online', 'FAQs']);
  });

  it('closes on Escape and returns focus to the button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(toggle());
    await user.keyboard('{Escape}');
    expect(panel().hidden).toBe(true);
    expect(document.activeElement).toBe(toggle());
  });

  it('closes when a section link is chosen', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(toggle());
    await user.click(screen.getByRole('link', { name: 'FAQs' }));
    expect(panel().hidden).toBe(true);
  });

  it('closes on a click outside it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(toggle());
    await user.click(screen.getByText('Outside the menu'));
    expect(panel().hidden).toBe(true);
  });
});
