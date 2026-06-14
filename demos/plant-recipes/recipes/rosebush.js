// Rose bush — the headline life cycle.
//
// Stages:
//   seed       small dark rose seed on the ground.
//   sprout     2 cotyledons on a tiny stem.
//   seedling   thin stem + 4 small toothed leaves.
//   juvenile   small bushy form (a few short canes, sparse leaves, no thorns).
//   mature     full bush: arching canes, thorns, compound leaves.
//   flowering  mature + rose blooms near upper cane tips.
//   fruiting   mature + red rose hips at terminal twigs.
//   senescent  autumn-tinted leaves thinned, hips dropped.
//
// Geometry: each primary cane is a cubic bezier swept by Mesh.bezierSweep
// — this gives smooth arching tubes with proper taper, like real rose
// canes. Side twigs are short straight tubes. Thorns and compound leaves
// scatter along the sampled segments.

import { FloraCore } from "/app/recipes/core.js";
import { Lifecycle } from "/app/recipes/lifecycle.js";
import { FloraSpecies } from "/app/recipes/species.js";
import { Recipes } from "/app/recipes/index.js";

const F = FloraCore;
const L = Lifecycle;
const TAU = F.TAU;

// ─── Bezier helpers ───────────────────────────────────────────────────────

function bezier3(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const uu = u * u, tt = t * t;
    const a = uu * u, b = 3 * uu * t, c = 3 * u * tt, d = tt * t;
    return [
        a*p0[0] + b*p1[0] + c*p2[0] + d*p3[0],
        a*p0[1] + b*p1[1] + c*p2[1] + d*p3[1],
        a*p0[2] + b*p1[2] + c*p2[2] + d*p3[2],
    ];
}

function circleProfile(sides) {
    const out = [];
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * TAU;
        out.push([Math.cos(a), Math.sin(a)]);
    }
    return out;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────

