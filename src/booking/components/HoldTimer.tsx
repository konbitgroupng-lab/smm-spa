import { Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { remaining } from '../dates';

// Shows how long the guest's time stays reserved. The visible countdown ticks
// every second; screen readers are told only at a few milestones, so they are
// not interrupted every second.

const MILESTONES = [300, 120, 60, 30];

function announcementFor(seconds: number): string {
  if (seconds <= 0) return 'Your reserved time has run out.';
  const minutes = Math.ceil(seconds / 60);
  return seconds >= 60
    ? `Your time is reserved for ${minutes} more minute${minutes === 1 ? '' : 's'}.`
    : `Your time is reserved for ${seconds} more seconds. Please complete your booking.`;
}

export default function HoldTimer({ expiresAt, compact = false }: { expiresAt: string; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const { totalSeconds, label } = remaining(expiresAt, now);
  const urgent = totalSeconds <= 120;

  // Announce each milestone once, when it is crossed. Ticks can skip seconds
  // (browsers throttle timers in background tabs), so compare, don't match.
  const smallestCrossed = (seconds: number) => Math.min(Infinity, ...[...MILESTONES, 0].filter((m) => seconds <= m));
  const announced = useRef(smallestCrossed(totalSeconds)); // nothing is announced on first display
  useEffect(() => {
    const crossed = smallestCrossed(totalSeconds);
    if (crossed < announced.current) {
      announced.current = crossed;
      setAnnouncement(announcementFor(totalSeconds));
    }
  }, [totalSeconds]);

  return (
    <div className={`flex items-center gap-2 ${compact ? 'text-xs' : 'text-sm'} ${urgent ? 'font-semibold text-spa-berry' : 'text-spa-charcoal'}`}>
      <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {compact ? 'Reserved ' : 'Your time is reserved for '}
        <span role="timer" aria-label={`${Math.floor(totalSeconds / 60)} minutes ${totalSeconds % 60} seconds remaining`} className="font-mono tabular-nums">
          {label}
        </span>
      </span>
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
