/**
 * Economy constants (design doc sections 5, 10, 15). All starting values, tune in playtests.
 * Credits are whole integers; fees always round up so the sink is never zero.
 */
export const ECONOMY = {
  /** Charged when an order is placed, on order value. Credit sink. */
  brokerFeeRate: 0.01,
  /** Charged to the seller on each sale in NPC-run districts. Credit sink. */
  salesTaxRate: 0.02,
  /** One-time credits for a new character. Credit faucet. */
  starterGrant: 5_000,
  /** Order lifetime limits, in days. */
  minOrderDays: 1,
  maxOrderDays: 90,
} as const;

export function feeOf(value: number, rate: number): number {
  if (value <= 0) return 0;
  return Math.ceil(value * rate);
}