function buildBushSkeleton(opts, scaleMul) {
    const seed = (opts.seed | 0) || 1;
    const H = (opts.bushHeight ?? 1.0) * scaleMul;
    const R = (opts.bushRadius ?? 0.8) * scaleMul;
    const canesCount = Math.max(1, Math.round(opts.canes ?? 4));
    const rng = F.mulberry32(seed * 31);

    const stemColor = F.hexToRgb(opts.stemColor || F.PALETTE.barkRose);
    const parts = [];
    const segs = [];          // synthetic segments for thorn/leaf scatter
    const terminals = [];     // tips for blooms / hips

    const caneBaseR = Math.max(0.006, 0.018 * scaleMul);
    const caneTipR  = Math.max(0.0035, 0.006 * scaleMul);
    const profile = circleProfile(8);

    function pushCanePart(mesh) {
        if (!mesh) return;
        F.stripVertexColors(mesh);
        parts.push({ mesh, color: stemColor, metallic: 0, roughness: 0.85, twoSided: false });
    }

    // Sample a bezier curve into N short segments (used for thorn / leaf
    // scatter and for terminal tracking).
    function sampleCane(p0, p1, p2, p3, segCount, baseR, tipR) {
        let prev = p0;
        for (let i = 1; i <= segCount; i++) {
            const t = i / segCount;
            const pt = bezier3(p0, p1, p2, p3, t);
            const r = baseR * (1 - t) + tipR * t;
            segs.push({ from: prev, to: pt, radius: r, parent: -1 });
            prev = pt;
        }
    }

    for (let c = 0; c < canesCount; c++) {
        const baseAngle = (c / canesCount) * TAU + (rng() - 0.5) * 0.7;
        const baseR = 0.04 * scaleMul;
        const p0 = [Math.cos(baseAngle) * baseR, 0, Math.sin(baseAngle) * baseR];

        // Cane silhouette: shoots straight up for ~60% of its height, then
        // arches over and out into the canopy. That upright→arch shape
        // (rather than splaying outward from the base) is what reads as a
        // rose bush. p1 is far up and barely outward; p2 is high and only
        // moderately outward; p3 is the tip — at modest reach and at a
        // height near the apex (slight droop).
        const archH = H * (0.85 + rng() * 0.20);
        const reach = R * (0.30 + rng() * 0.30);    // narrower silhouette
        const tipAngle = baseAngle + (rng() - 0.5) * 0.4;
        const p3 = [Math.cos(tipAngle) * reach, archH * (0.85 + rng() * 0.15), Math.sin(tipAngle) * reach];
        // p1 well above base, almost on the trunk axis — keeps cane vertical at first
        const c1y = archH * (0.55 + rng() * 0.10);
        const p1 = [p0[0] * 0.3, c1y, p0[2] * 0.3];
        // p2 above the tip — pulls the curve into a graceful overhead arch
        const p2 = [p3[0] * 0.55, archH * (1.00 + rng() * 0.05), p3[2] * 0.55];

        const samples = 22;
        const psc = new Array(samples);
        for (let i = 0; i < samples; i++) {
            const t = i / (samples - 1);
            // Slight non-linear taper — fatter near base, narrowing fast then slow
            const tt = Math.pow(t, 0.8);
            psc[i] = caneBaseR * (1 - tt) + caneTipR * tt;
        }
        const caneMesh = Mesh.bezierSweep([p0, p1, p2, p3], profile, {
            samples, profileScale: psc, capStart: true, capEnd: true, miterJoints: true,
        });
        pushCanePart(caneMesh);
        sampleCane(p0, p1, p2, p3, 14, caneBaseR, caneTipR);
        // Tangent at t=1 is 3*(p3 - p2) for a cubic bezier — gives the
        // direction the cane is heading at its tip so blooms can orient
        // along it instead of always pointing straight up.
        const tipTan = F.vNorm([
            3 * (p3[0] - p2[0]),
            3 * (p3[1] - p2[1]),
            3 * (p3[2] - p2[2]),
        ]);
        terminals.push({ p: p3, dir: tipTan });

        // Side twigs: 2–5 short branches sprouting from upper half of cane.
        // Real rose canes branch laterally near the top with short woody
        // spurs that carry the leaves and blooms.
        const sideCount = 2 + Math.floor(rng() * 4);
        for (let s = 0; s < sideCount; s++) {
            const t = 0.40 + rng() * 0.55;
            const at = bezier3(p0, p1, p2, p3, t);
            // Tangent at t (derivative) for outward bias
            const u = 1 - t;
            const tan = [
                3*u*u*(p1[0]-p0[0]) + 6*u*t*(p2[0]-p1[0]) + 3*t*t*(p3[0]-p2[0]),
                3*u*u*(p1[1]-p0[1]) + 6*u*t*(p2[1]-p1[1]) + 3*t*t*(p3[1]-p2[1]),
                3*u*u*(p1[2]-p0[2]) + 6*u*t*(p2[2]-p1[2]) + 3*t*t*(p3[2]-p2[2]),
            ];
            const tl = Math.hypot(tan[0], tan[1], tan[2]) || 1;
            const ang = rng() * TAU;
            // Direction: mostly along tangent, with a perpendicular kick
            const perp1 = F.vNorm(F.vCross(tan, [0, 1, 0]));
            const perp2 = F.vNorm(F.vCross(tan, perp1));
            const out = [
                tan[0]/tl * 0.5 + perp1[0]*Math.cos(ang)*0.7 + perp2[0]*Math.sin(ang)*0.7,
                tan[1]/tl * 0.5 + perp1[1]*Math.cos(ang)*0.7 + perp2[1]*Math.sin(ang)*0.7 + 0.25,
                tan[2]/tl * 0.5 + perp1[2]*Math.cos(ang)*0.7 + perp2[2]*Math.sin(ang)*0.7,
            ];
            const ol = Math.hypot(out[0], out[1], out[2]) || 1;
            const sideLen = (0.20 + rng() * 0.30) * R;
            const tip = [
                at[0] + out[0]/ol * sideLen,
                at[1] + out[1]/ol * sideLen,
                at[2] + out[2]/ol * sideLen,
            ];
            const localR = caneBaseR * (1 - t) + caneTipR * t;
            const sR = localR * 0.7;
            const tipSR = caneTipR * 0.6;
            const tube = Mesh.tube([at, tip], [sR, tipSR], 6);
            pushCanePart(tube);
            segs.push({ from: at, to: tip, radius: (sR + tipSR) * 0.5, parent: -1 });
            // Side-twig terminal tangent is just the twig direction.
            const twigDir = F.vNorm([tip[0] - at[0], tip[1] - at[1], tip[2] - at[2]]);
            terminals.push({ p: tip, dir: twigDir });
        }
    }

    return { segs, terminals, H, R, parts };
}

