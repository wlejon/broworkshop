// A temperate wood's plants as treeSpecies options (./index.js): the
// trees and the shrub of the biomes demo, shared by any world that grows
// them (the planet's forests are these).
//
//   import { TEMPERATE } from "/lib/trees/temperate.js";
//   species: TEMPERATE.map(treeSpecies)   // indices as below

export const BROADLEAF = 0, BIRCH = 1, CONIFER = 2, SHRUB = 3, OAK = 4, LIME = 5;

export const TEMPERATE = [
    // 0 a broadleaf: a big round crown of deep green lobes.
    { height: 15, base: 0.2, radius: 5.2, shape: 0.05, lobes: 16, lobeSize: 0.52, leafLength: 0.34, leafWidth: 0.55,
      elements: 8000, trunk: 0.32, spread: 0.85, droop: 0.15,
      light: [0.19, 0.32, 0.07], dark: [0.02, 0.05, 0.025], hueVariety: 0.4, glow: 0.9, glowColor: [1.0, 0.9, 0.35],
      bark: [0.12, 0.10, 0.08], density: 0.9 },
    // 1 a birch-like tree: tall, light, airy, pale bark.
    { height: 14, base: 0.4, radius: 3.0, shape: 0.15, lobes: 11, lobeSize: 0.5, leafLength: 0.24, leafWidth: 0.6,
      elements: 4800, trunk: 0.16, spread: 0.7, droop: 0.45,
      light: [0.30, 0.42, 0.09], dark: [0.05, 0.09, 0.03], hueVariety: 0.3, glow: 1.1, glowColor: [1.0, 0.95, 0.45],
      bark: [0.55, 0.52, 0.47], density: 0.6 },
    // 2 a conifer: a dark cone of drooping needle tiers.
    { height: 18, base: 0.1, radius: 4.4, shape: 0.95, lobes: 34, lobeSize: 0.36, leafLength: 0.32, leafWidth: 0.42,
      elements: 6500, trunk: 0.28, spread: 0.95, droop: 0.5, needle: 1,
      light: [0.10, 0.20, 0.08], dark: [0.015, 0.04, 0.025], hueVariety: 0.18, glow: 0.35, glowColor: [0.8, 0.9, 0.4],
      bark: [0.16, 0.10, 0.07], density: 0.8 },
    // 3 a shrub.
    { height: 1.8, base: 0.05, radius: 1.3, shape: 0.0, lobes: 7, lobeSize: 0.55, leafLength: 0.18, leafWidth: 0.55,
      elements: 1600, trunk: 0.04, spread: 0.6, droop: 0.1,
      light: [0.17, 0.30, 0.10], dark: [0.03, 0.07, 0.03], hueVariety: 0.35, glow: 0.8, glowColor: [0.9, 0.95, 0.4],
      bark: [0.12, 0.09, 0.07], density: 0.7 },
    // 4 an oak-like tree: broad and low, its crown a few big dark lobes,
    // bluer than the broadleaf.
    { height: 13, base: 0.22, radius: 6.2, shape: 0.0, lobes: 12, lobeSize: 0.6, leafLength: 0.3, leafWidth: 0.6,
      elements: 8000, trunk: 0.42, spread: 1.0, droop: 0.1,
      light: [0.13, 0.25, 0.08], dark: [0.015, 0.04, 0.025], hueVariety: 0.3, glow: 0.7, glowColor: [0.9, 0.95, 0.4],
      bark: [0.10, 0.09, 0.08], density: 1.0 },
    // 5 a lime-like tree: tall and rounded, a fresh yellow green.
    { height: 17, base: 0.25, radius: 4.6, shape: 0.1, lobes: 15, lobeSize: 0.5, leafLength: 0.32, leafWidth: 0.7,
      elements: 7000, trunk: 0.3, spread: 0.8, droop: 0.25,
      light: [0.30, 0.40, 0.07], dark: [0.04, 0.08, 0.02], hueVariety: 0.3, glow: 1.0, glowColor: [1.0, 0.95, 0.4],
      bark: [0.14, 0.12, 0.10], density: 0.8 },
];
