// The site's video clips, shared by the homepage preview and the Video Gallery
// page. Posters are still frames taken from each clip; durations are the files'
// real lengths.

export type VideoCategory = 'services' | 'facility' | 'training';

export interface VideoGalleryItem {
  id: string;
  title: string;
  category: VideoCategory;
  videoUrl: string;
  posterUrl: string;
  durationSeconds: number;
  /** The clip has a spoken voice-over worth hearing with sound on. */
  hasNarration?: boolean;
}

export const VIDEO_CATEGORY_LABELS: Record<VideoCategory, string> = {
  services: 'Services',
  facility: 'Facility',
  training: 'Team & Training',
};

const clip = (id: string, title: string, category: VideoCategory, durationSeconds: number, hasNarration = false): VideoGalleryItem => ({
  id,
  title,
  category,
  videoUrl: `/assets/videos/gallery/${id}.mp4`,
  posterUrl: `/assets/videos/gallery/posters/${id}.jpg`,
  durationSeconds,
  hasNarration,
});

export const videoGalleryData: VideoGalleryItem[] = [
  clip('lagos-walkthrough', 'Lagos Sanctuary Walkthrough', 'facility', 19),
  clip('thai-stone-massage', 'Thai Stone Massage', 'services', 55),
  clip('abuja-training-highlight', 'Abuja Training Highlight', 'training', 25, true),
  clip('teeth-whitening', 'Teeth Whitening Session', 'services', 46),
  clip('soft-wax', 'Soft Wax Treatment', 'services', 29),
  clip('full-body-detox', 'Full Body Detox', 'services', 31),
  clip('spa-rooms', 'Spa Rooms & Facility Tour', 'facility', 14),
  clip('operational-hours', 'We Are Open', 'facility', 16),
  clip('ceo-training-talk', 'CEO Training Talk', 'training', 60, true),
];

/** One clip from each category, for the homepage preview. */
export const featuredVideoIds = ['lagos-walkthrough', 'thai-stone-massage', 'abuja-training-highlight'];

export function findVideo(id: string | null | undefined): VideoGalleryItem | undefined {
  return videoGalleryData.find((v) => v.id === id);
}

/** 75 -> "1:15" */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Link to the Video Gallery page, optionally opening one clip. */
export function videoPageUrl(id?: string): string {
  return id ? `/?view=videos&v=${encodeURIComponent(id)}` : '/?view=videos';
}
