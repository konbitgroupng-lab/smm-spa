import { vi } from 'vitest';

// Browser features jsdom does not implement, needed to render the whole site.
export function installBrowserStubs() {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
  Element.prototype.scrollIntoView = vi.fn();
  window.HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.scrollTo = vi.fn() as typeof window.scrollTo;
}
