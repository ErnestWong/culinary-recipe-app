// Unit definitions and conversions for recipe scaling.
//
// Every unit belongs to a dimension: mass, volume, or count. Within a
// dimension, conversion is a pure ratio to a canonical base (g, ml, each).
// Crossing between mass and volume requires an ingredient density
// (grams per millilitre).

export type Dimension = "mass" | "volume" | "count";

interface UnitDef {
  dimension: Dimension;
  // multiply a quantity in this unit by `toBase` to get the canonical base unit
  // (g for mass, ml for volume, each for count).
  toBase: number;
  aliases: string[];
}

const UNITS: Record<string, UnitDef> = {
  // mass — base: gram
  g: { dimension: "mass", toBase: 1, aliases: ["gram", "grams", "gr"] },
  kg: { dimension: "mass", toBase: 1000, aliases: ["kilogram", "kilograms", "kilo", "kilos"] },
  mg: { dimension: "mass", toBase: 0.001, aliases: ["milligram", "milligrams"] },
  oz: { dimension: "mass", toBase: 28.349523125, aliases: ["ounce", "ounces"] },
  lb: { dimension: "mass", toBase: 453.59237, aliases: ["lbs", "pound", "pounds"] },

  // volume — base: millilitre
  ml: { dimension: "volume", toBase: 1, aliases: ["milliliter", "millilitre", "milliliters", "millilitres", "cc"] },
  l: { dimension: "volume", toBase: 1000, aliases: ["liter", "litre", "liters", "litres"] },
  tsp: { dimension: "volume", toBase: 4.92892159375, aliases: ["teaspoon", "teaspoons", "t"] },
  tbsp: { dimension: "volume", toBase: 14.78676478125, aliases: ["tablespoon", "tablespoons", "tbl", "tbs", "T"] },
  cup: { dimension: "volume", toBase: 236.5882365, aliases: ["cups", "c"] },
  floz: { dimension: "volume", toBase: 29.5735295625, aliases: ["fl_oz", "fl oz", "fluid_ounce", "fluid ounces"] },
  pt: { dimension: "volume", toBase: 473.176473, aliases: ["pint", "pints"] },
  qt: { dimension: "volume", toBase: 946.352946, aliases: ["quart", "quarts"] },
  gal: { dimension: "volume", toBase: 3785.411784, aliases: ["gallon", "gallons"] },

  // count — base: each. Common cooking count-words map here so they scale
  // linearly (e.g. "2 cloves" -> "4 cloves" at 2x).
  each: {
    dimension: "count",
    toBase: 1,
    aliases: [
      "ea", "unit", "units", "piece", "pieces", "pc", "whole",
      "servings", "serving", "portion", "portions", "cover", "covers",
      "clove", "cloves", "pinch", "pinches", "dash", "dashes", "drop", "drops",
      "bunch", "bunches", "sprig", "sprigs", "stalk", "stalks", "stick", "sticks",
      "leaf", "leaves", "slice", "slices", "head", "heads", "can", "cans",
      "handful", "handfuls", "knob", "knobs", "fillet", "fillets", "rasher", "rashers",
      "to taste", "as needed",
    ],
  },
  dozen: { dimension: "count", toBase: 12, aliases: ["dz", "dozens"] },
};

// Build a lookup from any alias (or canonical key) to the canonical key.
const ALIAS_TO_KEY: Record<string, string> = {};
for (const [key, def] of Object.entries(UNITS)) {
  ALIAS_TO_KEY[key.toLowerCase()] = key;
  for (const alias of def.aliases) ALIAS_TO_KEY[alias.toLowerCase()] = key;
}

export function normalizeUnit(unit: string): string {
  const key = ALIAS_TO_KEY[unit.trim().toLowerCase()];
  if (!key) throw new Error(`Unknown unit: "${unit}"`);
  return key;
}

export function dimensionOf(unit: string): Dimension {
  return UNITS[normalizeUnit(unit)].dimension;
}

/**
 * Convert `quantity` from one unit to another.
 *
 * Same-dimension conversions are pure ratios. Mass <-> volume conversions
 * require `densityGPerMl` (grams per millilitre). Count units never cross
 * into mass/volume.
 */
export function convert(
  quantity: number,
  fromUnit: string,
  toUnit: string,
  densityGPerMl?: number | null
): number {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (from === to) return quantity;

  const fromDef = UNITS[from];
  const toDef = UNITS[to];

  // canonical base value (g, ml, or each)
  const base = quantity * fromDef.toBase;

  if (fromDef.dimension === toDef.dimension) {
    return base / toDef.toBase;
  }

  // cross-dimension: only mass <-> volume, via density
  const crossing =
    (fromDef.dimension === "mass" && toDef.dimension === "volume") ||
    (fromDef.dimension === "volume" && toDef.dimension === "mass");

  if (!crossing) {
    throw new Error(
      `Cannot convert ${fromDef.dimension} (${fromUnit}) to ${toDef.dimension} (${toUnit})`
    );
  }
  if (!densityGPerMl || densityGPerMl <= 0) {
    throw new Error(
      `Converting between mass and volume (${fromUnit} -> ${toUnit}) requires a density`
    );
  }

  // base is in g (mass) or ml (volume); use density to swap, then scale to target.
  if (fromDef.dimension === "mass") {
    const ml = base / densityGPerMl; // g -> ml
    return ml / toDef.toBase;
  } else {
    const g = base * densityGPerMl; // ml -> g
    return g / toDef.toBase;
  }
}

export function isKnownUnit(unit: string): boolean {
  return !!ALIAS_TO_KEY[unit.trim().toLowerCase()];
}
