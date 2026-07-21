// biome.js — classify and name the Whittaker biomes.

export const BIOMES = [
    { id: 0, name: 'deep ocean',        rgb: [ 14,  34,  74] },
    { id: 1, name: 'shelf / sea',       rgb: [ 30,  92, 150] },
    { id: 2, name: 'ice / tundra',      rgb: [220, 232, 240] },
    { id: 3, name: 'alpine',            rgb: [170, 165, 185] },
    { id: 4, name: 'boreal / taiga',    rgb: [ 52,  96,  84] },
    { id: 5, name: 'cold desert',       rgb: [176, 168, 132] },
    { id: 6, name: 'grassland',         rgb: [166, 186,  96] },
    { id: 7, name: 'temperate forest',  rgb: [ 66, 128,  62] },
    { id: 8, name: 'subtropical desert',rgb: [220, 190, 120] },
    { id: 9, name: 'savanna',           rgb: [190, 176,  86] },
    { id: 10, name: 'seasonal tropical',rgb: [110, 160,  54] },
    { id: 11, name: 'rainforest',        rgb: [ 24, 104,  48] },
];

export function classify(E, T, P) {
    if (E < -1000) return 0;
    if (E < 0)     return 1;
    if (T < -5)    return 2;                       // ice / tundra
    if (E > 2200 && T < 4) return 3;               // alpine
    if (T < 5)     return 4;                       // boreal
    if (P < 250)   return T > 18 ? 8 : 5;          // desert (subtropical / cold)
    if (P < 600)   return T > 20 ? 9 : 6;          // savanna / grassland
    if (P < 1200)  return T > 22 ? 10 : 7;         // seasonal tropical / temperate forest
    return T > 22 ? 11 : 7;                        // rainforest / temperate forest
}
