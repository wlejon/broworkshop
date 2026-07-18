// scene_setup.js — the stage.
//
// Every choice here exists to make one post-processing effect legible when a
// human flips its switch in the HUD:
//
//   SSAO   needs contact and crevice geometry — so the courtyard is built from
//          boxes that meet at right angles, with a stepped plinth and a stack
//          of crates whose seams are pure occlusion with no lighting cue.
//   Bloom  needs HDR-bright pixels — hence the emissive strips, lamp orbs and
//          the neon sign, all pushed well past luminance 1.0.
//   DoF    and fog need depth SEPARATION, not just depth: the courtyard opens
//          onto a receding avenue of pillars marching to z = -60, plus a near
//          foreground crate at z = +9, so focus distance has something to
//          sweep through.
//   SSR /  reflection probes (chunk 2) need a large flat floor slab and a flat
//   probes back wall with the metal props in front of them.
//   LUT /  tonemap need saturated, varied albedo, so the roughness sweep is
//          tinted rather than gray.
//
// Nothing here touches the post stack — hud.js owns all of that.

// Small helper: the courtyard is built from a lot of near-identical boxes.
function box(scene, o) {
    return scene.createMesh(Object.assign({ mesh: 'box' }, o));
}

const STONE = '#4a4f57';
const STONE_DARK = '#33373d';
const PLASTER = '#6d6659';

