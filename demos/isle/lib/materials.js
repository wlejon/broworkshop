// materials.js — map biome/climate to clipmap material properties.

// Preset material palettes matching regional climate identities
export const PALETTES = {
    temperate: {
        rock:  { albedo: [0.246, 0.232, 0.221], roughness: 0.88 },
        snow:  { albedo: [0.760, 0.790, 0.830], roughness: 0.62 },
        sand:  { albedo: [0.480, 0.430, 0.330], roughness: 0.94 },
        grass: { albedo: [0.180, 0.235, 0.128], roughness: 0.97 },
        // L0 forest canopy tint (linear albedo) + recolour strength.
        forest: { albedo: [0.098, 0.190, 0.088], strength: 0.85 }
    },
    tropical: {
        rock:  { albedo: [0.290, 0.240, 0.200], roughness: 0.85 },
        snow:  { albedo: [0.780, 0.810, 0.850], roughness: 0.65 },
        sand:  { albedo: [0.620, 0.570, 0.470], roughness: 0.92 },
        grass: { albedo: [0.100, 0.290, 0.080], roughness: 0.96 },
        forest: { albedo: [0.066, 0.170, 0.066], strength: 0.9 }
    },
    arctic: {
        rock:  { albedo: [0.180, 0.180, 0.190], roughness: 0.90 },
        snow:  { albedo: [0.820, 0.850, 0.900], roughness: 0.58 },
        sand:  { albedo: [0.380, 0.350, 0.300], roughness: 0.95 },
        grass: { albedo: [0.240, 0.250, 0.210], roughness: 0.98 },
        forest: { albedo: [0.098, 0.160, 0.108], strength: 0.8 }
    },
    desert: {
        rock:  { albedo: [0.420, 0.320, 0.240], roughness: 0.82 },
        snow:  { albedo: [0.750, 0.780, 0.820], roughness: 0.63 },
        sand:  { albedo: [0.580, 0.480, 0.360], roughness: 0.90 },
        grass: { albedo: [0.320, 0.300, 0.180], roughness: 0.99 },
        forest: { albedo: [0.150, 0.190, 0.110], strength: 0.5 }
    }
};

// Configure clipmap material properties based on regional climate scalars
export function configureMaterials(clipmap, regionalTemp, regionalPrecip, maxElevation) {
    let palette = PALETTES.temperate;

    // Arctic only for genuinely frigid islands. A cold-but-wet island (e.g. 4-5C,
    // high precip) is temperate rainforest — lush green in summer, not tundra grey.
    if (regionalTemp < 1.5) {
        palette = PALETTES.arctic;
    } else if (regionalTemp > 20) {
        if (regionalPrecip < 300) {
            palette = PALETTES.desert;
        } else {
            palette = PALETTES.tropical;
        }
    } else if (regionalPrecip < 250) {
        palette = PALETTES.desert;
    }

    clipmap.setMaterials(palette);
    if (palette.forest && clipmap.setForest) clipmap.setForest(palette.forest);

    // Tune detail knobs per climate
    let detail = { wavelength: 48, relief: 0.35, gain: 1.0, octaves: 7 };
    if (palette === PALETTES.arctic || palette === PALETTES.desert) {
        detail.relief = 0.48; // rugged
        detail.wavelength = 32;
    } else {
        detail.relief = 0.28; // softer
    }
    clipmap.setDetail(detail);

    // Dynamic snow line based on regional temperature:
    // Cold climate -> lower snow line. Warm climate -> higher snow line.
    // Base snow line at 72% of max height, adjusted by temp.
    let baseSnowLine = maxElevation * 0.72;
    let tempFactor = (regionalTemp - 10) * 100; // Shift by 100 meters per degree C off 10C
    let snowLine = Math.max(300, baseSnowLine + tempFactor);
    clipmap.setSnowLine(snowLine);

    return { palette, snowLine };
}
