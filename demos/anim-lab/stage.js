// stage.js — the environment the character performs on.
//
// Deliberately spare. Motion reads best against a plain, well-lit ground with
// a strong key light: the SHADOW is what sells a walk cycle, because it is the
// only cue that ties a foot to the floor. So the sun casts, the floor
// receives, and everything else stays out of the way.
//
// The one piece of set dressing that earns its place is the marker run — low
// blocks every 1.5 m along +Z. With root motion off the character treadmills
// between them; with it on it walks past them, and the fixed reference turns
// that difference from a claim into a measurement.

export const MARKER_SPACING = 1.5;
export const MARKER_COUNT = 7;

export function buildStage(scene) {
    const handles = { lights: {}, markers: [] };

    // Large enough that the shadow never runs off an edge while orbiting,
    // matte enough that it never competes with the character.
    handles.ground = scene.createMesh({
        mesh: 'plane', halfW: 40, halfD: 40, y: 0,
        color: '#3c4148', metallic: 0.0, roughness: 0.94,
    });

    // A raised pad: a subtle tonal step that frames the figure and gives the
    // contact shadow a lighter surface to land on.
    handles.pad = scene.createMesh({
        mesh: 'cylinder', radius: 2.6, halfHeight: 0.02, segments: 64,
        x: 0, y: 0.02, z: 0,
        color: '#565d66', metallic: 0.0, roughness: 0.86,
    });

    for (let i = 1; i <= MARKER_COUNT; ++i) {
        handles.markers.push(scene.createMesh({
            mesh: 'box', halfW: 0.5, halfH: 0.025, halfD: 0.05,
            x: 0, y: 0.025, z: i * MARKER_SPACING,
            color: i % 2 ? '#78818c' : '#4a515a', metallic: 0.0, roughness: 0.8,
        }));
    }

    // Key light off the character's front-left and fairly low: the shadow
    // falls across the pad and to the side, where you can see limbs move in it.
    const sun = scene.createLight({
        type: 'directional',
        position: [6, 9, 7], direction: [-0.55, -0.78, -0.30],
        color: [1.0, 0.96, 0.90], intensity: 3.6, name: 'sun',
    });
    sun.castsShadow = true;
    sun.cascadeCount = 3;
    sun.cascadeSplitLambda = 0.55;      // tight range: the subject is 2 m tall
    handles.lights.sun = sun;

    // Cool fill from behind-left keeps the unlit side's silhouette.
    handles.lights.fill = scene.createLight({
        type: 'point', position: [-4.5, 3.2, -4.0],
        color: [0.44, 0.60, 0.92], intensity: 26, range: 16, name: 'fill',
    });

    // Warm rim from the far side, low, to catch the trailing edge of a swing.
    // lab.js breathes both point lights with a node-property clip.
    handles.lights.rim = scene.createLight({
        type: 'point', position: [3.2, 1.6, -4.5],
        color: [1.0, 0.72, 0.44], intensity: 16, range: 12, name: 'rim',
    });

    scene.setAmbient?.([0.05, 0.055, 0.07]);
    return handles;
}
