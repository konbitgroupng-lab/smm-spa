// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveView } from '../../src/routes';
import VideoGalleryPage from '../../src/videos/VideoGalleryPage';
import VideoGalleryPreview from '../../src/videos/VideoGalleryPreview';
import { formatDuration, videoGalleryData } from '../../src/videos/videoGallery';

afterEach(cleanup);
beforeEach(() => {
  // jsdom has no media playback.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  window.history.replaceState(null, '', '/?view=videos');
});

describe('video gallery route', () => {
  it('opens the page, with or without a valid clip id', () => {
    expect(resolveView('?view=videos')).toEqual({ page: 'videos', videoId: null });
    expect(resolveView('?view=videos&v=soft-wax')).toEqual({ page: 'videos', videoId: 'soft-wax' });
    expect(resolveView('?view=videos&v=<script>')).toEqual({ page: 'videos', videoId: null });
  });
});

describe('homepage video preview', () => {
  it('shows three still covers linking to the page, and plays nothing', () => {
    const { container } = render(<VideoGalleryPreview />);
    expect(container.querySelector('#video-gallery')).toBeTruthy();
    expect(container.querySelectorAll('video')).toHaveLength(0);
    const links = screen.getAllByRole('link', { name: /^watch /i });
    expect(links).toHaveLength(3);
    expect(links[0].getAttribute('href')).toBe('/?view=videos&v=lagos-walkthrough');
    expect(screen.getByRole('link', { name: /view the full gallery/i }).getAttribute('href')).toBe('/?view=videos');
  });
});

describe('video gallery page', () => {
  const playlist = () => within(screen.getByRole('list'));

  it('lists every clip with its real length, and starts with nothing playing', () => {
    render(<VideoGalleryPage />);
    expect(screen.getByRole('heading', { level: 1, name: /video gallery/i })).toBeTruthy();
    expect(playlist().getAllByRole('button')).toHaveLength(videoGalleryData.length);
    expect(screen.getByText(formatDuration(videoGalleryData[1].durationSeconds))).toBeTruthy();
    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('choosing a clip loads it in the player, plays it and updates the address', async () => {
    const user = userEvent.setup();
    render(<VideoGalleryPage />);
    await user.click(playlist().getByRole('button', { name: /soft wax treatment/i }));
    expect(document.querySelector('video')!.getAttribute('src')).toBe('/assets/videos/gallery/soft-wax.mp4');
    expect(playlist().getByRole('button', { name: /soft wax treatment/i }).getAttribute('aria-current')).toBe('true');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(window.location.search).toBe('?view=videos&v=soft-wax');
  });

  it('filters the playlist by category', async () => {
    const user = userEvent.setup();
    render(<VideoGalleryPage />);
    await user.click(screen.getByRole('button', { name: /^team & training/i }));
    const titles = playlist().getAllByRole('button').map((b) => b.textContent);
    expect(titles).toHaveLength(2);
    expect(titles.every((t) => /training/i.test(t ?? ''))).toBe(true);
  });

  it('a link to one clip opens the page on that clip', () => {
    render(<VideoGalleryPage videoId="ceo-training-talk" />);
    expect(screen.getByRole('heading', { level: 2, name: 'CEO Training Talk' })).toBeTruthy();
    expect(screen.getByText(/voice-over — best with sound on/i)).toBeTruthy();
  });

  it('an unknown clip id falls back to the first clip', () => {
    render(<VideoGalleryPage videoId="no-such-clip" />);
    expect(screen.getByRole('heading', { level: 2, name: videoGalleryData[0].title })).toBeTruthy();
  });
});
