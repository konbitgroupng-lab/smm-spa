// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import HeroVideo, { HERO_VIDEO } from '../../src/components/HeroVideo';
import { installBrowserStubs } from '../site/browser-stubs';

// The homepage banner's film.

const original = window.matchMedia;
function media(matching: string[]) {
  window.matchMedia = ((query: string) => ({
    matches: matching.includes(query), media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeAll(installBrowserStubs);
afterEach(() => {
  cleanup();
  window.matchMedia = original;
  vi.restoreAllMocks();
});

describe('banner film', () => {
  it('phones and portrait tablets get the portrait cut; wide screens the widescreen cut; silent, looping, inline, hidden from screen readers', () => {
    media([]);
    const { container, unmount } = render(<HeroVideo playing />);
    let video = container.querySelector('video')!;
    expect(video.getAttribute('src')).toBe(HERO_VIDEO.portrait.src);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.getAttribute('aria-hidden')).toBe('true');
    unmount();

    media(['(min-aspect-ratio: 1/1)']);
    video = render(<HeroVideo playing />).container.querySelector('video')!;
    expect(video.getAttribute('src')).toBe(HERO_VIDEO.landscape.src);
    expect(video.getAttribute('poster')).toBe(HERO_VIDEO.landscape.poster);
  });

  it('reduced motion: the still frame, no film', () => {
    media(['(prefers-reduced-motion: reduce)']);
    const { container } = render(<HeroVideo playing />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img')!.getAttribute('src')).toBe(HERO_VIDEO.portrait.poster);
  });

  it('plays only while its slide shows', () => {
    media([]);
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { rerender } = render(<HeroVideo playing />);
    expect(play).toHaveBeenCalled();
    rerender(<HeroVideo playing={false} />);
    expect(pause).toHaveBeenCalled();
  });

  it('the banner has a pause button that stops the slideshow (WCAG 2.2.2)', async () => {
    media([]);
    render(<App />);
    const button = screen.getByRole('button', { name: 'Pause the banner' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Play the banner' }).getAttribute('aria-pressed')).toBe('true');
  });
});
