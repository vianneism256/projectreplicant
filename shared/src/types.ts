/** Resource and item tiers (design doc section 6 and 8). */
export type Tier = 1 | 2 | 3 | 4;

export type ItemCategory =
  | "raw"
  | "refined"
  | "component"
  | "body"
  | "weapon"
  | "cyberware"
  | "vehicle"
  | "consumable";

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  tier: Tier;
  /** Cargo volume per unit, in units (design doc section 9). */
  volume: number;
  /** Reference value in credits, used for insurance and NPC prices. Not a market price. */
  baseValue: number;
  /** Contraband can only be sold on black markets (design doc section 10). */
  contraband: boolean;
}

export type FacilityType = "refinery" | "fabricator" | "assembly";

export interface RecipeIO {
  itemId: string;
  qty: number;
}

export interface RecipeDef {
  id: string;
  facility: FacilityType;
  inputs: RecipeIO[];
  outputs: RecipeIO[];
  /** Job time in seconds at an NPC facility. */
  seconds: number;
  /**
   * For refining only: base fraction of output delivered (0.7–0.9 by skill/facility).
   * The lost fraction is an item sink.
   */
  baseYield?: number;
}

export type Zone = "arcology" | "sprawl" | "wildlands";

export interface SalvageEntry {
  itemId: string;
  /** Relative weight for random draws. */
  weight: number;
  /** Units gained per successful salvage action. */
  min: number;
  max: number;
}

export interface DistrictDef {
  id: string;
  name: string;
  zone: Zone;
  /** What the "Salvage" action can produce here (item faucet). */
  salvage: SalvageEntry[];
  /** Has NPC broker market (Arcologies only). */
  npcMarket: boolean;
  /** Has black market (Sprawl only). */
  blackMarket: boolean;
}

export interface RouteDef {
  from: string;
  to: string;
  /** Haul time in seconds with a courier van. */
  seconds: number;
}

/** Every credit or item movement that creates or destroys value (design doc sections 4, 5, 15). */
export type LedgerKind = "faucet" | "sink" | "transfer";
