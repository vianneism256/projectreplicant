import { DISTRICTS_BY_ID, ITEMS_BY_ID } from "@replicant/shared";

export const cr = (n: number) => `${n.toLocaleString()} cr`;
export const itemName = (id: string) => ITEMS_BY_ID.get(id)?.name ?? id;
export const districtName = (id: string) => DISTRICTS_BY_ID.get(id)?.name ?? id;

export function secs(s: number): string {
  if (s <= 0) return "ready";
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