export function buildScene(scene) {
    const handles = {
        spheres: [],
        emissives: [],
        metals: [],
        lights: {},
        depthMarkers: [],
    };

    // --- Ground ---------------------------------------------------------------
    // One big rough plane, plus a polished slab in the middle of the courtyard.
    // The slab is deliberately smooth and only mildly metallic: it is the
    // surface chunk 2's SSR pass will mirror the props in.
    scene.createMesh({
        mesh: 'plane',
        halfW: 80, halfD: 80,
        y: 0,
        color: '#3a3d42',
        metallic: 0.0,
        roughness: 0.92,
    });

    handles.floorSlab = box(scene, {
        halfW: 9, halfH: 0.05, halfD: 7,
        x: 0, y: 0.05, z: -2,
        color: '#20242a',
        metallic: 0.25,
        roughness: 0.12,
    });

    // --- Courtyard shell ------------------------------------------------------
    // Two side walls and a back wall with a gap in the middle. The gap is the
    // mouth of the avenue: it frames the receding geometry so fog and DoF have
    // a clean silhouette to grade against.
    const WALL_H = 5;

    // Back wall, split around a 6-unit opening at the center.
    for (const sx of [-1, 1]) {
        box(scene, {
            halfW: 4.5, halfH: WALL_H, halfD: 0.4,
            x: sx * 7.5, y: WALL_H, z: -12,
            color: PLASTER, metallic: 0, roughness: 0.85,
        });
    }
    // Lintel spanning the opening.
    box(scene, {
        halfW: 3.2, halfH: 0.7, halfD: 0.4,
        x: 0, y: WALL_H * 2 - 0.7, z: -12,
        color: PLASTER, metallic: 0, roughness: 0.85,
    });

    // Side walls. These are the flat vertical surfaces a reflection probe
    // (chunk 2) will capture, so they stay unbroken.
    for (const sx of [-1, 1]) {
        box(scene, {
            halfW: 0.4, halfH: WALL_H, halfD: 7,
            x: sx * 12, y: WALL_H, z: -5,
            color: PLASTER, metallic: 0, roughness: 0.85,
        });
    }

    // --- Occlusion furniture --------------------------------------------------
    // Stepped plinths in the wall corners. Steps are the classic SSAO tell:
    // each inner angle darkens, and the flat tops stay clean.
    for (const sx of [-1, 1]) {
        for (let s = 0; s < 3; ++s) {
            const h = 0.35 * (3 - s);
            box(scene, {
                halfW: 1.6 - s * 0.45, halfH: h, halfD: 1.6 - s * 0.45,
                x: sx * 9.5, y: h, z: -9.5,
                color: STONE, metallic: 0, roughness: 0.8,
            });
        }
    }

    // A crate stack: tight seams between boxes, plus an overhang. Nothing lights
    // these corners differently, so with SSAO off they read as one flat mass.
    const crateSpots = [
        [-6.5, 0.6, 1.5, 0.6], [-5.3, 0.6, 1.5, 0.6], [-6.5, 1.8, 1.5, 0.6],
        [-5.9, 0.6, 2.7, 0.6], [-6.1, 3.0, 1.5, 0.6],
        [7.0, 0.75, 0.5, 0.75], [7.0, 2.25, 0.5, 0.75], [8.5, 0.55, 1.8, 0.55],
    ];
    for (const [x, y, z, h] of crateSpots) {
        box(scene, {
            halfW: h, halfH: h, halfD: h,
            x, y, z,
            rx: 0, ry: (x * 13 + z * 7) % 20 - 10,
            color: STONE_DARK, metallic: 0, roughness: 0.75,
        });
    }

    // Pillars framing the courtyard proper.
    for (const sx of [-1, 1]) {
        for (const pz of [-10.5, -4.5]) {
            scene.createMesh({
                mesh: 'cylinder',
                radius: 0.55, halfHeight: 3.2, segments: 24,
                x: sx * 10.0, y: 3.2, z: pz,
                color: STONE, metallic: 0, roughness: 0.7,
            });
            // Capital — an overhanging slab, which is where SSAO's contact
            // darkening under a lip is most obvious.
            box(scene, {
                halfW: 0.85, halfH: 0.22, halfD: 0.85,
                x: sx * 10.0, y: 6.6, z: pz,
                color: STONE, metallic: 0, roughness: 0.7,
            });
        }
    }

    // --- PBR roughness sweep --------------------------------------------------
    // Nine dielectric spheres, roughness 0.03 -> 0.95, front and center on the
    // polished slab. Chunk 2's reflection probe should visibly change the left
    // (smooth) end of this row and leave the right (rough) end alone.
    const N = 9;
    const spacing = 1.5;
    const x0 = -((N - 1) * spacing) / 2;
    for (let i = 0; i < N; ++i) {
        const t = i / (N - 1);
        handles.spheres.push(scene.createMesh({
            mesh: 'sphere',
            radius: 0.62, segments: 40, rings: 28,
            x: x0 + i * spacing, y: 0.75, z: 0.5,
            color: '#c8503f',
            metallic: 0.0,
            roughness: 0.03 + t * 0.92,
        }));
    }

    // --- Metal props ----------------------------------------------------------
    // Deliberately parked on clear floor with the back wall behind them: this
    // is the SSR / probe test bench.
    handles.metals.push(scene.createMesh({
        mesh: 'sphere',
        radius: 1.5, segments: 48, rings: 32,
        x: -4.5, y: 1.6, z: -6.5,
        color: '#e8e8ec', metallic: 1.0, roughness: 0.04,     // chrome
    }));
    handles.metals.push(scene.createMesh({
        mesh: 'torus',
        majorRadius: 1.35, minorRadius: 0.4,
        majorSegments: 48, minorSegments: 20,
        x: 4.5, y: 1.7, z: -6.5, rx: 78,
        color: '#e0b45c', metallic: 1.0, roughness: 0.16,     // brushed gold
    }));
    handles.metals.push(scene.createMesh({
        mesh: 'capsule',
        radius: 0.6, halfHeight: 1.0, segments: 32, rings: 16,
        x: 0, y: 1.7, z: -8.5,
        color: '#8fa4c0', metallic: 1.0, roughness: 0.30,     // dull steel
    }));

    // --- Emissives ------------------------------------------------------------
    // Bloom needs HDR headroom, so these run 3x-8x. They also sit at very
    // different depths, which makes the DoF bokeh obvious: an out-of-focus
    // emissive is the most readable defocus cue there is.
    function neon(o) {
        const n = scene.createMesh(Object.assign({ mesh: 'box', color: '#ffffff',
            metallic: 0, roughness: 1.0 }, o));
        handles.emissives.push(n);
        return n;
    }
    neon({ halfW: 3.0, halfH: 0.07, halfD: 0.07, x: 0, y: 8.6, z: -11.6,
        emissive: 6.0, emissiveColor: [0.35, 0.85, 1.0] });
    neon({ halfW: 0.07, halfH: 1.6, halfD: 0.07, x: -11.5, y: 3.4, z: -8.0,
        emissive: 5.0, emissiveColor: [1.0, 0.32, 0.5] });
    neon({ halfW: 0.07, halfH: 1.6, halfD: 0.07, x: 11.5, y: 3.4, z: -8.0,
        emissive: 5.0, emissiveColor: [1.0, 0.32, 0.5] });

    // Glowing orbs on the lamp posts + one far down the avenue.
    for (const [x, y, z, e] of [[-8, 3.2, 3.0, 4.0], [8, 3.2, 3.0, 4.0],
                                [0, 2.0, -24.0, 8.0], [0, 2.0, -46.0, 8.0]]) {
        const orb = scene.createMesh({
            mesh: 'sphere', radius: 0.28, segments: 20, rings: 14,
            x, y, z,
            color: '#ffffff', metallic: 0, roughness: 1.0,
            emissive: e, emissiveColor: [1.0, 0.78, 0.42],
        });
        handles.emissives.push(orb);
    }

    // Near foreground crate — the thing that goes soft first when focus
    // distance is pushed out.
    handles.nearProp = box(scene, {
        halfW: 0.9, halfH: 0.9, halfD: 0.9,
        x: 5.2, y: 0.9, z: 7.5, ry: 22,
        color: '#7a5a3c', metallic: 0, roughness: 0.8,
    });

    // --- Receding avenue ------------------------------------------------------
    // Pillar pairs plus a low kerb marching out to z = -60. Exponential-squared
    // fog with height falloff separates these into distinct depth bands; linear
    // fog flattens them; no fog leaves them crisply legible. That contrast is
    // the whole point of the fog section in the HUD.
    for (let i = 0; i < 8; ++i) {
        const z = -17 - i * 6;
        const dim = 1 - i * 0.05;
        for (const sx of [-1, 1]) {
            scene.createMesh({
                mesh: 'cylinder',
                radius: 0.45, halfHeight: 2.6, segments: 16,
                x: sx * 3.2, y: 2.6, z,
                color: STONE, metallic: 0, roughness: 0.75,
            });
            box(scene, {
                halfW: 0.65, halfH: 0.18, halfD: 0.65,
                x: sx * 3.2, y: 5.4, z,
                color: STONE, metallic: 0, roughness: 0.75,
            });
        }
        // A crossbeam every other bay, so the avenue reads as a colonnade.
        if (i % 2 === 0) {
            box(scene, {
                halfW: 3.6, halfH: 0.2, halfD: 0.25,
                x: 0, y: 5.7, z,
                color: STONE_DARK, metallic: 0, roughness: 0.8,
            });
        }
        handles.depthMarkers.push({ z, dim });
    }

    // Distance markers straight down the center line: small bright cubes at a
    // known z, so "how far does my fog reach" is answerable by eye.
    for (let i = 0; i < 10; ++i) {
        const z = -5 - i * 6;
        handles.depthMarkers.push(box(scene, {
            halfW: 0.22, halfH: 0.22, halfD: 0.22,
            x: 0, y: 0.24, z,
            color: '#d8d2c4', metallic: 0, roughness: 0.6,
        }));
    }

    // --- Lights ---------------------------------------------------------------
    // Shadow atlas budget is 16 tiles: 4 directional cascades + 1 spot tile
    // here, leaving plenty of headroom for chunk 2/3 to add more.
    const sun = scene.createLight({
        type: 'directional',
        position: [-8, 14, 6],
        direction: [-0.42, -1.0, -0.34],
        color: [1.0, 0.95, 0.86],
        intensity: 3.4,
        name: 'sun',
    });
    sun.castsShadow = true;
    sun.cascadeCount = 4;
    sun.cascadeSplitLambda = 0.75;   // outdoor-ish: log splits reach the avenue
    handles.lights.sun = sun;

    // Warm practicals matching the lamp orbs.
    handles.lights.lampL = scene.createLight({
        type: 'point',
        position: [-8, 3.2, 3.0],
        color: [1.0, 0.72, 0.40],
        intensity: 17, range: 12,
        name: 'lampL',
    });
    handles.lights.lampR = scene.createLight({
        type: 'point',
        position: [8, 3.2, 3.0],
        color: [1.0, 0.72, 0.40],
        intensity: 17, range: 12,
        name: 'lampR',
    });

    // Cool rim from behind the opening — gives the metal props a specular edge
    // for SSR/probes to work against.
    handles.lights.rim = scene.createLight({
        type: 'point',
        position: [0, 4.0, -14.0],
        color: [0.35, 0.62, 1.0],
        intensity: 24, range: 20,
        name: 'rim',
    });

    // A hard spot straight down onto the sphere row. This is the light whose
    // shadow makes SSAO's contribution separable by eye — hard shadow vs
    // soft ambient occlusion are different signals.
    const spot = scene.createLight({
        type: 'spot',
        position: [0, 9.5, -1.0],
        direction: [0, -1, 0.12],
        color: [1.0, 0.94, 0.82],
        intensity: 42, range: 22,
        innerAngle: 0.30, outerAngle: 0.62,
        name: 'keySpot',
    });
    spot.castsShadow = true;
    handles.lights.spot = spot;

    // Subtle sway so foliage-style vertex wind is wired even though nothing in
    // this scene bends yet — chunk 3 can hang shader work off it.
    scene.setWind({ direction: [1, 0, 0.2], strength: 0.0, frequency: 1.2 });

    // CHUNK 2: decals (scene.createDecal) belong here — the polished floor slab
    // `handles.floorSlab` and the plaster side walls are the intended receiver
    // surfaces, and both are opaque so decals will land on them.
    // CHUNK 2: reflection probes (scene.createReflectionProbe) — a box roughly
    // { size: [26, 12, 22], y: 5, z: -4 } covers the courtyard interior and
    // contains the bounds centers of handles.metals + the smooth end of
    // handles.spheres.
    // CHUNK 3: LOD / visibilityRange on the avenue geometry (handles.depthMarkers
    // and the colonnade above) is the natural demo, since it already spans
    // z = -17 .. -60. Custom vertex/fragment shaders can attach to
    // handles.floorSlab, and scene.asTexture() can feed a monitor mesh mounted
    // on the back wall.

    return handles;
}
