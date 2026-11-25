import type { DistrictDef, RouteDef } from "./types";

/** Phase 1 prototype: one district per zone. */
export const DISTRICTS: readonly DistrictDef[] = [
  {
    id: "arc-helix",
    name: "Helix Arcology",
    zone: "arcology",
    npcMarket: true,
    blackMarket: false,
    salvage: [
      { itemId: "scrap_metal", weight: 50, min: 2, max: 5 },
      { itemId: "polymer_waste", weight: 35, min: 2, max: 5 },
      { itemId: "silicon_dust", weight: 15, min: 1, max: 3 },
    ],
  },
  {
    id: "spr-rustline",
    name: "Rustline",
    zone: "sprawl",
    npcMarket: false,
    blackMarket: true,
    salvage: [
      { itemId: "scrap_metal", weight: 25, min: 3, max: 6 },
      { itemId: "silicon_dust", weight: 20, min: 2, max: 4 },
      { itemId: "copper_wire", weight: 25, min: 1, max: 4 },
      { itemId: "rare_earth_sludge", weight: 15, min: 1, max: 3 },
      { itemId: "bio_gel", weight: 15, min: 1, max: 3 },
    ],
  },
  {
    id: "wld-ashfields",
    name: "Ashfields",
    zone: "wildlands",
    npcMarket: false,
    blackMarket: false,
    salvage: [
      { itemId: "copper_wire", weight: 15, min: 2, max: 5 },
      { itemId: "bio_gel", weight: 15, min: 2, max: 4 },
      { itemId: "neodymium_ore", weight: 25, min: 1, max: 3 },
      { itemId: "dead_fusion_cell", weight: 20, min: 1, max: 2 },
      { itemId: "neural_lattice", weight: 25, min: 1, max: 3 },
    ],
  },
] as const;

export const DISTRICTS_BY_ID: ReadonlyMap<string, DistrictDef> = new Map(DISTRICTS.map((d) => [d.id, d]));

/** Haul routes (both directions). Arcology <-> Wildlands has no direct route: you must pass the Sprawl. */
export const ROUTES: readonly RouteDef[] = [
  { from: "arc-helix", to: "spr-rustline", seconds: 120 },
  { from: "spr-rustline", to: "wld-ashfields", seconds: 180 },
] as const;

export function routeSeconds(from: string, to: string): number | undefined {
  const r = ROUTES.find((x) => (x.from === from && x.to === to) || (x.from === to && x.to === from));
  return r?.seconds;
}
