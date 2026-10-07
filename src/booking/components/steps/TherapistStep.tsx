import { forwardRef } from 'react';
import type { BookingFunnel } from '../../useBookingFunnel';
import { ChoiceCard, PrimaryButton, SecondaryButton, StepHeading } from '../ui';

export const TherapistStep = forwardRef<HTMLHeadingElement, { funnel: BookingFunnel }>(function TherapistStep({ funnel }, headingRef) {
  const { state, therapists } = funnel;
  return (
    <div className="space-y-8">
      <StepHeading ref={headingRef} hint="Any available therapist gives you the most times to choose from.">
        Your therapist
      </StepHeading>

      <fieldset>
        <legend className="sr-only">Therapist</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ChoiceCard
            name="booking-therapist"
            value="any"
            checked={state.therapistId === null}
            onChange={() => funnel.selectTherapist(null)}
            title="Any available therapist"
            detail="We match you with a specialist for your treatment"
          />
          {therapists.map((t) => (
            <ChoiceCard
              key={t.dbId}
              name="booking-therapist"
              value={t.dbId!}
              checked={state.therapistId === t.dbId}
              onChange={funnel.selectTherapist}
              title={t.name}
              detail={t.specialty || t.role}
            />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <SecondaryButton onClick={funnel.back} className="w-full sm:w-auto">Back</SecondaryButton>
        <PrimaryButton onClick={() => funnel.goTo('datetime')} className="w-full sm:w-auto">
          Next: date &amp; time
        </PrimaryButton>
      </div>
    </div>
  );
});
