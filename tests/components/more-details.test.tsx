// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import MoreDetails from '../../src/components/MoreDetails';

afterEach(cleanup);

describe('folded card details', () => {
  it('starts folded; the button opens and closes the list and says which state it is in', async () => {
    render(<MoreDetails label="Key benefits" items={['Eases tension', 'Better sleep']} />);
    const button = screen.getByRole('button', { name: /see key benefits/i });
    const list = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(list.hidden).toBe(true);
    expect(list.textContent).toContain('Eases tension'); // in the page, only hidden from view

    await userEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(list.hidden).toBe(false);
    expect(screen.getByRole('button', { name: /hide key benefits/i })).toBe(button);
    await userEvent.click(button);
    expect(list.hidden).toBe(true);
  });

  it('shows nothing when there is nothing to list', () => {
    const { container } = render(<MoreDetails label="What's included" items={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
