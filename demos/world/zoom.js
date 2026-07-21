// =============================================================================
// THE ZOOM CONTROLLER — one continuous climb from the ground to the planet in
// space, with no astronomical travel.
//
// The surface clipmap and the globe are two representations of the same planet
// at two scales. This controller owns the single virtual-altitude scalar Avirt
// that drives the swap between them:
//
//   Avirt < Z_CEIL   the camera flies for real; cam.y == Avirt. Below Z_FADE
//                    the surface is all you see; from Z_FADE up the globe
//                    dissolves in, angular-size-matched to the curving cap.
//   Avirt >= Z_CEIL  the camera is PINNED at Z_CEIL and never climbs higher.
//                    Further up-thrust grows Avirt multiplicatively, which
//                    shrinks the globe (r_g = D_g*R/(R+Avirt)) — "flying out"
//                    is the ball receding within a bounded box, not the camera
//                    crossing hundreds of km into fp32's death zone.
//
// Only cam.y is ever virtualised. cam.x/cam.z stay real, so the sub-camera
// (lat,lon) is exact and descending re-enters the surface at the same ground.
// The globe is oriented every frame so that ground is its near point, which is
// what makes the dissolve a match rather than a swap.
// =============================================================================
import { PLANET } from "/app/planet.js";
import { createGlobe } from "/app/globe.js";

const TAU = Math.PI * 2;

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function smooth(t) { return t * t * (3 - 2 * t); }

// A rotation quaternion [x,y,z,w] that places the sphere point at chart (u,v) —
// the sub-camera ground — at the near point (facing the eye), north roughly up.
// Built from the point's own tangent basis (east, north, out) mapped onto the
// screen basis (right, up, toEye); a pure basis-to-basis rotation, no gimbal.
function orientToGround(u, v, toEye) {
    const lon = (u - 0.5) * TAU;       // FRAG uses uv = (lon/TAU+0.5, 0.5-lat/PI)
    const lat = (0.5 - v) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    const co = Math.cos(lon), so = Math.sin(lon);

    // Local (globe-space) frame at the ground point.
    const out  = [cl * so, sl, cl * co];            // outward normal (= v_dir)
    const east = [co, 0, -so];                      // +lon tangent
    const north = [-sl * so, cl, -sl * co];         // +lat tangent

    // Target world frame: the ground faces the eye.
    let n = toEye.slice();
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / nl, n[1] / nl, n[2] / nl];
    let up = [0, 0, -1];                             // north reference (guarded below)
    // right = up x n, guarded when the eye looks straight down a pole.
    let right = [up[1] * n[2] - up[2] * n[1],
                 up[2] * n[0] - up[0] * n[2],
                 up[0] * n[1] - up[1] * n[0]];
    let rl = Math.hypot(right[0], right[1], right[2]);
    if (rl < 1e-4) { right = [1, 0, 0]; rl = 1; }
    right = [right[0] / rl, right[1] / rl, right[2] / rl];
    up = [n[1] * right[2] - n[2] * right[1],
          n[2] * right[0] - n[0] * right[2],
          n[0] * right[1] - n[1] * right[0]];

    // M[i][k] = right[i]*east[k] + up[i]*north[k] + n[i]*out[k]  (local -> world).
    const m = [
        [right[0]*east[0] + up[0]*north[0] + n[0]*out[0],
         right[0]*east[1] + up[0]*north[1] + n[0]*out[1],
         right[0]*east[2] + up[0]*north[2] + n[0]*out[2]],
        [right[1]*east[0] + up[1]*north[0] + n[1]*out[0],
         right[1]*east[1] + up[1]*north[1] + n[1]*out[1],
         right[1]*east[2] + up[1]*north[2] + n[1]*out[2]],
        [right[2]*east[0] + up[2]*north[0] + n[2]*out[0],
         right[2]*east[1] + up[2]*north[1] + n[2]*out[1],
         right[2]*east[2] + up[2]*north[2] + n[2]*out[2]],
    ];

    // Rotation matrix -> quaternion (standard branchful conversion).
    const tr = m[0][0] + m[1][1] + m[2][2];
    let x, y, z, w;
    if (tr > 0) {
        let s = Math.sqrt(tr + 1) * 2;              // s = 4w
        w = 0.25 * s;
        x = (m[2][1] - m[1][2]) / s;
        y = (m[0][2] - m[2][0]) / s;
        z = (m[1][0] - m[0][1]) / s;
    } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
        let s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;   // s = 4x
        w = (m[2][1] - m[1][2]) / s;
        x = 0.25 * s;
        y = (m[0][1] + m[1][0]) / s;
        z = (m[0][2] + m[2][0]) / s;
    } else if (m[1][1] > m[2][2]) {
        let s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;   // s = 4y
        w = (m[0][2] - m[2][0]) / s;
        x = (m[0][1] + m[1][0]) / s;
        y = 0.25 * s;
        z = (m[1][2] + m[2][1]) / s;
    } else {
        let s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;   // s = 4z
        w = (m[1][0] - m[0][1]) / s;
        x = (m[0][2] + m[2][0]) / s;
        y = (m[1][2] + m[2][1]) / s;
        z = 0.25 * s;
    }
    return [x, y, z, w];
}

