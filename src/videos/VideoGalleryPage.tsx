import { ArrowLeft, CalendarCheck, Play, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { focusRing } from '../booking/components/ui';
import {
  findVideo,
  formatDuration,
  VIDEO_CATEGORY_LABELS,
  videoGalleryData,
  videoPageUrl,
  type VideoCategory,
} from './videoGallery';

// The Video Gallery page (?view=videos, optionally &v=<clip id>): one player
// and a playlist. Nothing plays until the visitor chooses to, and only one
// clip plays at a time.

type Filter = 'all' | VideoCategory;

// `short` keeps all four tabs on one line on phones.
const FILTERS: { id: Filter; label: string; short: string }[] = [
  { id: 'all', label: 'All videos', short: 'All' },
  { id: 'services', label: VIDEO_CATEGORY_LABELS.services, short: VIDEO_CATEGORY_LABELS.services },
  { id: 'facility', label: VIDEO_CATEGORY_LABELS.facility, short: VIDEO_CATEGORY_LABELS.facility },
  { id: 'training', label: VIDEO_CATEGORY_LABELS.training, short: 'Team' },
];

/** Starts playback; a refusal (e.g. autoplay rules) just leaves the player paused. */
function safePlay(video: HTMLVideoElement | null) {
  try {
    const result = video?.play();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Older browsers throw instead of returning a promise.
  }
}

const countFor = (filter: Filter) => (filter === 'all' ? videoGalleryData.length : videoGalleryData.filter((v) => v.category === filter).length);

export default function VideoGalleryPage({ videoId = null }: { videoId?: string | null }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [current, setCurrent] = useState(() => findVideo(videoId) ?? videoGalleryData[0]);
  const [started, setStarted] = useState(false);
  const playerRef = useRef<HTMLVideoElement>(null);
  const playerBoxRef = useRef<HTMLDivElement>(null);
  const playOnLoad = useRef(false);

  useEffect(() => {
    document.title = 'Video Gallery | SMM (Sweet Mobile Massage and Spa)';
  }, []);

  // A clip chosen from the playlist starts playing (the click allows sound).
  useEffect(() => {
    if (!playOnLoad.current) return;
    playOnLoad.current = false;
    safePlay(playerRef.current);
  }, [current.id]);

  const visible = filter === 'all' ? videoGalleryData : videoGalleryData.filter((v) => v.category === filter);

  function choose(id: string) {
    const next = findVideo(id);
    if (!next) return;
    if (next.id === current.id) {
      safePlay(playerRef.current);
      return;
    }
    playOnLoad.current = true;
    setStarted(true);
    setCurrent(next);
    window.history.replaceState(null, '', videoPageUrl(next.id));
    // On narrow screens the player sits above the list: bring it into view.
    const box = playerBoxRef.current;
    if (box && box.getBoundingClientRect().top < 0) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="min-h-screen bg-spa-cream text-spa-charcoal">
      <header className="bg-spa-charcoal">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <a href="/" className={`shrink-0 rounded ${focusRing}`}>
            <img src="/assets/images/smm_logo_cropped.png" alt="SMM (Sweet Mobile Massage and Spa) — back to the website" className="h-12 w-auto sm:h-14" />
          </a>
          <nav aria-label="Video gallery" className="flex items-center gap-2 sm:gap-5">
            <a href="/#video-gallery" className={`hidden min-h-11 items-center gap-1.5 rounded px-2 text-xs uppercase tracking-widest text-spa-linen/90 hover:text-spa-gold sm:inline-flex ${focusRing}`}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to website
            </a>
            <a href="/#booking" className={`inline-flex min-h-11 items-center gap-2 rounded bg-spa-gold px-4 text-xs font-bold uppercase tracking-widest text-spa-charcoal hover:bg-white sm:px-5 ${focusRing}`}>
              <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              Book now
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-2xl space-y-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-spa-gold-dark">See It In Motion</p>
          <h1 className="font-serif text-4xl text-spa-charcoal md:text-6xl">
            Video <span className="italic">Gallery</span>
          </h1>
          <div className="mx-auto h-px w-12 bg-spa-gold" aria-hidden="true" />
          <p className="text-sm font-light text-spa-clay-text sm:text-base">
            Real sessions, our boutique sanctuary, and the team behind SMM (Sweet Mobile Massage and Spa) &mdash; captured on video.
          </p>
        </div>

        <div className="mt-12 flex justify-center border-b border-spa-taupe">
          <div className="-mb-px flex max-w-full gap-4 overflow-x-auto px-1 sm:gap-10" role="group" aria-label="Filter videos">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={active}
                  aria-label={`${f.label} (${countFor(f.id)})`}
                  className={`min-h-11 shrink-0 whitespace-nowrap border-b-2 pb-3 pt-2 text-xs font-semibold uppercase tracking-wider transition-colors sm:tracking-widest ${focusRing} ${
                    active ? 'border-spa-gold-dark text-spa-charcoal' : 'border-transparent text-spa-clay-text hover:text-spa-charcoal'
                  }`}
                >
                  <span className="sm:hidden">{f.short}</span>
                  <span className="hidden sm:inline">{f.label}</span>
                  <span className="ml-1.5 font-normal text-spa-clay-text">{countFor(f.id)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-12 grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-14">
          <div ref={playerBoxRef} className="mx-auto w-full max-w-md scroll-mt-6 lg:sticky lg:top-8">
            <div className="relative aspect-[4/5] overflow-hidden rounded bg-black shadow-2xl">
              <video
                ref={playerRef}
                key={current.id}
                src={current.videoUrl}
                poster={current.posterUrl}
                controls={started}
                playsInline
                preload="metadata"
                onPlay={() => setStarted(true)}
                aria-label={current.title}
                className="h-full w-full object-cover"
              />
              {!started && (
                <button
                  type="button"
                  onClick={() => {
                    setStarted(true);
                    safePlay(playerRef.current);
                  }}
                  className={`group absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/60 via-transparent to-transparent ${focusRing}`}
                  aria-label={`Play ${current.title}`}
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-spa-gold shadow-xl transition-transform duration-300 group-hover:scale-110" aria-hidden="true">
                    <Play className="ml-1 h-6 w-6 fill-spa-charcoal text-spa-charcoal" />
                  </span>
                </button>
              )}
            </div>
            <div className="mt-5 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-spa-gold-dark">
                {VIDEO_CATEGORY_LABELS[current.category]} · {formatDuration(current.durationSeconds)}
              </p>
              <h2 className="font-serif text-2xl text-spa-charcoal">{current.title}</h2>
              {current.hasNarration && (
                <p className="flex items-center gap-2 text-sm text-spa-clay-text">
                  <Volume2 className="h-4 w-4 text-spa-gold-dark" aria-hidden="true" />
                  Includes a voice-over — best with sound on.
                </p>
              )}
            </div>
          </div>

          <section aria-labelledby="playlist-heading">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 id="playlist-heading" className="text-xs font-bold uppercase tracking-widest text-spa-charcoal">
                {filter === 'all' ? 'All videos' : VIDEO_CATEGORY_LABELS[filter]}
              </h2>
              <p className="text-xs text-spa-clay-text">{visible.length} {visible.length === 1 ? 'video' : 'videos'}</p>
            </div>
            <ol className="divide-y divide-spa-taupe border-y border-spa-taupe">
              {visible.map((video) => {
                const playing = video.id === current.id;
                return (
                  <li key={video.id}>
                    <button
                      type="button"
                      onClick={() => choose(video.id)}
                      aria-current={playing ? 'true' : undefined}
                      className={`group flex w-full items-center gap-4 px-2 py-3 text-left transition-colors sm:gap-5 sm:px-3 ${focusRing} ${playing ? 'bg-spa-linen' : 'hover:bg-spa-linen/60'}`}
                    >
                      <span className="relative h-20 w-16 shrink-0 overflow-hidden rounded-sm bg-spa-charcoal">
                        <img src={video.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                        <span className={`absolute inset-0 flex items-center justify-center transition-colors ${playing ? 'bg-spa-charcoal/50' : 'bg-spa-charcoal/20 group-hover:bg-spa-charcoal/40'}`} aria-hidden="true">
                          <Play className="ml-0.5 h-4 w-4 fill-white text-white" />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-serif text-base text-spa-charcoal sm:text-lg">{video.title}</span>
                        <span className="mt-1 block text-[11px] uppercase tracking-wider text-spa-clay-text">
                          {VIDEO_CATEGORY_LABELS[video.category]}
                          {video.hasNarration && ' · voice-over'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {playing ? (
                          <span className="block text-[10px] font-bold uppercase tracking-widest text-spa-gold-dark">Now showing</span>
                        ) : null}
                        <span className="block font-mono text-xs tabular-nums text-spa-clay-text">{formatDuration(video.durationSeconds)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <section className="mt-20 rounded bg-spa-charcoal px-6 py-12 text-center sm:px-12">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-spa-gold">Experience it in person</p>
          <h2 className="mt-3 font-serif text-3xl text-white md:text-4xl">
            Ready for your <span className="italic">own</span> session?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm font-light text-spa-linen/80">At our boutique sanctuary in Mende, Maryland, or at your home, hotel or office in Lagos.</p>
          <a href="/#booking" className={`mt-7 inline-flex min-h-11 items-center gap-2 rounded bg-spa-gold px-7 py-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal hover:bg-white ${focusRing} focus-visible:ring-offset-spa-charcoal`}>
            <CalendarCheck className="h-4 w-4" aria-hidden="true" />
            Book a treatment
          </a>
        </section>
      </main>
    </div>
  );
}
