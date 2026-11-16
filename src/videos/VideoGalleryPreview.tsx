import { ArrowRight, Play } from 'lucide-react';
import { focusRing } from '../booking/components/ui';
import { featuredVideoIds, findVideo, formatDuration, VIDEO_CATEGORY_LABELS, videoGalleryData, videoPageUrl, type VideoGalleryItem } from './videoGallery';

// The homepage's "See It In Motion" section: three still covers (nothing plays
// until the visitor asks) leading to the full Video Gallery page.

const featured = featuredVideoIds.map(findVideo).filter((v): v is VideoGalleryItem => Boolean(v));

export default function VideoGalleryPreview() {
  return (
    <section id="video-gallery" className="py-24 bg-spa-cream border-t border-spa-taupe relative">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto space-y-4 mb-14">
          <span className="text-spa-gold text-xs uppercase tracking-[0.3em] font-semibold block">See It In Motion</span>
          <h2 className="font-serif text-3xl md:text-5xl text-spa-charcoal">Video <span className="italic">Gallery</span></h2>
          <div className="w-12 h-[1px] bg-spa-gold mx-auto mt-4"></div>
          <p className="text-spa-clay text-sm font-light mt-4">
            Real sessions, our boutique sanctuary, and the team behind SMM (Sweet Mobile Massage and Spa) &mdash; captured on video.
          </p>
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-6 lg:gap-8 max-w-sm sm:max-w-none mx-auto">
          {featured.map((video) => (
            <li key={video.id}>
              <a href={videoPageUrl(video.id)} className={`group block rounded ${focusRing}`} aria-label={`Watch ${video.title} (${formatDuration(video.durationSeconds)})`}>
                <div className="relative aspect-[4/5] overflow-hidden rounded bg-spa-charcoal shadow-sm transition-shadow duration-300 group-hover:shadow-2xl">
                  <img
                    src={video.posterUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-spa-charcoal/80 via-spa-charcoal/10 to-transparent" aria-hidden="true" />
                  <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/60 bg-spa-charcoal/40 backdrop-blur-sm transition-colors duration-300 group-hover:border-spa-gold group-hover:bg-spa-gold" aria-hidden="true">
                    <Play className="ml-0.5 h-5 w-5 fill-white text-white transition-colors group-hover:fill-spa-charcoal group-hover:text-spa-charcoal" />
                  </span>
                  <div className="absolute inset-x-0 bottom-0 p-5 text-left">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-spa-gold">
                      {VIDEO_CATEGORY_LABELS[video.category]} · {formatDuration(video.durationSeconds)}
                    </p>
                    <p className="mt-1.5 font-serif text-lg text-white">{video.title}</p>
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-12 text-center">
          <a
            href={videoPageUrl()}
            className={`inline-flex min-h-11 items-center gap-2 rounded border border-spa-charcoal px-7 py-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal transition-colors hover:bg-spa-charcoal hover:text-spa-cream ${focusRing}`}
          >
            View the full gallery
            <span className="hidden sm:inline">({videoGalleryData.length} videos)</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
