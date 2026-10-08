import { Home, MapPin } from 'lucide-react';
import { forwardRef } from 'react';
import { MIN_ADDRESS_LENGTH, serviceReady } from '../../funnel';
import type { BookingCatalog } from '../../useBookingCatalog';
import type { BookingFunnel } from '../../useBookingFunnel';
import { ChoiceCard, FieldLabel, inputClass, PrimaryButton, StepHeading } from '../ui';

export const ServiceStep = forwardRef<HTMLHeadingElement, { funnel: BookingFunnel; catalog: BookingCatalog }>(function ServiceStep({ funnel, catalog }, headingRef) {
  const { state } = funnel;
  const ready = serviceReady(state);
  const needsAddress = state.location === 'mobile' && state.dispatchZoneId && state.serviceAddress.trim().length < MIN_ADDRESS_LENGTH;

  return (
    <div className="space-y-8">
      <StepHeading ref={headingRef} hint="Choose your treatment and where you would like it.">
        Treatment &amp; venue
      </StepHeading>

      <fieldset className="space-y-3">
        <legend className="mb-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal">Treatment</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {catalog.services.map((s) => (
            <ChoiceCard
              key={s.dbId}
              name="booking-treatment"
              value={s.dbId!}
              checked={state.serviceId === s.dbId}
              onChange={funnel.selectService}
              title={s.name}
              detail={`${s.duration} mins · ${s.category}`}
              aside={s.formattedPrice}
            />
          ))}
        </div>
        {catalog.packages.length > 0 && (
          <>
            <p className="pt-3 text-xs font-bold uppercase tracking-widest text-spa-clay-text">Packages</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {catalog.packages.map((p) => (
                <ChoiceCard
                  key={p.dbId}
                  name="booking-treatment"
                  value={p.dbId!}
                  checked={state.serviceId === p.dbId}
                  onChange={funnel.selectService}
                  title={p.name}
                  detail={`${p.duration} mins · package`}
                  aside={p.formattedPrice}
                />
              ))}
            </div>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-xs font-bold uppercase tracking-widest text-spa-charcoal">Venue</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ChoiceCard
            name="booking-venue"
            value="sanctuary"
            checked={state.location === 'sanctuary'}
            onChange={() => funnel.setLocation('sanctuary')}
            title={<span className="inline-flex items-center gap-2"><Home className="h-4 w-4 text-spa-gold-dark" aria-hidden="true" />Boutique Sanctuary</span>}
            detail="Our gated facility in Mende, Maryland"
          />
          <ChoiceCard
            name="booking-venue"
            value="mobile"
            checked={state.location === 'mobile'}
            onChange={() => funnel.setLocation('mobile')}
            title={<span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-spa-gold-dark" aria-hidden="true" />Mobile in-home spa</span>}
            detail="At your home, hotel or office in Lagos"
          />
        </div>
      </fieldset>

      {state.location === 'mobile' && (
        <div className="grid grid-cols-1 gap-4 border-t border-spa-taupe pt-6 sm:grid-cols-2">
          <div className="space-y-2">
            <FieldLabel htmlFor="booking-zone">Your area</FieldLabel>
            <select id="booking-zone" className={inputClass} value={state.dispatchZoneId ?? ''} onChange={(e) => funnel.selectZone(e.target.value || null)}>
              <option value="">Choose your area…</option>
              {catalog.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} ({z.feeMinor === 0 ? 'no travel fee' : `+${z.formattedFee}`})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <FieldLabel htmlFor="booking-address">Street address</FieldLabel>
            <input
              id="booking-address"
              type="text"
              autoComplete="street-address"
              className={inputClass}
              placeholder="e.g. Flat 4, Block C, Lekki Gardens"
              value={state.serviceAddress}
              onChange={(e) => funnel.setAddress(e.target.value)}
              aria-describedby={needsAddress ? 'booking-address-hint' : undefined}
            />
            {needsAddress && (
              <p id="booking-address-hint" className="text-xs text-spa-berry">
                Please enter the full address.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-spa-clay-text">{ready ? '' : state.serviceId ? 'Choose your area and enter your address to continue.' : 'Choose a treatment to continue.'}</p>
        <PrimaryButton onClick={() => funnel.goTo('therapist')} disabled={!ready} className="w-full sm:w-auto">
          Next: therapist
        </PrimaryButton>
      </div>
    </div>
  );
});
