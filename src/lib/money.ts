// The database stores money in minor units (kobo for NGN), matching payment providers.

export function toMajorUnits(minor: number): number {
  return minor / 100;
}

export function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}

/** 4500000 kobo -> "₦45,000" */
export function formatMoney(minor: number, currency = 'NGN'): string {
  const major = toMajorUnits(minor);
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}