// ─── Stage builders ───────────────────────────────────────────────────────

function buildRosebushSeed(opts) {
    const r = 0.018;
    const out = F.seedShape({
        seed: opts.seed | 0, radius: r,
        color: F.hexToRgb(opts.seedColor || '#3d2818'),
        sx: 1.4, sy: 0.55, sz: 1.0,
    });
    return { parts: out.parts, aabbMin: [-r, 0, -r], aabbMax: [r, out.height, r] };
}

function buildRosebushSprout(opts, stageT) {
    const stemH = 0.025 + 0.05 * stageT;
    const out = F.cotyledonPair({
        stemH, stemR: 0.004,
        leafLen: 0.025 + 0.025 * stageT, leafW: 0.018 + 0.012 * stageT,
        leafColor: F.hexToRgb(opts.leafColor || '#5a8a3a'),
    });
    return { parts: out.parts, aabbMin: [-0.05, 0, -0.05], aabbMax: [0.05, out.height, 0.05] };
}

function buildRosebushSeedling(opts, stageT) {
    const stemH = 0.05 + 0.10 * stageT;
    const out = F.firstTrueLeaves({
        seed: opts.seed | 0, stemH, stemR: 0.006,
        leafCount: 4, leafLen: 0.05 + 0.04 * stageT, leafW: 0.025 + 0.02 * stageT,
        leafShape: 'pointed',
        leafColor: F.hexToRgb(opts.leafColor || '#3a6a26'),
    });
    return { parts: out.parts, aabbMin: [-0.10, 0, -0.10], aabbMax: [0.10, out.height, 0.10] };
}