/// Build the controller. `terrain` is the clipmap node (hidden once the globe is
/// opaque); `chart` is the resident coarse field for the globe's material.
export function createZoom(scene, terrain, chart, opts = {}) {
    const R = PLANET.radius;
    // The clipmap curves into a convincing planet-from-orbit all the way up, so
    // the dissolve is deliberately LATE and BRIEF: the crisp surface is what you
    // see for the whole climb, and the globe only takes over in the last stretch
    // before the ceiling (where both fill the frame identically, angular-matched,
    // so the hand-off is a soft focus change). Past the ceiling the globe is the
    // only representation and recedes into a ball as you pull back.
    const Z_FADE = opts.fadeStart  ?? 480000;     // m — the dissolve begins
    const Z_CEIL = opts.ceiling    ?? 600000;     // m — cam.y freezes / dissolve ends
    const Z_MAX  = opts.maxVirtual ?? 80000000;   // m — furthest pull-back
    const D_g    = opts.depth      ?? 30000;      // world units — constant globe depth
    const ZOOM_RATE = opts.zoomRate ?? 0.9;       // 1/s at full up-thrust past the ceiling
    const EAST_SPAN = chart.width * chart.cellSize;   // 2*pi*R
    const lnFade = Math.log(Z_FADE), lnCeil = Math.log(Z_CEIL);

    const globe = createGlobe(scene, chart, opts.globe);
    globe.visible = false;

    let Avirt = 0;
    let clipmapOn = true;
    let spaceState = false;
    const onSpaceChange = opts.onSpaceChange || null;

    function setClipmap(on) {
        if (on !== clipmapOn) { terrain.node.visible = on; clipmapOn = on; }
    }

    // The scene atmosphere is near-field air, keyed to the pinned ceiling altitude;
    // once you have pulled back far enough to see the ball it would hang there as a
    // second, larger planet. So it is on up to the ceiling and off beyond it — the
    // switch lands while the globe still fills the frame, so it is never seen. The
    // globe's own fresnel limb is the planet's atmosphere from out here.
    function setSpace(on) {
        if (on !== spaceState) { spaceState = on; if (onSpaceChange) onSpaceChange(on); }
    }

    return {
        globe,
        avirt: () => Avirt,
        inSpace: () => Avirt >= Z_CEIL,

        // Call each frame AFTER flyIntegrate, with the world-space vertical thrust
        // intent (thrust[1] from flyThrustFromKeys).
        update(cam, thrustY, dt) {
            // --- Altitude / ceiling: resolve Avirt and clamp the real camera. ---
            if (Avirt > Z_CEIL) {
                // Pinned and zoomed out: vertical thrust only changes the zoom.
                cam.pos[1] = Z_CEIL; cam.vel[1] = 0;
                Avirt = clamp(Avirt * Math.exp(thrustY * ZOOM_RATE * dt), Z_CEIL, Z_MAX);
            } else if (cam.pos[1] >= Z_CEIL) {
                cam.pos[1] = Z_CEIL;
                if (thrustY > 0) {                 // pushing up at the ceiling: begin pull-back
                    cam.vel[1] = 0;
                    Avirt = clamp(Z_CEIL * Math.exp(thrustY * ZOOM_RATE * dt), Z_CEIL, Z_MAX);
                } else {                           // neutral or descending: hold, let it fall next frame
                    if (cam.vel[1] > 0) cam.vel[1] = 0;
                    Avirt = Z_CEIL;
                }
            } else {
                Avirt = cam.pos[1];                // free flight below the ceiling
            }
            setSpace(Avirt >= Z_CEIL);

            // --- Cross-fade opacity from Avirt on a log scale. ---
            const t = clamp((Math.log(Math.max(Avirt, 1)) - lnFade) / (lnCeil - lnFade), 0, 1);
            const a = smooth(t);

            if (a <= 0.002) {                      // pure surface: no globe, clipmap on
                if (globe.visible) globe.visible = false;
                setClipmap(true);
                return;
            }

            // --- Place, size and orient the globe on the eye. ---
            globe.visible = true;
            globe.setShaderUniform('u_alpha', a);
            const r_g = D_g * R / (R + Avirt);     // angular-size match to the real limb
            globe.scale = r_g;
            // The globe fragment picks its own chart mip and detail band per pixel
            // from the on-screen footprint (fwidth), so there is no LOD to drive
            // from here — it stays crisp at the near point and fades to average as
            // the ball shrinks, without this loop knowing the screen size.

            // Place the globe at the NADIR (straight down toward the planet centre),
            // not along the view forward. Its silhouette is then the same circle as
            // the clipmap's horizon — both centred on the nadir — so they coincide
            // on screen at any look angle and the dissolve is a match, not a ghost
            // floating above the horizon. The planet is below you; look down to see it.
            globe.position = [cam.pos[0], cam.pos[1] - D_g, cam.pos[2]];
            // Sub-camera ground as chart uv (periodic in longitude), oriented so
            // that point is the near (upward-facing) point of the globe.
            let u = (cam.pos[0] / EAST_SPAN); u -= Math.floor(u);
            const v = clamp(cam.pos[2] / (Math.PI * R), 0, 1);
            globe.quaternion = orientToGround(u, v, [0, 1, 0]);

            // Once the globe is opaque it fully hides the clipmap cap behind it.
            setClipmap(a < 0.985);
        },
    };
}
