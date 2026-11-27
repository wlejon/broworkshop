// lib/foundry/materials.js — Real SI engineering materials and wear/fatigue laws.
// Every physical limit in the Foundry compiler traces back to material properties
// (yield, ultimate, shear, fatigue limit, density, thermal mass, Archard wear).

export const MATERIALS = {
    mildSteel: {
        id: 'mildSteel',
        label: 'Mild Steel (1018)',
        density: 7870,          // kg/m^3
        yieldPa: 370e6,         // Pa
        ultimatePa: 440e6,      // Pa
        shearPa: 250e6,         // Pa
        fatiguePa: 210e6,       // Pa (endurance limit)
        modulusPa: 205e9,       // Pa
        specificHeat: 486,      // J/(kg*K)
        thermalCond: 51.9,      // W/(m*K)
        maxTempC: 420,
        wearFactor: 1.0,
        costPerKg: 3.2,
        color: [0.56, 0.59, 0.63],
        metallic: 0.85,
        roughness: 0.42,
    },
    alloySteel: {
        id: 'alloySteel',
        label: '4140 Alloy Steel',
        density: 7850,
        yieldPa: 655e6,
        ultimatePa: 850e6,
        shearPa: 460e6,
        fatiguePa: 380e6,
        modulusPa: 210e9,
        specificHeat: 473,
        thermalCond: 42.6,
        maxTempC: 480,
        wearFactor: 0.45,
        costPerKg: 8.5,
        color: [0.44, 0.48, 0.54],
        metallic: 0.90,
        roughness: 0.34,
    },
    toolSteel: {
        id: 'toolSteel',
        label: 'Hardened Tool Steel (S7)',
        density: 7830,
        yieldPa: 1380e6,
        ultimatePa: 1750e6,
        shearPa: 920e6,
        fatiguePa: 680e6,
        modulusPa: 210e9,
        specificHeat: 460,
        thermalCond: 34.0,
        maxTempC: 520,
        wearFactor: 0.18,
        costPerKg: 24.0,
        color: [0.34, 0.37, 0.42],
        metallic: 0.94,
        roughness: 0.26,
    },
    hardox: {
        id: 'hardox',
        label: 'AR500 / Hardox Plate',
        density: 7850,
        yieldPa: 1250e6,
        ultimatePa: 1550e6,
        shearPa: 820e6,
        fatiguePa: 540e6,
        modulusPa: 210e9,
        specificHeat: 470,
        thermalCond: 38.0,
        maxTempC: 450,
        wearFactor: 0.20,
        costPerKg: 14.0,
        color: [0.27, 0.31, 0.36],
        metallic: 0.82,
        roughness: 0.46,
    },
    aluminum: {
        id: 'aluminum',
        label: '6061-T6 Aluminum',
        density: 2700,
        yieldPa: 276e6,
        ultimatePa: 310e6,
        shearPa: 207e6,
        fatiguePa: 96e6,
        modulusPa: 68.9e9,
        specificHeat: 896,
        thermalCond: 167,
        maxTempC: 220,
        wearFactor: 2.2,
        costPerKg: 7.5,
        color: [0.76, 0.79, 0.83],
        metallic: 0.88,
        roughness: 0.30,
    },
    titanium: {
        id: 'titanium',
        label: 'Ti-6Al-4V Titanium',
        density: 4430,
        yieldPa: 880e6,
        ultimatePa: 950e6,
        shearPa: 550e6,
        fatiguePa: 510e6,
        modulusPa: 114e9,
        specificHeat: 526,
        thermalCond: 6.7,
        maxTempC: 550,
        wearFactor: 0.55,
        costPerKg: 68.0,
        color: [0.62, 0.60, 0.57],
        metallic: 0.86,
        roughness: 0.36,
    },
    brass: {
        id: 'brass',
        label: 'C360 Brass (Shear / Bushing)',
        density: 8500,
        yieldPa: 140e6,
        ultimatePa: 240e6,
        shearPa: 145e6,
        fatiguePa: 85e6,
        modulusPa: 97e9,
        specificHeat: 380,
        thermalCond: 115,
        maxTempC: 280,
        wearFactor: 1.6,
        costPerKg: 12.0,
        color: [0.85, 0.69, 0.28],
        metallic: 0.90,
        roughness: 0.28,
    },
    bronze: {
        id: 'bronze',
        label: 'SAE 660 Bearing Bronze',
        density: 8800,
        yieldPa: 160e6,
        ultimatePa: 260e6,
        shearPa: 165e6,
        fatiguePa: 110e6,
        modulusPa: 105e9,
        specificHeat: 377,
        thermalCond: 59,
        maxTempC: 300,
        wearFactor: 0.85,
        costPerKg: 16.0,
        color: [0.74, 0.50, 0.24],
        metallic: 0.88,
        roughness: 0.34,
    },
    castIron: {
        id: 'castIron',
        label: 'Gray Cast Iron',
        density: 7200,
        yieldPa: 210e6,
        ultimatePa: 260e6,
        shearPa: 220e6,
        fatiguePa: 100e6,
        modulusPa: 110e9,
        specificHeat: 490,
        thermalCond: 46,
        maxTempC: 500,
        wearFactor: 0.70,
        costPerKg: 2.5,
        color: [0.24, 0.25, 0.27],
        metallic: 0.65,
        roughness: 0.68,
    },
};

export const MATERIAL_IDS = Object.keys(MATERIALS);

export function matOf(id) {
    return MATERIALS[id] || MATERIALS.mildSteel;
}

/**
 * Palmgren-Miner / L10-inspired wear rate per second.
 * - Below 0.55 of continuous rating: essentially zero wear (endurance regime).
 * - Between 0.55 and 1.0: slow nominal wear (~hours of service).
 * - Above 1.0 (out of spec!): accelerates steeply with ratio^3.2 so an
 *   undersized part visibly wears out over a single 30-90 s battle!
 *
 * @param {number} ratio   instantaneous load / continuous rating
 * @param {number} rateHz  cycle rate (e.g. rev/s, or 1 for static/thermal)
 * @param {number} baseWearPerCycle  nominal wear at ratio=1 (default 1/36000)
 */
export function wearRate(ratio, rateHz = 1, baseWearPerCycle = 1 / 18000) {
    if (!(ratio > 0.55) || !(rateHz > 0)) return 0;
    const eff = ratio <= 1.0
        ? Math.pow((ratio - 0.55) / 0.45, 2) * 0.25
        : 0.25 + Math.pow(ratio, 3.2) * 4.5;
    return eff * baseWearPerCycle * Math.max(0.5, rateHz);
}

/** Map a normalized stress/wear/heat intensity (0..1.5+) to an RGB 0..1 ramp. */
export function stressColor(ratio) {
    if (ratio <= 0.5) {
        const t = Math.max(0, ratio / 0.5);
        return [0.16 + 0.14 * t, 0.68 + 0.16 * t, 0.42 - 0.14 * t];
    }
    if (ratio <= 1.0) {
        const t = (ratio - 0.5) / 0.5;
        return [0.30 + 0.68 * t, 0.84 - 0.18 * t, 0.28 - 0.18 * t];
    }
    const t = Math.min(1, (ratio - 1.0) / 0.5);
    return [0.98, 0.66 - 0.56 * t, 0.10];
}