// Foliage helper — scatter compound rose leaves along the bush segments.
// Real rose leaves are pinnate compound: 5 (sometimes 3 or 7) leaflets
// arranged opposite-pinnate along a short rachis. We approximate this by
// building a small "rosette" mesh of 5 leaflet cards once, then scattering
// it via Mesh.scatterLeaves so each anchor is a tiny compound leaf.
function buildCompoundRoseLeaf(scaleMul, opts) {
    const baseLen = 0.060 * scaleMul;
    const leafletLen = baseLen;
    const leafletW = baseLen * 0.58;
    const rachis = baseLen * 1.10;
    // Curlier, slightly more tessellated leaflets read as leaves rather
    // than flat cards. width=3, length=6 = ~36 tris per leaflet ×5 = 180
    // tris per compound leaf, but with one mesh instanced over many
    // anchors via scatterLeaves.
    function leaflet() {
        return Mesh.leafCard('pointed', {
            width: leafletW, length: leafletLen,
            bend: 0.55, fullUV: true,
            shapedSilhouette: true,
            cup: 0.30,
            widthSegments: 3, lengthSegments: 6,
        });
    }
    // Pinnate-compound layout: a terminal leaflet + 2 pairs of opposite
    // lateral leaflets along a short rachis. The scatterLeaves frame
    // treats local Z as the "forward" (tip) axis, so we lay the rachis
    // along +Z with leaflets in the XZ plane.
    const positions = [
        { offZ: rachis,         offX: 0,              scale: 1.00, yaw: 0 },
        { offZ: rachis * 0.60,  offX:  leafletW*0.80, scale: 0.85, yaw:  0.50 },
        { offZ: rachis * 0.60,  offX: -leafletW*0.80, scale: 0.85, yaw: -0.50 },
        { offZ: rachis * 0.15,  offX:  leafletW*0.95, scale: 0.70, yaw:  0.90 },
        { offZ: rachis * 0.15,  offX: -leafletW*0.95, scale: 0.70, yaw: -0.90 },
    ];
    const meshes = [];
    for (const p of positions) {
        const m = leaflet();
        if (!m) continue;
        F.stripVertexColors(m);
        m.scale(p.scale, p.scale, p.scale);
        m.rotate(0, 1, 0, p.yaw);
        m.translate(p.offX, 0, p.offZ);
        meshes.push(m);
    }
    // Rachis (the central stem of the compound leaf) — a thin green tube
    // from the petiole base out to the terminal leaflet. Without this the
    // 5 leaflets read as a floating clump; with it they look like a real
    // pinnate rose leaf attached to a stem.
    const rachisR = leafletW * 0.06;
    const rachisMesh = Mesh.tube(
        [[0, 0, 0], [0, 0, rachis * 1.02]],
        [rachisR, rachisR * 0.6],
        4
    );
    if (rachisMesh) {
        F.stripVertexColors(rachisMesh);
        meshes.push(rachisMesh);
    }
    // Tiny petioles linking each lateral leaflet to the rachis. These read
    // very small but matter for the silhouette where leaflets stand off
    // the stem.
    for (const p of positions) {
        if (p.offX === 0 && p.offZ === rachis) continue;   // terminal leaflet sits at rachis tip
        const petiole = Mesh.tube(
            [[0, 0, p.offZ], [p.offX * 0.85, 0, p.offZ + Math.abs(p.offX) * 0.15]],
            [rachisR * 0.7, rachisR * 0.4],
            4
        );
        if (petiole) {
            F.stripVertexColors(petiole);
            meshes.push(petiole);
        }
    }
    if (meshes.length === 0) return null;
    return meshes.length === 1 ? meshes[0] : Mesh.merge(meshes);
}

function attachFoliage(parts, segs, opts, scaleMul, density, avoidField, keepOut) {
    if (!segs || segs.length === 0) return;
    const leafColor = F.hexToRgb(opts.leafColor || '#2c5328');
    const compound = buildCompoundRoseLeaf(scaleMul, opts);
    if (!compound) return;
    F.stripVertexColors(compound);
    // avoidField: capsule field built from sk.segs — leaves whose anchor lies
    // inside another cane's capsule are rejected. obstaclePushout > 0 lets
    // grazing collisions be recovered by stepping outward along the surface
    // normal once before dropping. keepOut spheres reserve volume around
    // blooms / hips so foliage doesn't pack into them.
    const foliage = Mesh.scatterLeaves(segs, compound, {
        maxRadius: 0.05,
        minDepth: 0,
        perUnitLength: Math.max(8, 24 * density),
        upBias: 0.45, tiltJitter: 0.55, rollJitter: 0.7,
        baseScale: 1.0, scaleJitter: 0.30, scaleByRadius: 0.2,
        avoid: avoidField || null,
        obstacleClearance: 0.004 * scaleMul,
        obstaclePushout:   0.020 * scaleMul,
        keepOut: keepOut || [],
        seed: ((opts.seed | 0) * 257 + 11) >>> 0,
    });
    if (foliage) {
        F.stripVertexColors(foliage);
        parts.push({ mesh: foliage, color: leafColor, metallic: 0, roughness: 0.78 });
    }
}

