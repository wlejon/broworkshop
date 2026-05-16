// Tree archetype — broadleaf with full life cycle.
//
//   seed       acorn / seed lying on the ground.
//   sprout     2cm green stem + cotyledon pair.
//   seedling   first true leaves on a thin stem.
//   juvenile   small fractal tree (recursion=0, sparse foliage).
//   mature     full canopy + recursive branching (the original tree recipe).
//   flowering  mature + bloom clusters at canopy anchors.
//   fruiting   mature + small fruit at canopy anchors.
//   senescent  mature with autumn-tinted canopy + thinned blobs.

(function (root) {

const F = root.FloraCore;
const L = root.Lifecycle;
const Species = root.Species;
const TAU = F.TAU;

const CANOPY_SHAPES = ['round', 'oval', 'columnar', 'umbrella', 'weeping', 'vase', 'spreading', 'irregular'];

// ─── Canopy shape catalogue (returns blob descriptors + anchors) ─────────
//
// Same geometry strategy as the original flora recipe — anchors are world-
// space blob centres, also used as branch endpoints. Asymmetry shift logic
// preserved verbatim so forest mode keeps working.

function buildTreeCanopy(shape, ctx) {
    const center = ctx.center;
    const R = ctx.radius;
    const H = ctx.height;
    const color = ctx.color;
    const seed = (ctx.seed | 0) || 1;
    const shift = ctx.shift || [0, 0, 0];
    const asym = F.clamp(ctx.asymmetry ?? 0, 0, 1);
    const blobCount = Math.max(1, ctx.blobCount ?? 1);
    const densityMul = F.clamp(ctx.densityMul ?? 1, 0.05, 1.5);
    const rng = F.mulberry32(seed);

    const sLen = Math.sqrt(shift[0]*shift[0] + shift[2]*shift[2]);
    const sdir = sLen > 1e-6 ? [shift[0]/sLen, 0, shift[2]/sLen] : null;

    const parts = [];
    const aabb = F.emptyAabb();
    const anchors = [];

    function asymScale(localOff) {
        if (!sdir || asym === 0) return 1;
        const offLen = Math.sqrt(localOff[0]*localOff[0] + localOff[2]*localOff[2]);
        if (offLen < 1e-6) return 1;
        const d = (localOff[0]*sdir[0] + localOff[2]*sdir[2]) / Math.max(R, 1e-6);
        return Math.max(0.25, 1 + asym * d * 0.7);
    }

    function pushBlob(localOff, r, sx, sy, sz, blobSeed, nsub) {
        const k = asymScale(localOff);
        const sxF = sx * k, szF = sz * k;
        const c = [
            center[0] + localOff[0] + shift[0],
            center[1] + localOff[1] + shift[1],
            center[2] + localOff[2] + shift[2],
        ];
        const m = F.buildBlob(c, r, blobSeed, { nsub, sx: sxF, sy: sy, sz: szF });
        parts.push({ mesh: m, color, metallic: 0, roughness: 0.85 });
        anchors.push([c[0], c[1], c[2]]);
        const ms = Math.max(sxF, sy, szF);
        F.aabbInclude(aabb, c, r * ms * 1.15);
    }

    switch (shape) {
        case 'oval': {
            pushBlob([0, R * 0.18, 0], R * 0.95, 0.85, 1.45, 0.85, seed ^ 0x1002, 3);
            pushBlob([0, -R * 0.25, 0], R * 0.55, 0.7, 1.0, 0.7, seed ^ 0x2002, 2);
            const sideN = Math.max(0, Math.min(8, Math.round((R * 0.5 - 1) * densityMul)));
            for (let i = 0; i < sideN; i++) {
                const a = TAU * i / sideN + rng() * 0.4;
                const off = R * 0.55;
                const yj = (rng() - 0.5) * R * 0.8;
                pushBlob([Math.cos(a) * off, R * 0.1 + yj, Math.sin(a) * off],
                    R * (0.28 + rng() * 0.10), 0.85, 1.0, 0.85,
                    (seed * 11 + i * 23) ^ 0x1102, 2);
            }
            break;
        }
        case 'columnar': {
            const stacks = Math.max(4, Math.min(10, Math.round(H * 0.4 + 3)));
            const totalH = Math.max(R * 1.5, H * 0.75);
            for (let i = 0; i < stacks; i++) {
                const t = i / (stacks - 1);
                const widen = 0.55 + 0.15 * Math.sin(Math.PI * t);
                pushBlob(
                    [(rng() - 0.5) * R * 0.10, (t - 0.5) * totalH, (rng() - 0.5) * R * 0.10],
                    R * 0.6, widen, 1.0, widen,
                    (seed * 13 + i * 41) ^ 0x1003, 2);
            }
            break;
        }
        case 'umbrella': {
            pushBlob([0, R * 0.10, 0], R * 1.10, 1.1, 0.40, 1.1, seed ^ 0x1004, 3);
            const ringN = Math.max(5, Math.min(10, Math.round((R * 0.6 + 3) * densityMul)));
            for (let i = 0; i < ringN; i++) {
                const a = TAU * i / ringN + rng() * 0.30;
                pushBlob([Math.cos(a) * R * 0.95, -R * 0.06, Math.sin(a) * R * 0.95],
                    R * 0.42, 1.0, 0.42, 1.0, (seed * 7 + i * 23) ^ 0x1104, 2);
            }
            if (R > 5) {
                const outerN = Math.round(ringN * 0.7);
                for (let i = 0; i < outerN; i++) {
                    const a = TAU * (i + 0.5) / outerN + rng() * 0.25;
                    pushBlob([Math.cos(a) * R * 1.20, -R * 0.10, Math.sin(a) * R * 1.20],
                        R * 0.28, 1.0, 0.40, 1.0, (seed * 19 + i * 17) ^ 0x1204, 2);
                }
            }
            break;
        }
        case 'weeping': {
            pushBlob([0, R * 0.10, 0], R * 1.00, 1.05, 0.90, 1.05, seed ^ 0x1005, 3);
            const minDy = -Math.max(0, center[1] - 0.5);
            const streamerN = Math.round(7 * densityMul);
            for (let i = 0; i < streamerN; i++) {
                const a = TAU * i / Math.max(1, streamerN) + rng() * 0.5;
                const off = R * (0.65 + rng() * 0.25);
                let dy = -R * (0.45 + rng() * 0.45);
                if (dy < minDy) dy = minDy;
                pushBlob([Math.cos(a) * off, dy, Math.sin(a) * off],
                    R * 0.20 * (0.8 + rng() * 0.4), 0.55, 1.55, 0.55,
                    (seed * 19 + i * 17) ^ 0x1105, 1);
            }
            break;
        }
        case 'vase': {
            const tiers = 3;
            for (let i = 0; i < tiers; i++) {
                const t = i / (tiers - 1);
                const ringR = R * (0.30 + 0.85 * t);
                const y = (t - 0.45) * H * 0.6;
                const n = i === tiers - 1 ? 5 : 3;
                for (let k = 0; k < n; k++) {
                    const a = TAU * k / n + i * 0.6 + rng() * 0.3;
                    pushBlob([Math.cos(a) * ringR * 0.65, y, Math.sin(a) * ringR * 0.65],
                        ringR * 0.45 * (0.85 + rng() * 0.30), 1.0, 0.95, 1.0,
                        (seed * 23 + i * 31 + k * 11) ^ 0x1006, 2);
                }
            }
            break;
        }
        case 'spreading': {
            pushBlob([0, 0, 0], R * 1.10, 1.0, 0.55, 1.0, seed ^ 0x1007, 3);
            const lobesN = Math.max(4, Math.min(10, Math.round((R * 0.55 + 2) * densityMul)));
            for (let i = 0; i < lobesN; i++) {
                const a = TAU * i / lobesN + rng() * 0.35;
                const off = R * (0.75 + rng() * 0.15);
                pushBlob([Math.cos(a) * off, -R * 0.08 + (rng() - 0.5) * R * 0.12, Math.sin(a) * off],
                    R * (0.45 + rng() * 0.15), 1.0, 0.55, 1.0,
                    (seed * 11 + i * 29) ^ 0x1107, 2);
            }
            if (R > 5) {
                for (let i = 0; i < lobesN; i++) {
                    const a = TAU * (i + 0.5) / lobesN + rng() * 0.25;
                    const off = R * (0.95 + rng() * 0.20);
                    pushBlob([Math.cos(a) * off, -R * 0.18, Math.sin(a) * off],
                        R * (0.25 + rng() * 0.10), 1.0, 0.55, 1.0,
                        (seed * 23 + i * 31) ^ 0x1207, 2);
                }
            }
            break;
        }
        case 'irregular': {
            const sizeFloor = Math.max(3, Math.round(R * 0.7 + 1));
            const n = Math.max(blobCount, sizeFloor);
            for (let i = 0; i < n; i++) {
                const a = TAU * i / n + rng() * 0.45;
                const off = R * 0.55 * (0.65 + rng() * 0.55);
                const yj = (rng() - 0.5) * H * 0.35;
                pushBlob([Math.cos(a) * off, yj, Math.sin(a) * off],
                    R * 0.50 * (0.75 + rng() * 0.55), 1.0, 1.0, 1.0,
                    (seed * 17 + i * 31) ^ 0x1008, 2);
            }
            pushBlob([0, 0, 0], R * 0.85, 1.0, 0.85, 1.0, seed ^ 0x2008, 2);
            break;
        }
        case 'round':
        default: {
            const primaryN = Math.max(4, Math.min(10, Math.round((R * 0.6 + 2) * densityMul)));
            const useSecondaries = R > 4;
            pushBlob([0, R * 0.05, 0],
                useSecondaries ? R * 0.65 : R * 0.85,
                1.0, 0.95, 1.0, seed ^ 0x1001, 3);
            for (let i = 0; i < primaryN; i++) {
                const ang = TAU * i / primaryN + rng() * 0.30;
                const off = R * (0.55 + rng() * 0.18);
                const yj  = (rng() - 0.4) * R * 0.30;
                const primC = [Math.cos(ang) * off, yj, Math.sin(ang) * off];
                const primR = useSecondaries
                    ? R * (0.32 + rng() * 0.10)
                    : R * (0.50 + rng() * 0.10);
                pushBlob(primC, primR, 1.0, 0.95, 1.0, (seed * 13 + i * 23) ^ 0x1101, 2);
                if (useSecondaries) {
                    for (let j = 0; j < 2; j++) {
                        const dAng = (j === 0 ? -1 : 1) * (0.32 + rng() * 0.25);
                        const subAng = ang + dAng;
                        const subOff = off + R * (0.18 + rng() * 0.18);
                        const subY  = primC[1] + (rng() - 0.5) * R * 0.18;
                        pushBlob(
                            [Math.cos(subAng) * subOff, subY, Math.sin(subAng) * subOff],
                            R * (0.20 + rng() * 0.10), 1.0, 0.95, 1.0,
                            (seed * 17 + i * 31 + j * 11) ^ 0x1201, 2);
                    }
                }
            }
            break;
        }
    }
    return { parts, aabb, anchors };
}

// ─── Branch tree (fractal recursion) ─────────────────────────────────────

function buildBranchSegments(opts, anchors) {
    const Heff = opts.Heff;
    const CReff = opts.CReff;
    const trunkRadius = opts.trunkRadius;
    const canopyBase = opts.canopyBase;
    const seed = opts.seed;

    const forkY = Math.max(trunkRadius * 2.0, canopyBase * 0.75);
    const trunkSteps = Math.max(2, Math.round(forkY / Math.max(0.3, Heff * 0.10)));
    const segs = [];
    let prevIdx = -1;
    for (let i = 1; i <= trunkSteps; i++) {
        const t0 = (i - 1) / trunkSteps;
        const t1 = i / trunkSteps;
        const r = trunkRadius * (1 - t1 * 0.20);
        segs.push({ parent: prevIdx, from: [0, t0 * forkY, 0], to: [0, t1 * forkY, 0], radius: r });
        prevIdx = segs.length - 1;
    }
    const forkIdx = prevIdx;

    const branchStep = Math.max(0.4, Math.min(CReff * 0.25, Heff * 0.15));

    const levelR = [
        [0.55, 0.34],
        [0.32, 0.18],
        [0.17, 0.09],
        [0.09, 0.05],
    ];

    const N = anchors.length;
    let maxLevel;
    if (CReff < 2.0 || N <= 2)        maxLevel = 0;
    else if (CReff < 5.0 || N <= 4)   maxLevel = 1;
    else if (CReff < 10.0)            maxLevel = 2;
    else                              maxLevel = 3;

    function addChain(parentIdx, fromPos, toPos, baseR, tipR) {
        const dx = toPos[0] - fromPos[0];
        const dy = toPos[1] - fromPos[1];
        const dz = toPos[2] - fromPos[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (dist < 1e-3) return parentIdx;
        const steps = Math.max(2, Math.round(dist / branchStep));
        let bParent = parentIdx;
        let cur = fromPos;
        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const nxt = [fromPos[0] + dx*t, fromPos[1] + dy*t, fromPos[2] + dz*t];
            const r = baseR + (tipR - baseR) * t;
            segs.push({ parent: bParent, from: cur, to: nxt, radius: r });
            bParent = segs.length - 1;
            cur = nxt;
        }
        return bParent;
    }

    function angularCluster(items, fromPos, K) {
        if (items.length <= 1) return [items.slice()];
        const enriched = items.map((a) => ({
            a, ang: Math.atan2(a[2] - fromPos[2], a[0] - fromPos[0]),
        }));
        enriched.sort((p, q) => p.ang - q.ang);
        const per = Math.ceil(enriched.length / K);
        const groups = [];
        for (let g = 0; g < K; g++) {
            const start = g * per;
            const end = Math.min(start + per, enriched.length);
            if (start < end) groups.push(enriched.slice(start, end).map((x) => x.a));
        }
        return groups;
    }

    function buildRec(parentIdx, fromPos, group, level) {
        if (group.length === 0) return;
        const ri = Math.min(level, levelR.length - 1);
        const baseR = Math.max(0.025, trunkRadius * levelR[ri][0]);
        const tipR  = Math.max(0.018, trunkRadius * levelR[ri][1]);
        if (group.length === 1 || level >= maxLevel) {
            for (const a of group) addChain(parentIdx, fromPos, a, baseR, tipR);
            return;
        }
        const K = Math.max(2, Math.min(4, Math.ceil(group.length / 2)));
        const clusters = angularCluster(group, fromPos, K);
        if (clusters.length < 2) {
            for (const a of group) addChain(parentIdx, fromPos, a, baseR, tipR);
            return;
        }
        for (const c of clusters) {
            if (c.length === 0) continue;
            let cx = 0, cy = 0, cz = 0;
            for (const a of c) { cx += a[0]; cy += a[1]; cz += a[2]; }
            cx /= c.length; cy /= c.length; cz /= c.length;
            const jct = [
                fromPos[0] + (cx - fromPos[0]) * 0.55,
                fromPos[1] + (cy - fromPos[1]) * 0.55,
                fromPos[2] + (cz - fromPos[2]) * 0.55,
            ];
            const junctionIdx = addChain(parentIdx, fromPos, jct, baseR, tipR);
            buildRec(junctionIdx, jct, c, level + 1);
        }
    }
    buildRec(forkIdx, [0, forkY, 0], anchors, 0);
    return segs;
}

// ─── Mature tree (the headline canopy + branch + foliage path) ────────────

function buildTreeMature(opts, stageT, modifiers) {
    modifiers = modifiers || {};
    const seed = (opts.seed | 0) || 1;
    const H = opts.height ?? 6;
    const trunkRadius = opts.trunkRadius ?? 0.18;
    const CR = opts.canopyRadius ?? 3;
    const blobCount = Math.max(1, opts.blobCount ?? 3);
    const canopyColor = (modifiers.canopyColor) || F.hexToRgb(opts.canopyColor || '#4f8c39');
    const canopyShape = opts.canopyShape || 'round';
    const canopyShift = opts.canopyShift || [0, 0, 0];
    const canopyAsymmetry = opts.canopyAsymmetry ?? 0;
    const foliageStyle = opts.foliageStyle || 'blobs';
    const leafShape = opts.leafShape || 'oval';
    const trunkColor = F.hexToRgb(opts.trunkColor || F.PALETTE.bark);
    const densityMul = modifiers.densityMul ?? 1;

    const shapeBias = {
        round:     { yPlace: 0.65, vSpan: 0.55 },
        oval:      { yPlace: 0.65, vSpan: 0.70 },
        columnar:  { yPlace: 0.55, vSpan: 1.10 },
        umbrella:  { yPlace: 0.78, vSpan: 0.30 },
        weeping:   { yPlace: 0.72, vSpan: 0.50 },
        vase:      { yPlace: 0.65, vSpan: 0.60 },
        spreading: { yPlace: 0.58, vSpan: 0.30 },
        irregular: { yPlace: 0.62, vSpan: 0.55 },
    };
    const bias = shapeBias[canopyShape] || shapeBias.round;

    const Heff = H * Math.max(0.1, modifiers.scale ?? 1);
    const CReff = CR * Math.max(0.15, (modifiers.canopyScale ?? 1));

    const parts = [];
    const aabb = F.emptyAabb();

    const canopyMidY = Heff * bias.yPlace;
    const canopyBase = Math.max(Heff * 0.18, canopyMidY - Heff * bias.vSpan * 0.5);
    const canopyTop  = canopyMidY + Heff * bias.vSpan * 0.5;
    const canopyCenter = [0, canopyMidY, 0];
    const canopyH = Math.max(CReff * 0.5, canopyTop - canopyBase);

    const canopy = buildTreeCanopy(canopyShape, {
        center: canopyCenter, radius: CReff, height: canopyH,
        color: canopyColor, seed, shift: canopyShift,
        asymmetry: canopyAsymmetry, blobCount, densityMul,
    });

    const segs = buildBranchSegments({
        Heff, CReff, trunkRadius, canopyBase, seed,
    }, canopy.anchors);

    if (segs.length > 0) {
        const trunkMesh = Mesh.meshBranches(segs, 8);
        if (trunkMesh) parts.push({
            mesh: trunkMesh, color: trunkColor, metallic: 0, roughness: 0.95, twoSided: false,
        });
        for (const s of segs) {
            F.aabbInclude(aabb, s.from, s.radius);
            F.aabbInclude(aabb, s.to,   s.radius);
        }
    }

    if (foliageStyle === 'leaves' && segs.length > 0) {
        const leafLen = Math.max(0.08, Math.min(0.32, CReff * 0.06));
        const leafW   = leafLen * 0.45;
        const leafMesh = Mesh.leafCard(leafShape, {
            width: leafW, length: leafLen, bend: 0.3, fullUV: true,
        });
        F.stripVertexColors(leafMesh);
        const perUnit = Math.max(20, Math.min(80, 60 - CReff * 1.5)) * densityMul;
        const foliage = Mesh.scatterLeaves(segs, leafMesh, {
            maxRadius:     trunkRadius * 0.45,
            minDepth:      2,
            perUnitLength: perUnit,
            upBias:        0.4,
            tiltJitter:    0.4,
            rollJitter:    0.6,
            baseScale:     1.0,
            scaleJitter:   0.25,
            scaleByRadius: 0.3,
            seed:          (seed * 257 + 1) >>> 0,
        });
        if (foliage) {
            F.stripVertexColors(foliage);
            parts.push({ mesh: foliage, color: canopyColor, metallic: 0, roughness: 0.85 });
        }
    } else {
        for (const p of canopy.parts) parts.push(p);
    }

    aabb.min[0] = Math.min(aabb.min[0], canopy.aabb.min[0]);
    aabb.min[1] = Math.min(aabb.min[1], canopy.aabb.min[1]);
    aabb.min[2] = Math.min(aabb.min[2], canopy.aabb.min[2]);
    aabb.max[0] = Math.max(aabb.max[0], canopy.aabb.max[0]);
    aabb.max[1] = Math.max(aabb.max[1], canopy.aabb.max[1]);
    aabb.max[2] = Math.max(aabb.max[2], canopy.aabb.max[2]);

    const fin = F.finalizeAabb(aabb, { min: [-1, 0, -1], max: [1, Heff, 1] });
    return { parts, aabbMin: fin.aabbMin, aabbMax: fin.aabbMax,
             anchors: canopy.anchors, segments: segs, canopyCenter, canopyRadius: CReff };
}

// ─── Stage builders ───────────────────────────────────────────────────────

function buildTreeSeed(opts) {
    const r = 0.045 + (opts.trunkRadius || 0.18) * 0.15;
    const out = F.seedShape({
        seed: opts.seed | 0, radius: r,
        color: F.hexToRgb(opts.seedColor || F.PALETTE.seedBrown),
        sx: 0.85, sy: 0.7, sz: 1.1,
    });
    return { parts: out.parts, aabbMin: [-r, 0, -r], aabbMax: [r, out.height, r] };
}

function buildTreeSprout(opts, stageT) {
    const stemH = 0.03 + 0.08 * stageT;
    const out = F.cotyledonPair({
        stemH, stemR: 0.005,
        leafLen: 0.04 + 0.04 * stageT, leafW: 0.022 + 0.01 * stageT,
        leafColor: F.hexToRgb(opts.canopyColor || '#7fc24f'),
    });
    return { parts: out.parts, aabbMin: [-0.06, 0, -0.06], aabbMax: [0.06, out.height, 0.06] };
}

function buildTreeSeedling(opts, stageT) {
    const stemH = 0.10 + 0.20 * stageT;
    const out = F.firstTrueLeaves({
        seed: opts.seed | 0, stemH, stemR: 0.008 + 0.005 * stageT,
        leafCount: 5 + Math.floor(stageT * 3),
        leafLen: 0.06 + 0.04 * stageT,
        leafW: 0.03 + 0.02 * stageT,
        leafShape: opts.leafShape || 'oval',
        leafColor: F.hexToRgb(opts.canopyColor || '#5a9438'),
    });
    return { parts: out.parts, aabbMin: [-0.12, 0, -0.12], aabbMax: [0.12, out.height, 0.12] };
}

function buildTreeJuvenile(opts, stageT) {
    // A small fractal tree — same path as mature but at ~30% scale and
    // the canopy density reduced.
    const scale = 0.20 + 0.35 * stageT;     // 0.20..0.55 of mature
    return buildTreeMature(opts, stageT, {
        scale, canopyScale: scale * 0.95, densityMul: 0.55,
    });
}

function buildTreeMatureStage(opts, stageT) {
    return buildTreeMature(opts, stageT, { scale: 1, canopyScale: 1, densityMul: 1 });
}

function buildTreeFlowering(opts, stageT) {
    const r = buildTreeMature(opts, stageT);
    const bloomColor = F.hexToRgb(opts.bloomColor || '#f7c8d8');
    const bloomShape = opts.bloomShape || 'petal';
    const bloomDensity = (opts.bloomDensity ?? 0.7) * (0.4 + 0.6 * stageT);
    const bloomLayers = opts.bloomLayers ?? 2;
    const radius = (opts.bloomRadius ?? Math.max(0.06, (opts.canopyRadius ?? 3) * 0.04));
    const bloom = F.bloomCluster({
        anchors: r.anchors, seed: (opts.seed | 0) ^ 0xB1A0,
        color: bloomColor, radius, density: bloomDensity,
        useFlower: radius >= 0.06,
        petalShape: bloomShape, petalCount: opts.petalCount ?? 6,
        layers: bloomLayers,
    });
    for (const p of bloom.parts) r.parts.push(p);
    return r;
}

function buildTreeFruiting(opts, stageT) {
    const r = buildTreeMature(opts, stageT);
    const fruitColor = F.hexToRgb(opts.fruitColor || '#a01030');
    const fruitR = opts.fruitRadius ?? Math.max(0.04, (opts.canopyRadius ?? 3) * 0.025);
    const fruit = F.fruitCluster({
        anchors: r.anchors, seed: (opts.seed | 0) ^ 0xF1A0,
        color: fruitColor, radius: fruitR,
        density: 0.35 + 0.4 * stageT, sag: 0.35,
    });
    for (const p of fruit.parts) r.parts.push(p);
    return r;
}

function buildTreeSenescent(opts, stageT) {
    const baseColor = F.hexToRgb(opts.canopyColor || '#4f8c39');
    const tintAmt = F.clamp(opts.senescentTint ?? 0.7, 0, 1) * (0.3 + 0.7 * stageT);
    const tinted = F.autumnTint(baseColor, tintAmt, opts.senescentPhase ?? 0.5);
    // Thin foliage progressively as stage advances.
    const densityMul = F.clamp(1 - 0.5 * stageT, 0.35, 1);
    const r = buildTreeMature(opts, stageT, {
        canopyColor: tinted, scale: 1, canopyScale: 1, densityMul,
    });
    return r;
}

const TREE_STAGE_BUILDERS = {
    seed:       buildTreeSeed,
    sprout:     buildTreeSprout,
    seedling:   buildTreeSeedling,
    juvenile:   buildTreeJuvenile,
    mature:     buildTreeMatureStage,
    flowering:  buildTreeFlowering,
    fruiting:   buildTreeFruiting,
    senescent:  buildTreeSenescent,
};

const DEFAULT_TREE_STAGES = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'senescent'];
const FLOWERING_TREE_STAGES = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'flowering', 'fruiting', 'senescent'];

function tree(opts) {
    opts = Object.assign({}, opts);
    if (opts.species) {
        opts = root.FloraSpecies.applySpecies('tree', opts.species, opts);
    }
    const hasFlowering = !!opts.bloomColor;
    const stages = opts.stagesOverride || (hasFlowering ? FLOWERING_TREE_STAGES : DEFAULT_TREE_STAGES);
    const r = L.resolveStage(stages, opts.age01 ?? 1);
    const builder = TREE_STAGE_BUILDERS[r.stage] || TREE_STAGE_BUILDERS.mature;
    return builder(opts, r.stageT);
}

root.Recipes = root.Recipes || {};
root.Recipes.tree = tree;
root.Recipes.CANOPY_SHAPES = CANOPY_SHAPES;
root.Recipes._TreeStages = { DEFAULT_TREE_STAGES, FLOWERING_TREE_STAGES };

})(this);
