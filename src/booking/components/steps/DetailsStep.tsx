import { forwardRef, type FormEvent } from 'react';
import type { DetailsField } from '../../funnel';
import type { BookingFunnel } from '../../useBookingFunnel';
import { FieldLabel, inputClass, PrimaryButton, SecondaryButton, StepHeading } from '../ui';

const FIELDS: { name: Exclude<DetailsField, 'notes'>; label: string; type: string; autoComplete: string; inputMode?: 'email' | 'tel' }[] = [
  { name: 'fullName', label: 'Full name', type: 'text', autoComplete: 'name' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email', inputMode: 'email' },
  { name: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel', inputMode: 'tel' },
];

export const DetailsStep = forwardRef<HTMLHeadingElement, { funnel: BookingFunnel }>(function DetailsStep({ funnel }, headingRef) {
  const { state, fieldErrors } = funnel;
  const busy = state.pending === 'details' || state.pending === 'payment';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void funnel.submitDetails();
  };

  return (
    <form className="space-y-8" onSubmit={submit} noValidate>
      <StepHeading ref={headingRef} hint="We use these only for this booking.">
        Your details
      </StepHeading>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const error = fieldErrors[field.name];
          const id = `booking-${field.name}`;
          return (
            <div key={field.name} className={`space-y-2 ${field.name === 'fullName' ? 'sm:col-span-2' : ''}`}>
              <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
              <input
                id={id}
                name={field.name}
                type={field.type}
                inputMode={field.inputMode}
                autoComplete={field.autoComplete}
                required
                className={inputClass}
                value={state.details[field.name]}
                onChange={(e) => funnel.updateDetails({ [field.name]: e.target.value })}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
              />
              {error && (
                <p id={`${id}-error`} className="text-xs text-spa-berry">
                  {error}
                </p>
              )}
            </div>
          );
        })}
        <div className="space-y-2 sm:col-span-2">
          <FieldLabel htmlFor="booking-notes">Anything your therapist should know (optional)</FieldLabel>
          <textarea
            id="booking-notes"
            rows={3}
            className={inputClass}
            value={state.details.notes}
            onChange={(e) => funnel.updateDetails({ notes: e.target.value })}
            aria-invalid={fieldErrors.notes ? true : undefined}
            aria-describedby={fieldErrors.notes ? 'booking-notes-error' : undefined}
          />
          {fieldErrors.notes && (
            <p id="booking-notes-error" className="text-xs text-spa-berry">
              {fieldErrors.notes}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <SecondaryButton onClick={funnel.back} className="w-full sm:w-auto">Back</SecondaryButton>
        <PrimaryButton type="submit" busy={busy} className="w-full sm:w-auto">
          {busy ? 'Preparing payment…' : 'Review & pay'}
        </PrimaryButton>
      </div>
    </form>
  );
});