// Build skeleton + thorns into `parts`, return everything callers need to
// place blooms / hips before foliage. `deferFoliage` skips the leaf scatter
// so callers can compute keepOut spheres first and pass them in via
// `attachFoliage` themselves.
function buildRosebushBushy(opts, stageT, scaleMul, hasThorns, foliageDensity, deferFoliage) {
    const sk = buildBushSkeleton(opts, scaleMul);
    const parts = sk.parts.slice();
    const aabb = F.emptyAabb();

    for (const s of sk.segs) {
        F.aabbInclude(aabb, s.from, s.radius);
        F.aabbInclude(aabb, s.to, s.radius);
    }

    // Capsule field over the cane skeleton. radiusScale 1.05 keeps leaves
    // hugging the canes without piercing them. Used for both leaf scatter
    // (`avoid`) and bloom anchor selection (`avoid` in packAnchors).
    const field = Mesh.capsuleFieldFromSegments(sk.segs, 1.05);

    if (hasThorns) {
        // Thorns sparser than before — 1.5 per unit length, only on canes
        // (segments above a threshold radius), and shorter so they don't
        // dominate the silhouette.
        const thorns = F.thornCluster({
            segments: sk.segs.filter((s) => (s.radius ?? 0) >= 0.006 * scaleMul),
            seed: ((opts.seed | 0) * 19 + 7),
            length: 0.014 * scaleMul,
            baseR: 0.0025 * scaleMul,
            density: 1.5,
            color: F.hexToRgb(opts.thornColor || '#5a3820'),
        });
        for (const p of thorns.parts) parts.push(p);
    }

    if (!deferFoliage) {
        attachFoliage(parts, sk.segs, opts, scaleMul, foliageDensity, field, null);
    }

    const fin = F.finalizeAabb(aabb, { min: [-sk.R, 0, -sk.R], max: [sk.R, sk.H, sk.R] });
    return { parts, aabbMin: fin.aabbMin, aabbMax: fin.aabbMax,
             segs: sk.segs, terminals: sk.terminals, H: sk.H, R: sk.R,
             field, scaleMul, foliageDensity };
}

function buildRosebushJuvenile(opts, stageT) {
    return buildRosebushBushy(opts, stageT, 0.30 + 0.30 * stageT, false, 0.6);
}

function buildRosebushMature(opts, stageT) {
    return buildRosebushBushy(opts, stageT, 1, true, 1.0);
}

// Build a single rose bloom. Uses Mesh.flower's full set of layered-rose
// controls:
//   * shapedPetals + petalShape='petal'  — almond/ogive silhouette per petal
//   * petalCup                           — bilateral cupping (each petal is
//                                          a 3D dish, not a flat sheet)
//   * outerTilt / innerTilt              — outer petals nearly flat, inner
//                                          petals near-vertical (rose cup)
//   * layerScaleFalloff / inner-y-lift   — inner ring smaller and stacked
//                                          higher to form the bud center
function buildRoseBloom(opts) {
    const radius = opts.radius ?? 0.075;
    const layers = Math.max(1, Math.min(6, opts.layers ?? 5));
    const petalCount = Math.max(3, Math.min(16, opts.petalCount ?? 12));
    const head = Mesh.flower({
        petalCount,
        petalShape: 'petal',
        shapedPetals: true,
        // Squarer petals than before — length only slightly larger than width
        // so they don't form giant flat slabs.
        petalLength: radius * 0.95,
        petalWidth:  radius * 0.95,
        petalCurl:   opts.petalCurl ?? 0.30,
        petalBend:   opts.petalBend ?? 0.45,
        // Strong cup so each petal has a clear 3D dish shape.
        petalCup:    opts.petalCup  ?? 0.80,
        layers,
        layerTwist:  0.42,
        // Outermost ring: relaxed, nearly flat / slightly recurved.
        outerTilt:   -0.10,
        // Innermost ring: near-vertical, hugging the bud center.
        innerTilt:   -1.30,
        // Inner petals shrink moderately and stack significantly higher.
        layerScaleFalloff: 0.40,
        outerYLift:  0.20,
        innerYLift:  2.20,
        centerRadius: radius * 0.18,
        centerHeight: radius * 0.14,
        centerColor:  F.hexToRgb(opts.centerColor || '#f5d35a'),
    });
    if (head) F.stripVertexColors(head);
    return head;
}

