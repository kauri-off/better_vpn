// Quota entry helpers: the form takes value + unit, the API takes bytes.

export const QUOTA_UNITS = ["MB", "GB", "TB"] as const;
export type QuotaUnit = (typeof QUOTA_UNITS)[number];

const MULT: Record<QuotaUnit, bigint> = {
  MB: 1024n * 1024n,
  GB: 1024n * 1024n * 1024n,
  TB: 1024n * 1024n * 1024n * 1024n,
};

export function quotaToBytes(value: string, unit: QuotaUnit): bigint {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0n;
  // Scale via a fixed factor so fractional entries like 1.5 GB stay exact
  // enough (bigint has no fractions).
  return (BigInt(Math.round(n * 1024)) * MULT[unit]) / 1024n;
}

// Best-fit display split for prefilling the edit form.
export function bytesToQuota(bytes: bigint): { value: string; unit: QuotaUnit } {
  if (bytes <= 0n) return { value: "", unit: "GB" };
  for (const unit of [...QUOTA_UNITS].reverse()) {
    const m = MULT[unit];
    if (bytes >= m) {
      const v = Number((bytes * 100n) / m) / 100;
      return { value: String(v), unit };
    }
  }
  return { value: String(Number(bytes)), unit: "MB" };
}
