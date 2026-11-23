// Single-source architectural building blueprint & differentiated per-floor
// interior layout generator shared across LOD0 (enterable + furnished),
// LOD1 (textured exterior detail), and LOD2 (compact matched skyline proxy).

function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function mix3(a, b, t) {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ];
}

function mul3(a, b) {
    return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

const ARCHETYPE_DEFAULTS = {
    skyscraper: { minW: 22, maxW: 38, minD: 20, maxD: 34, minFloors: 14, maxFloors: 44, floorH: 3.8, lobbyH: 5.4 },
    midrise:    { minW: 16, maxW: 28, minD: 14, maxD: 24, minFloors: 4,  maxFloors: 11, floorH: 3.4, lobbyH: 4.4 },
    shopfront:  { minW: 11, maxW: 18, minD: 12, maxD: 18, minFloors: 2,  maxFloors: 4,  floorH: 3.3, lobbyH: 4.2 },
    house:      { minW: 9,  maxW: 15, minD: 8,  maxD: 13, minFloors: 1,  maxFloors: 2,  floorH: 3.0, lobbyH: 3.2 },
    station:    { minW: 24, maxW: 36, minD: 12, maxD: 18, minFloors: 1,  maxFloors: 1,  floorH: 5.2, lobbyH: 5.2 },
};

const FACADE_PALETTES = {
    skyscraper: [
        { wall: 'limestone',  base: 'limestone',  trim: 'brushedMetal', roof: 'brushedMetal', tint: [0.92, 0.94, 0.98], roofTint: [0.68, 0.72, 0.76], windowStyle: 'curtain' },
        { wall: 'concrete',   base: 'limestone',  trim: 'brushedMetal', roof: 'concrete',     tint: [0.85, 0.88, 0.92], roofTint: [0.62, 0.64, 0.68], windowStyle: 'curtain' },
        { wall: 'brushedMetal', base: 'concrete', trim: 'brushedMetal', roof: 'brushedMetal', tint: [0.76, 0.82, 0.88], roofTint: [0.58, 0.62, 0.68], windowStyle: 'curtain' },
    ],
    midrise: [
        { wall: 'brickRed',  base: 'limestone', trim: 'limestone', roof: 'concrete', tint: [0.95, 0.88, 0.84], roofTint: [0.66, 0.64, 0.60], windowStyle: 'punched' },
        { wall: 'brickTan',  base: 'concrete',  trim: 'limestone', roof: 'concrete', tint: [0.96, 0.92, 0.84], roofTint: [0.70, 0.67, 0.62], windowStyle: 'punched' },
        { wall: 'limestone', base: 'concrete',  trim: 'concrete',  roof: 'concrete', tint: [0.94, 0.92, 0.88], roofTint: [0.68, 0.66, 0.63], windowStyle: 'punched' },
    ],
    shopfront: [
        { wall: 'brickRed', base: 'concrete',  trim: 'woodSiding', roof: 'roofShingle', tint: [0.96, 0.90, 0.86], roofTint: [0.46, 0.44, 0.44], windowStyle: 'punched', awning: [0.74, 0.22, 0.18] },
        { wall: 'brickTan', base: 'limestone', trim: 'woodSiding', roof: 'roofShingle', tint: [0.95, 0.92, 0.85], roofTint: [0.36, 0.44, 0.38], windowStyle: 'punched', awning: [0.18, 0.42, 0.32] },
        { wall: 'stucco',   base: 'concrete',  trim: 'woodSiding', roof: 'roofShingle', tint: [0.94, 0.90, 0.82], roofTint: [0.42, 0.36, 0.34], windowStyle: 'punched', awning: [0.22, 0.34, 0.56] },
    ],
    house: [
        { wall: 'woodSiding', base: 'riverStone', trim: 'stucco', roof: 'roofShingle', tint: [0.94, 0.92, 0.86], roofTint: [0.52, 0.50, 0.52], windowStyle: 'punched' },
        { wall: 'stucco',     base: 'riverStone', trim: 'woodSiding', roof: 'roofShingle', tint: [0.96, 0.88, 0.78], roofTint: [0.62, 0.44, 0.36], windowStyle: 'punched' },
        { wall: 'woodSiding', base: 'concrete',   trim: 'stucco', roof: 'roofShingle', tint: [0.74, 0.82, 0.86], roofTint: [0.40, 0.43, 0.48], windowStyle: 'punched' },
        { wall: 'brickRed',   base: 'concrete',   trim: 'stucco', roof: 'roofShingle', tint: [0.94, 0.90, 0.88], roofTint: [0.42, 0.40, 0.42], windowStyle: 'punched' },
    ],
    station: [
        { wall: 'limestone', base: 'concrete', trim: 'brushedMetal', roof: 'brushedMetal', tint: [0.92, 0.92, 0.90], roofTint: [0.62, 0.68, 0.74], windowStyle: 'curtain' },
    ],
};

export function generateBuildingBlueprint(opts = {}) {
    const id = opts.id ?? 1;
    const seed = opts.seed ?? (id * 2654435761) >>> 0;
    const rng = makeRng(seed);
    const archetype = opts.archetype && ARCHETYPE_DEFAULTS[opts.archetype] ? opts.archetype : 'midrise';
    const def = ARCHETYPE_DEFAULTS[archetype];
    const palList = FACADE_PALETTES[archetype];
    const pal = palList[Math.floor(rng() * palList.length)];

    const width = opts.width ?? (def.minW + rng() * (def.maxW - def.minW));
    const depth = opts.depth ?? (def.minD + rng() * (def.maxD - def.minD));
    const floors = opts.floors ?? (def.minFloors + Math.floor(rng() * (def.maxFloors - def.minFloors + 1)));
    const groundY = opts.groundY ?? 0;
    const slopeDrop = Math.max(0, opts.slopeDrop ?? 0);
    const x = opts.x ?? 0;
    const z = opts.z ?? 0;
    const yaw = opts.yaw ?? 0;

    const lobbyH = def.lobbyH;
    const floorH = def.floorH;
    const skirtDepth = Math.max(1.2, slopeDrop + 1.4);
    const podiumH = archetype === 'house' ? 0.45 : (archetype === 'station' ? 0.55 : 0.4);

    // Canonical tier stack shared across LOD2, LOD1, and LOD0.
    const tiers = [];
    if (archetype === 'skyscraper') {
        const podiumFloors = Math.min(2, Math.max(1, Math.floor(floors * 0.12)));
        const h0 = lobbyH + (podiumFloors - 1) * floorH;
        tiers.push({
            kind: 'podium', width, depth, bottomY: 0, topY: h0,
            floors: podiumFloors, floorH: h0 / podiumFloors,
            matRole: 'base', tint: mix3(pal.tint, [1, 1, 1], 0.15), windowStyle: 'curtain', windowFrac: 0.54,
        });
        const rem = Math.max(1, floors - podiumFloors);
        const hasSetback = rem >= 10;
        const midFloors = hasSetback ? Math.ceil(rem * 0.62) : rem;
        const w1 = width * 0.86, d1 = depth * 0.86;
        const h1 = midFloors * floorH;
        tiers.push({
            kind: 'shaft', width: w1, depth: d1, bottomY: h0, topY: h0 + h1,
            floors: midFloors, floorH,
            matRole: 'wall', tint: pal.tint, windowStyle: pal.windowStyle, windowFrac: 0.62,
        });
        if (hasSetback) {
            const topFloors = rem - midFloors;
            const w2 = w1 * 0.78, d2 = d1 * 0.78;
            const h2 = topFloors * floorH;
            tiers.push({
                kind: 'crownShaft', width: w2, depth: d2, bottomY: h0 + h1, topY: h0 + h1 + h2,
                floors: topFloors, floorH,
                matRole: 'wall', tint: mix3(pal.tint, [1, 1, 1], 0.12), windowStyle: pal.windowStyle, windowFrac: 0.64,
            });
        }
    } else if (archetype === 'midrise' || archetype === 'shopfront') {
        const h0 = lobbyH;
        tiers.push({
            kind: 'ground', width, depth, bottomY: 0, topY: h0,
            floors: 1, floorH: h0,
            matRole: 'base', tint: pal.tint, windowStyle: 'curtain', windowFrac: 0.52,
        });
        if (floors > 1) {
            const up = floors - 1;
            const hasStep = floors >= 7;
            const mainF = hasStep ? up - 1 : up;
            tiers.push({
                kind: 'shaft', width: width * 0.98, depth: depth * 0.98, bottomY: h0, topY: h0 + mainF * floorH,
                floors: mainF, floorH,
                matRole: 'wall', tint: pal.tint, windowStyle: 'punched', windowFrac: 0.34,
            });
            if (hasStep) {
                tiers.push({
                    kind: 'penthouse', width: width * 0.84, depth: depth * 0.84,
                    bottomY: h0 + mainF * floorH, topY: h0 + up * floorH,
                    floors: 1, floorH,
                    matRole: 'trim', tint: mix3(pal.tint, [1, 1, 1], 0.15), windowStyle: 'curtain', windowFrac: 0.48,
                });
            }
        }
    } else if (archetype === 'house') {
        const bodyH = lobbyH + (floors > 1 ? floorH : 0);
        tiers.push({
            kind: 'houseBody', width, depth, bottomY: podiumH, topY: podiumH + bodyH,
            floors, floorH: bodyH / floors,
            matRole: 'wall', tint: pal.tint, windowStyle: 'punched', windowFrac: 0.24,
        });
    } else {
        // Transit station pavilion
        tiers.push({
            kind: 'stationHall', width: width * 0.68, depth: depth * 0.72, bottomY: podiumH, topY: podiumH + floorH,
            floors: 1, floorH,
            matRole: 'wall', tint: pal.tint, windowStyle: 'curtain', windowFrac: 0.60,
        });
    }

    const topTier = tiers[tiers.length - 1];
    let roof;
    if (archetype === 'house') {
        const roofType = rng() < 0.62 ? 'gable' : 'hip';
        roof = {
            type: roofType,
            bottomY: topTier.topY,
            width: topTier.width,
            depth: topTier.depth,
            overhang: 0.55,
            height: Math.min(3.6, Math.max(1.8, Math.min(topTier.width, topTier.depth) * 0.28)),
            matRole: 'roof',
            tint: pal.roofTint,
            hasChimney: rng() < 0.7,
        };
    } else if (archetype === 'station') {
        roof = {
            type: 'canopy',
            bottomY: topTier.topY,
            width: width * 1.12,
            depth: depth * 1.18,
            overhang: 0,
            height: 0.55,
            matRole: 'roof',
            tint: pal.roofTint,
        };
    } else if (archetype === 'skyscraper') {
        roof = {
            type: 'setback_crown',
            bottomY: topTier.topY,
            width: topTier.width,
            depth: topTier.depth,
            overhang: 0,
            height: 2.8 + rng() * 2.2,
            parapetH: 1.1,
            hasSpire: floors >= 24 && rng() < 0.6,
            spireH: 7.0 + rng() * 9.0,
            matRole: 'roof',
            tint: pal.roofTint,
        };
    } else {
        roof = {
            type: 'flat_parapet',
            bottomY: topTier.topY,
            width: topTier.width,
            depth: topTier.depth,
            overhang: 0.2,
            height: 0.65,
            hvacCount: floors >= 3 ? 2 : 1,
            matRole: 'roof',
            tint: pal.roofTint,
        };
    }

    const baySpacing = archetype === 'skyscraper' ? 3.8 : 3.2;
    return {
        id,
        seed,
        archetype,
        x,
        z,
        yaw,
        groundY,
        slopeDrop,
        width,
        depth,
        floors,
        plinth: { bottomY: -skirtDepth, topY: archetype === 'house' || archetype === 'station' ? podiumH : 0.25 },
        tiers,
        roof,
        materials: pal,
        baySpacing,
        doorway: { side: '+z', width: archetype === 'house' ? 1.5 : 2.6, height: archetype === 'house' ? 2.4 : 3.1 },
        totalHeight: roof.bottomY + roof.height + (roof.hasSpire ? roof.spireH : 0),
    };
}

/**
 * Generates differentiated non-identical room & furniture programs per floor.
 * Ground floors become lobbies / storefronts / living-kitchens; upper floors
 * vary between open offices, suite partitions, conference/studies, and penthouses.
 */
export function generateFloorPlan(bp, floorIdx) {
    const t = bp.tiers[0];
    const w = t.width - 0.6;
    const d = t.depth - 0.6;
    const isTop = floorIdx >= bp.floors - 1 && bp.floors > 1;
    const core = {
        x: -w * 0.28,
        z: -d * 0.24,
        w: Math.min(3.6, w * 0.22),
        d: Math.min(3.4, d * 0.22),
    };

    let program = 'lobby';
    if (bp.archetype === 'house') {
        program = floorIdx === 0 ? 'living_kitchen' : 'bedroom_study';
    } else if (bp.archetype === 'station') {
        program = 'station_concourse';
    } else if (floorIdx === 0) {
        program = bp.archetype === 'shopfront' ? 'retail_cafe' : 'lobby';
    } else if (isTop) {
        program = 'penthouse_lounge';
    } else {
        const cycle = (floorIdx + (bp.seed % 3)) % 3;
        program = cycle === 0 ? 'open_office' : (cycle === 1 ? 'executive_suites' : 'conference_studio');
    }

    const walls = [];
    const items = [];

    if (program === 'lobby') {
        items.push({ kind: 'reception', x: 0, z: -d * 0.16, rot: 0, scale: 1.1 });
        items.push({ kind: 'sofa', x: w * 0.24, z: d * 0.16, rot: -Math.PI * 0.5, scale: 1.0 });
        items.push({ kind: 'table_round', x: w * 0.16, z: d * 0.16, rot: 0, scale: 0.9 });
        items.push({ kind: 'planter', x: -w * 0.34, z: d * 0.32, rot: 0, scale: 1.0 });
        items.push({ kind: 'planter', x: w * 0.34, z: d * 0.32, rot: 0, scale: 1.0 });
    } else if (program === 'retail_cafe') {
        items.push({ kind: 'reception', x: -w * 0.16, z: -d * 0.18, rot: 0, scale: 1.2 });
        items.push({ kind: 'table_round', x: w * 0.22, z: d * 0.14, rot: 0, scale: 0.95 });
        items.push({ kind: 'chair', x: w * 0.22 - 0.8, z: d * 0.14, rot: Math.PI * 0.5, scale: 1.0 });
        items.push({ kind: 'chair', x: w * 0.22 + 0.8, z: d * 0.14, rot: -Math.PI * 0.5, scale: 1.0 });
        items.push({ kind: 'shelf', x: -w * 0.38, z: 0, rot: Math.PI * 0.5, scale: 1.0 });
    } else if (program === 'living_kitchen') {
        walls.push({ x: w * 0.08, z: -d * 0.1, w: 0.16, d: d * 0.42 }); // kitchen partition
        items.push({ kind: 'sofa', x: -w * 0.18, z: d * 0.12, rot: 0, scale: 1.0 });
        items.push({ kind: 'table_round', x: -w * 0.18, z: d * 0.26, rot: 0, scale: 0.85 });
        items.push({ kind: 'counter', x: w * 0.26, z: -d * 0.24, rot: 0, scale: 1.0 });
        items.push({ kind: 'shelf', x: -w * 0.38, z: -d * 0.15, rot: Math.PI * 0.5, scale: 0.9 });
    } else if (program === 'bedroom_study') {
        walls.push({ x: 0, z: -d * 0.06, w: 0.16, d: d * 0.52 });
        items.push({ kind: 'bed', x: -w * 0.24, z: -d * 0.18, rot: 0, scale: 1.0 });
        items.push({ kind: 'desk', x: w * 0.24, z: -d * 0.12, rot: Math.PI, scale: 1.0 });
        items.push({ kind: 'chair', x: w * 0.24, z: -d * 0.12 + 0.75, rot: Math.PI, scale: 1.0 });
    } else if (program === 'station_concourse') {
        items.push({ kind: 'reception', x: -w * 0.22, z: -d * 0.12, rot: 0, scale: 1.3 });
        items.push({ kind: 'bench', x: w * 0.18, z: 0.1 * d, rot: 0, scale: 1.2 });
        items.push({ kind: 'bench', x: w * 0.18, z: -0.18 * d, rot: 0, scale: 1.2 });
    } else if (program === 'open_office') {
        for (const ox of [-w * 0.18, w * 0.20]) {
            for (const oz of [-d * 0.18, d * 0.16]) {
                items.push({ kind: 'desk', x: ox, z: oz, rot: 0, scale: 1.0 });
                items.push({ kind: 'chair', x: ox, z: oz + 0.78, rot: Math.PI, scale: 1.0 });
            }
        }
    } else if (program === 'executive_suites') {
        walls.push({ x: 0.12 * w, z: -0.1 * d, w: 0.16, d: d * 0.48 });
        walls.push({ x: 0.28 * w, z: 0.14 * d, w: w * 0.34, d: 0.16 });
        items.push({ kind: 'desk', x: 0.28 * w, z: -0.20 * d, rot: 0, scale: 1.15 });
        items.push({ kind: 'chair', x: 0.28 * w, z: -0.20 * d + 0.85, rot: Math.PI, scale: 1.05 });
        items.push({ kind: 'shelf', x: -0.32 * w, z: 0.18 * d, rot: Math.PI * 0.5, scale: 1.0 });
    } else if (program === 'conference_studio') {
        walls.push({ x: -0.16 * w, z: 0, w: 0.16, d: d * 0.44 });
        items.push({ kind: 'conference_table', x: 0.16 * w, z: 0, rot: 0, scale: 1.1 });
        items.push({ kind: 'chair', x: 0.16 * w - 1.4, z: 0, rot: Math.PI * 0.5, scale: 1.0 });
        items.push({ kind: 'chair', x: 0.16 * w + 1.4, z: 0, rot: -Math.PI * 0.5, scale: 1.0 });
    } else {
        // penthouse_lounge
        items.push({ kind: 'sofa', x: 0.14 * w, z: -0.10 * d, rot: 0, scale: 1.2 });
        items.push({ kind: 'table_round', x: 0.14 * w, z: 0.12 * d, rot: 0, scale: 1.1 });
        items.push({ kind: 'planter', x: -0.32 * w, z: -0.24 * d, rot: 0, scale: 1.1 });
    }

    return { floorIdx, program, core, walls, items };
}

export function computeTierLodColor(tier, bp, mats) {
    const pal = bp.materials;
    const role = tier.matRole === 'base' ? pal.base : (tier.matRole === 'trim' ? pal.trim : pal.wall);
    const wallAvg = mats[role]?.averageColor ?? [0.55, 0.53, 0.50];
    const glassAvg = mats.curtainGlass?.averageColor ?? [0.06, 0.10, 0.14];
    const trimAvg = mats[pal.trim]?.averageColor ?? wallAvg;
    const wallColored = mul3(wallAvg, tier.tint ?? [1, 1, 1]);
    const fWin = tier.windowFrac ?? 0.4;
    const fTrim = 0.08;
    const fWall = Math.max(0, 1 - fWin - fTrim);
    return [
        wallColored[0] * fWall + glassAvg[0] * fWin + trimAvg[0] * fTrim,
        wallColored[1] * fWall + glassAvg[1] * fWin + trimAvg[1] * fTrim,
        wallColored[2] * fWall + glassAvg[2] * fWin + trimAvg[2] * fTrim,
    ];
}
