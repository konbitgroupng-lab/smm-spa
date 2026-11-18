import { useEffect, useRef, useState } from 'react';

// The homepage banner's background film: a short, silent, looping tour of the
// sanctuary. Two cuts of the same film: portrait for phones and portrait
// tablets, widescreen for wider screens. Guests who ask for reduced motion, or
// whose browser asks to save data, see its still frame instead.

export const HERO_VIDEO = {
  portrait: { src: '/assets/videos/hero/hero-portrait.mp4', poster: '/assets/videos/hero/hero-portrait.jpg' },
  landscape: { src: '/assets/videos/hero/hero-landscape.mp4', poster: '/assets/videos/hero/hero-landscape.jpg' },
  /** Length of the film: the banner shows it once before moving to the next slide. */
  durationMs: 10_400,
};

const WIDE = '(min-aspect-ratio: 1/1)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

function saveData(): boolean {
  const connection = (typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection : undefined);
  return connection?.saveData === true;
}

export default function HeroVideo({ playing, className = '' }: {
  /** The banner's first slide is showing and the guest has not paused it. */
  playing: boolean;
  className?: string;
}) {
  const [wide, setWide] = useState(() => matches(WIDE));
  const [still] = useState(() => matches(REDUCED_MOTION) || saveData());
  const ref = useRef<HTMLVideoElement>(null);

  // Follow the screen's shape (a phone turned sideways, a resized window).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(WIDE);
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Play from the start whenever the slide comes back; pause while hidden.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (playing) {
      video.currentTime = 0;
      video.play().catch(() => undefined); // autoplay refused: the still frame stays
    } else {
      video.pause();
    }
  }, [playing, wide]);

  const cut = wide ? HERO_VIDEO.landscape : HERO_VIDEO.portrait;

  if (still) {
    return <img src={cut.poster} alt="" aria-hidden="true" className={className} />;
  }
  return (
    <video
      ref={ref}
      key={cut.src}
      className={className}
      src={cut.src}
      poster={cut.poster}
      muted
      loop
      playsInline
      autoPlay={playing}
      preload="auto"
      disablePictureInPicture
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
