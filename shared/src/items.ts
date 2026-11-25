import type { ItemDef } from "./types";

/**
 * Phase 1 starter catalog: 30 items.
 * 9 raw, 9 refined, 6 components, 6 end products.
 * baseValue is a reference number for tuning, not a market price.
 */
export const ITEMS: readonly ItemDef[] = [
  // Raw resources (item faucets: salvage and mining)
  { id: "scrap_metal", name: "Scrap metal", category: "raw", tier: 1, volume: 1, baseValue: 4, contraband: false },
  { id: "polymer_waste", name: "Polymer waste", category: "raw", tier: 1, volume: 1, baseValue: 3, contraband: false },
  { id: "silicon_dust", name: "Silicon dust", category: "raw", tier: 1, volume: 1, baseValue: 5, contraband: false },
  { id: "copper_wire", name: "Copper wire", category: "raw", tier: 2, volume: 1, baseValue: 12, contraband: false },
  { id: "rare_earth_sludge", name: "Rare-earth sludge", category: "raw", tier: 2, volume: 2, baseValue: 15, contraband: false },
  { id: "bio_gel", name: "Bio-gel", category: "raw", tier: 2, volume: 1, baseValue: 14, contraband: false },
  { id: "neodymium_ore", name: "Neodymium ore", category: "raw", tier: 3, volume: 2, baseValue: 40, contraband: false },
  { id: "dead_fusion_cell", name: "Dead fusion cell", category: "raw", tier: 3, volume: 3, baseValue: 55, contraband: false },
  { id: "neural_lattice", name: "Neural lattice", category: "raw", tier: 3, volume: 1, baseValue: 60, contraband: false },

  // Refined materials (refinery)
  { id: "alloy_plate", name: "Alloy plate", category: "refined", tier: 1, volume: 1, baseValue: 15, contraband: false },
  { id: "plastic_sheet", name: "Plastic sheet", category: "refined", tier: 1, volume: 1, baseValue: 10, contraband: false },
  { id: "silicon_wafer", name: "Silicon wafer", category: "refined", tier: 1, volume: 0.5, baseValue: 18, contraband: false },
  { id: "conductor", name: "Conductor", category: "refined", tier: 2, volume: 0.5, baseValue: 40, contraband: false },
  { id: "magnet", name: "Magnet", category: "refined", tier: 2, volume: 1, baseValue: 50, contraband: false },
  { id: "synth_muscle_base", name: "Synth-muscle base", category: "refined", tier: 2, volume: 1, baseValue: 45, contraband: false },
  { id: "power_core", name: "Power core", category: "refined", tier: 3, volume: 2, baseValue: 180, contraband: false },
  { id: "chip", name: "Chip", category: "refined", tier: 3, volume: 0.1, baseValue: 150, contraband: false },
  { id: "neural_mesh", name: "Neural mesh", category: "refined", tier: 3, volume: 0.5, baseValue: 200, contraband: false },

  // Components (fabricator)
  { id: "alloy_frame", name: "Alloy frame", category: "component", tier: 1, volume: 4, baseValue: 70, contraband: false },
  { id: "synth_muscle", name: "Synth-muscle", category: "component", tier: 2, volume: 2, baseValue: 110, contraband: false },
  { id: "targeting_chip", name: "Targeting chip", category: "component", tier: 2, volume: 0.1, baseValue: 260, contraband: false },
  { id: "mag_lift_coil", name: "Mag-lift coil", category: "component", tier: 2, volume: 3, baseValue: 240, contraband: false },
  { id: "bio_gel_pack", name: "Bio-gel pack", category: "component", tier: 2, volume: 0.5, baseValue: 60, contraband: false },
  { id: "fuel_cell", name: "Fuel cell", category: "consumable", tier: 1, volume: 1, baseValue: 30, contraband: false },

  // End products (assembly)
  { id: "standard_body", name: "Standard body", category: "body", tier: 2, volume: 20, baseValue: 1500, contraband: false },
  { id: "combat_chassis", name: "Combat chassis", category: "body", tier: 3, volume: 25, baseValue: 6000, contraband: false },
  { id: "smart_pistol", name: "Smart pistol", category: "weapon", tier: 2, volume: 1, baseValue: 650, contraband: false },
  { id: "hover_bike", name: "Hover bike", category: "vehicle", tier: 2, volume: 60, baseValue: 2500, contraband: false },
  { id: "reflex_booster", name: "Reflex booster", category: "cyberware", tier: 3, volume: 0.2, baseValue: 3200, contraband: true },
  { id: "repair_kit", name: "Repair kit", category: "consumable", tier: 1, volume: 1, baseValue: 90, contraband: false },
] as const;

export const ITEMS_BY_ID: ReadonlyMap<string, ItemDef> = new Map(ITEMS.map((i) => [i.id, i]));

export function getItem(id: string): ItemDef {
  const item = ITEMS_BY_ID.get(id);
  if (!item) throw new Error(`Unknown item: ${id}`);
  return item;
}