function buildRosebushFlowering(opts, stageT) {
    // Defer foliage so we can place blooms first and pass their volumes as
    // keepOut spheres to the leaf scatter. Without this, leaves pack into
    // the petal cup and poke out through the bloom silhouette.
    const r = buildRosebushBushy(opts, stageT, 1, true, 1.0, /*deferFoliage*/ true);
    const petalColor = F.hexToRgb(opts.petalColor || '#d11f3a');
    const bloomScale = opts.bloomScale ?? 1;
    const radius = 0.075 * bloomScale;
    const layers = opts.bloomLayers ?? 4;
    const petalCount = opts.petalCount ?? 10;

    // Pick bloom anchors via packAnchors: spatially-spaced selection that
    // also stays clear of the cane skeleton. Replaces the stride-sampling
    // heuristic that produced clumps and occasional cane intersections.
    const candidates = [];
    const candidateDirs = [];
    for (const t of r.terminals) {
        if (t.p[1] > r.H * 0.30) {
            candidates.push(t.p);
            candidateDirs.push(t.dir || [0, 1, 0]);
        }
    }
    const maxBlooms = Math.max(4, Math.round(7 + 5 * stageT));
    // Note: no `avoid` field here — bloom anchors sit *on* their cane tips
    // by design, so cane-distance rejection would drop everything. We only
    // want spatial spacing between blooms.
    const idx = candidates.length > 0
        ? Mesh.packAnchors(candidates, {
            minSpacing: radius * 2.6,
            maxCount: maxBlooms,
            seed: ((opts.seed | 0) * 31 + 5) >>> 0,
        })
        : new Int32Array(0);

    const rng = F.mulberry32(((opts.seed | 0) * 31 + 5));
    const bloomKeepOut = [];
    const usableTerms = [];
    for (const i of idx) usableTerms.push({ p: candidates[i], dir: candidateDirs[i] });

    for (const term of usableTerms) {
        const head = buildRoseBloom({
            radius, layers, petalCount,
            petalCurl: opts.petalCurl,
            petalBend: opts.petalBend,
            centerColor: opts.centerColor || '#f5d35a',
        });
        if (!head) continue;
        // Orient the bloom so its local +Y axis aligns with the cane's
        // tangent at the tip. The bloom is built around +Y up; we rotate
        // by the angle between (0,1,0) and the tangent direction `dir`.
        // Real rose blooms droop slightly forward of the cane direction
        // (gravity), so we blend the tangent with -Y to bias downward.
        const dir = term.dir || [0, 1, 0];
        // Bloom face direction = mostly along cane tangent + small upward
        // bias so blooms don't droop face-down. Adding 0.4*Y to dir tilts
        // blooms toward upward-facing without forcing them perfectly up.
        const face = F.vNorm([dir[0], dir[1] + 0.4, dir[2]]);
        // Rotation that takes (0,1,0) onto `face`. axis = up × face;
        // angle = acos(up · face).
        const up = [0, 1, 0];
        const axis = F.vCross(up, face);
        const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
        const dot = up[0]*face[0] + up[1]*face[1] + up[2]*face[2];
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        // Random yaw around the bloom's own face axis (variation across
        // blooms even with the same orientation).
        const yaw = rng() * TAU;
        head.rotate(0, 1, 0, yaw);
        if (axisLen > 1e-6 && angle > 1e-4) {
            head.rotate(axis[0]/axisLen, axis[1]/axisLen, axis[2]/axisLen, angle);
        }
        head.translate(term.p[0], term.p[1], term.p[2]);
        r.parts.push({ mesh: head, color: petalColor, metallic: 0, roughness: 0.7 });
        // Reserve a sphere of bloom volume so foliage scatter doesn't pack
        // leaves into the petal cup. radius * 1.15 leaves a sliver of air
        // between bloom and surrounding leaves rather than a hard gap.
        bloomKeepOut.push({ center: [term.p[0], term.p[1], term.p[2]], radius: radius * 1.15 });
    }
    // Attach foliage now that bloom keep-out spheres exist.
    attachFoliage(r.parts, r.segs, opts, r.scaleMul, r.foliageDensity, r.field, bloomKeepOut);
    r.aabbMax[1] = Math.max(r.aabbMax[1], r.H + radius * 2);
    return r;
}

