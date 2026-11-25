import type { RecipeDef } from "./types";

/**
 * Phase 1 recipes. Every end product needs at least one input from a riskier
 * zone than the Arcologies (design doc section 7).
 */
export const RECIPES: readonly RecipeDef[] = [
  // Refining: raw -> refined. Output qty is at 100% yield; baseYield (and later skills) scales it down.
  { id: "refine_alloy_plate", facility: "refinery", inputs: [{ itemId: "scrap_metal", qty: 10 }], outputs: [{ itemId: "alloy_plate", qty: 4 }], seconds: 60, baseYield: 0.8 },
  { id: "refine_plastic_sheet", facility: "refinery", inputs: [{ itemId: "polymer_waste", qty: 10 }], outputs: [{ itemId: "plastic_sheet", qty: 4 }], seconds: 60, baseYield: 0.8 },
  { id: "refine_silicon_wafer", facility: "refinery", inputs: [{ itemId: "silicon_dust", qty: 10 }], outputs: [{ itemId: "silicon_wafer", qty: 3 }], seconds: 60, baseYield: 0.8 },
  { id: "refine_conductor", facility: "refinery", inputs: [{ itemId: "copper_wire", qty: 10 }], outputs: [{ itemId: "conductor", qty: 3 }], seconds: 90, baseYield: 0.8 },
  { id: "refine_magnet", facility: "refinery", inputs: [{ itemId: "rare_earth_sludge", qty: 10 }], outputs: [{ itemId: "magnet", qty: 3 }], seconds: 90, baseYield: 0.8 },
  { id: "refine_synth_muscle_base", facility: "refinery", inputs: [{ itemId: "bio_gel", qty: 10 }], outputs: [{ itemId: "synth_muscle_base", qty: 3 }], seconds: 90, baseYield: 0.8 },
  { id: "refine_power_core", facility: "refinery", inputs: [{ itemId: "dead_fusion_cell", qty: 10 }], outputs: [{ itemId: "power_core", qty: 3 }], seconds: 120, baseYield: 0.75 },
  { id: "refine_chip", facility: "refinery", inputs: [{ itemId: "neodymium_ore", qty: 5 }, { itemId: "silicon_wafer", qty: 5 }], outputs: [{ itemId: "chip", qty: 2 }], seconds: 120, baseYield: 0.75 },
  { id: "refine_neural_mesh", facility: "refinery", inputs: [{ itemId: "neural_lattice", qty: 10 }], outputs: [{ itemId: "neural_mesh", qty: 3 }], seconds: 120, baseYield: 0.75 },

  // Components (fabricator)
  { id: "fab_alloy_frame", facility: "fabricator", inputs: [{ itemId: "alloy_plate", qty: 4 }], outputs: [{ itemId: "alloy_frame", qty: 1 }], seconds: 60 },
  { id: "fab_synth_muscle", facility: "fabricator", inputs: [{ itemId: "synth_muscle_base", qty: 2 }, { itemId: "plastic_sheet", qty: 1 }], outputs: [{ itemId: "synth_muscle", qty: 1 }], seconds: 90 },
  { id: "fab_targeting_chip", facility: "fabricator", inputs: [{ itemId: "chip", qty: 1 }, { itemId: "conductor", qty: 2 }], outputs: [{ itemId: "targeting_chip", qty: 1 }], seconds: 120 },
  { id: "fab_mag_lift_coil", facility: "fabricator", inputs: [{ itemId: "magnet", qty: 3 }, { itemId: "conductor", qty: 2 }], outputs: [{ itemId: "mag_lift_coil", qty: 1 }], seconds: 120 },
  { id: "fab_bio_gel_pack", facility: "fabricator", inputs: [{ itemId: "bio_gel", qty: 3 }, { itemId: "plastic_sheet", qty: 1 }], outputs: [{ itemId: "bio_gel_pack", qty: 1 }], seconds: 60 },
  { id: "fab_fuel_cell", facility: "fabricator", inputs: [{ itemId: "power_core", qty: 1 }, { itemId: "plastic_sheet", qty: 2 }], outputs: [{ itemId: "fuel_cell", qty: 8 }], seconds: 60 },

  // End products (assembly)
  { id: "asm_standard_body", facility: "assembly", inputs: [{ itemId: "synth_muscle", qty: 8 }, { itemId: "alloy_frame", qty: 4 }, { itemId: "bio_gel_pack", qty: 2 }], outputs: [{ itemId: "standard_body", qty: 1 }], seconds: 300 },
  { id: "asm_combat_chassis", facility: "assembly", inputs: [{ itemId: "synth_muscle", qty: 20 }, { itemId: "alloy_frame", qty: 10 }, { itemId: "neural_mesh", qty: 2 }], outputs: [{ itemId: "combat_chassis", qty: 1 }], seconds: 600 },
  { id: "asm_smart_pistol", facility: "assembly", inputs: [{ itemId: "alloy_plate", qty: 3 }, { itemId: "targeting_chip", qty: 1 }, { itemId: "conductor", qty: 1 }], outputs: [{ itemId: "smart_pistol", qty: 1 }], seconds: 180 },
  { id: "asm_hover_bike", facility: "assembly", inputs: [{ itemId: "alloy_frame", qty: 6 }, { itemId: "power_core", qty: 2 }, { itemId: "mag_lift_coil", qty: 4 }], outputs: [{ itemId: "hover_bike", qty: 1 }], seconds: 600 },
  { id: "asm_reflex_booster", facility: "assembly", inputs: [{ itemId: "neural_mesh", qty: 4 }, { itemId: "chip", qty: 2 }, { itemId: "bio_gel_pack", qty: 2 }], outputs: [{ itemId: "reflex_booster", qty: 1 }], seconds: 420 },
  { id: "asm_repair_kit", facility: "assembly", inputs: [{ itemId: "alloy_plate", qty: 2 }, { itemId: "plastic_sheet", qty: 2 }, { itemId: "conductor", qty: 1 }], outputs: [{ itemId: "repair_kit", qty: 1 }], seconds: 60 },
] as const;

export const RECIPES_BY_ID: ReadonlyMap<string, RecipeDef> = new Map(RECIPES.map((r) => [r.id, r]));
