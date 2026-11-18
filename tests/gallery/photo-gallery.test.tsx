// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from '../../src/App';
import { galleryData } from '../../src/data';
import PhotoGalleryPage from '../../src/gallery/PhotoGalleryPage';
import { FEATURED_PHOTO_COUNT, photoPageUrl } from '../../src/gallery/photoGallery';
import { resolveView } from '../../src/routes';
import { installBrowserStubs } from '../site/browser-stubs';

// The homepage's Sanctuary Gallery (three photos) and the Photo Gallery page.

beforeAll(installBrowserStubs);
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('homepage Sanctuary Gallery', () => {
  it('shows the first three photos, each opening the gallery page on that photo, and a link to the full gallery', () => {
    render(<App />);
    const section = document.getElementById('gallery')!;
    const photos = within(section).getAllByRole('link', { name: /^View photo:/ });
    expect(photos).toHaveLength(FEATURED_PHOTO_COUNT);
    expect(photos.map((a) => a.getAttribute('href'))).toEqual(galleryData.slice(0, 3).map((p) => photoPageUrl(p.id)));
    const all = within(section).getByRole('link', { name: new RegExp(`view the full gallery \\(${galleryData.length} photos\\)`, 'i') });
    expect(all.getAttribute('href')).toBe('/?view=photos');
    // The filters and the lightbox now live on the gallery page.
    expect(within(section).queryByRole('button', { name: /boutique sanctuary/i })).toBeNull();
  });
});

describe('the Photo Gallery page', () => {
  it('has its own address, optionally opened on one photo', () => {
    expect(resolveView('?view=photos')).toEqual({ page: 'photos', photoId: null });
    expect(resolveView('?view=photos&p=gal-2')).toEqual({ page: 'photos', photoId: 'gal-2' });
    expect(resolveView('?view=photos&p=<script>')).toEqual({ page: 'photos', photoId: null });
  });

  it('shows every photo and filters them by group', async () => {
    render(<PhotoGalleryPage gallery={galleryData} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sanctuary Gallery');
    expect(screen.getAllByRole('button', { name: /^Open photo:/ })).toHaveLength(galleryData.length);
    const sanctuary = galleryData.filter((p) => p.category === 'sanctuary');
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^Boutique Sanctuary \\(${sanctuary.length}\\)`) }));
    expect(screen.getAllByRole('button', { name: /^Open photo:/ }).map((b) => b.getAttribute('aria-label'))).toEqual(sanctuary.map((p) => `Open photo: ${p.title}`));
  });

  it('a photo opens large: next / previous, arrow keys, Escape closes and focus returns to the photo', async () => {
    render(<PhotoGalleryPage gallery={galleryData} />);
    const opener = screen.getByRole('button', { name: `Open photo: ${galleryData[0].title}` });
    await userEvent.click(opener);
    let dialog = screen.getByRole('dialog', { name: galleryData[0].title });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close photo' }));
    expect(window.location.search).toBe(`?view=photos&p=${galleryData[0].id}`);
    expect(dialog.textContent).toContain(`1 of ${galleryData.length}`);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Next photo' }));
    dialog = screen.getByRole('dialog', { name: galleryData[1].title });
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    dialog = screen.getByRole('dialog', { name: galleryData[0].title });
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' }); // wraps round to the last photo
    dialog = screen.getByRole('dialog', { name: galleryData[galleryData.length - 1].title });

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.location.search).toBe('?view=photos');
    expect(document.activeElement).toBe(opener);
  });

  it('opened on one photo from the homepage, also when the owner\'s photos arrive a moment later', () => {
    const owner = galleryData.map((p, i) => ({ ...p, id: `0000000${i}-0000-4000-8000-000000000000` }));
    const { rerender } = render(<PhotoGalleryPage gallery={galleryData} photoId={owner[2].id} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<PhotoGalleryPage gallery={owner} photoId={owner[2].id} />);
    expect(screen.getByRole('dialog', { name: owner[2].title })).toBeTruthy();
  });
});