function buildRosebushFruiting(opts, stageT) {
    const r = buildRosebushBushy(opts, stageT, 1, true, 0.85, /*deferFoliage*/ true);
    const hipColor = F.hexToRgb(opts.hipColor || F.PALETTE.roseHip);
    const hipR = 0.022;
    const candidates = r.terminals
        .filter((t) => t.p[1] > r.H * 0.25)
        .map((t) => t.p);
    // packAnchors keeps hips spaced and clear of the canes — fruitCluster
    // accepts a pre-thinned anchor list, so we just slice down the array.
    const maxHips = Math.max(3, Math.round(candidates.length * (0.55 + 0.4 * stageT)));
    const idx = candidates.length > 0
        ? Mesh.packAnchors(candidates, {
            minSpacing: hipR * 3.0,
            maxCount: maxHips,
            seed: ((opts.seed | 0) ^ 0xF105) >>> 0,
        })
        : new Int32Array(0);
    const usableAnchors = [];
    const hipKeepOut = [];
    for (const i of idx) {
        usableAnchors.push(candidates[i]);
        hipKeepOut.push({ center: candidates[i], radius: hipR * 1.4 });
    }
    const hips = F.fruitCluster({
        anchors: usableAnchors,
        seed: (opts.seed | 0) ^ 0xF105,
        color: hipColor,
        radius: hipR,
        density: 1.0,
        sag: 0.5,
    });
    for (const p of hips.parts) r.parts.push(p);
    attachFoliage(r.parts, r.segs, opts, r.scaleMul, r.foliageDensity, r.field, hipKeepOut);
    return r;
}

function buildRosebushSenescent(opts, stageT) {
    const baseLeafColor = F.hexToRgb(opts.leafColor || '#2c5328');
    const tinted = F.autumnTint(baseLeafColor, 0.6 + 0.3 * stageT, 0.55);
    const r = buildRosebushBushy(
        Object.assign({}, opts, { leafColor: tinted }),
        stageT, 1, true, 0.5 - 0.4 * stageT
    );
    return r;
}

const STAGES = ['seed', 'sprout', 'seedling', 'juvenile', 'mature', 'flowering', 'fruiting', 'senescent'];

const BUILDERS = {
    seed: buildRosebushSeed,
    sprout: buildRosebushSprout,
    seedling: buildRosebushSeedling,
    juvenile: buildRosebushJuvenile,
    mature: buildRosebushMature,
    flowering: buildRosebushFlowering,
    fruiting: buildRosebushFruiting,
    senescent: buildRosebushSenescent,
};

function rosebush(opts) {
    opts = Object.assign({}, opts);
    if (opts.species) opts = FloraSpecies.applySpecies('rosebush', opts.species, opts);
    const stages = opts.stagesOverride || STAGES;
    const r = L.resolveStage(stages, opts.age01 ?? 1);
    const b = BUILDERS[r.stage] || BUILDERS.mature;
    return b(opts, r.stageT);
}

Recipes.rosebush = rosebush;
