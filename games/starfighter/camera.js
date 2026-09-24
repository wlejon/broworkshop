// camera.js — 3D vector projection, line primitives, shake / jitter / flash
// and the pseudo-3D starfield. One camera per canvas (createCamera), no
// module state.
//
// Coordinate system: +X right, +Y up, +Z forward (into the screen). The
// camera sits at the origin looking toward +Z; the craft "advances" by the
// world scrolling toward -Z.

/** Near-plane clip in world units; behind this nothing is drawn. */
export const NEAR_Z = 0.5;

// ~60° vertical FOV: projected_y = H/2 - (y/z) * focal, focal = (H/2)/tan(vfov/2).
const VFOV = 60 * Math.PI / 180;

const noise = (amp) => (amp ? (Math.random() * 2 - 1) * amp : 0);

export function createCamera(W = 1024, H = 768) {
    let w = W, h = H, focal = 0, cx = 0, cy = 0;
    // Parallax offset in world units: the view slides slightly with the
    // yoke to sell "looking around"; projectHud ignores it.
    let camX = 0, camY = 0;
    let shakeAmp = 0, shakeDecay = 250;     // px of per-vertex noise, decay ms
    let jitter = 0, jitterLeft = 0;         // px of line-endpoint noise, ms left
    let flashColor = null, flashT = 0, flashDur = 0;

    function setViewport(nw, nh) {
        w = nw; h = nh;
        focal = (nh / 2) / Math.tan(VFOV / 2);
        cx = nw / 2; cy = nh / 2;
    }
    setViewport(W, H);

    /** Camera-space point -> screen px; visible=false behind the near plane. */
    function project(x, y, z) {
        if (z < NEAR_Z) return { x: 0, y: 0, z, visible: false };
        const inv = focal / z;
        return {
            x: cx + (x - camX) * inv + noise(shakeAmp),
            y: cy - (y - camY) * inv + noise(shakeAmp),
            z,
            visible: true,
        };
    }

    /** Cockpit-attached projection: no parallax, no shake. */
    function projectHud(x, y, z) {
        if (z < NEAR_Z) return { x: 0, y: 0, z, visible: false };
        const inv = focal / z;
        return { x: cx + x * inv, y: cy - y * inv, z, visible: true };
    }

    /** 1 at the near plane fading to 0 at `far`. */
    function depthFade(z, far = 400) {
        if (z < NEAR_Z || z > far) return 0;
        return 1 - z / far;
    }

    /** A segment between camera-space points, clipped at the near plane. */
    function line(ctx, ax, ay, az, bx, by, bz, color, alpha) {
        if (az < NEAR_Z && bz < NEAR_Z) return false;
        if (az < NEAR_Z) {
            const t = (NEAR_Z - az) / (bz - az);
            ax += (bx - ax) * t; ay += (by - ay) * t; az = NEAR_Z;
        } else if (bz < NEAR_Z) {
            const t = (NEAR_Z - bz) / (az - bz);
            bx += (ax - bx) * t; by += (ay - by) * t; bz = NEAR_Z;
        }
        const pa = project(ax, ay, az);
        const pb = project(bx, by, bz);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha != null ? alpha : 1;
        ctx.beginPath();
        ctx.moveTo(pa.x + noise(jitter), pa.y + noise(jitter));
        ctx.lineTo(pb.x + noise(jitter), pb.y + noise(jitter));
        ctx.stroke();
        ctx.globalAlpha = 1;
        return true;
    }

    /** Edge list [[i, j], ...] over `verts`, offset by (ox, oy, oz). */
    function edges(ctx, verts, edgeList, color, alpha, ox = 0, oy = 0, oz = 0) {
        for (const [i, j] of edgeList) {
            const a = verts[i], b = verts[j];
            line(ctx, a.x + ox, a.y + oy, a.z + oz, b.x + ox, b.y + oy, b.z + oz, color, alpha);
        }
    }

    return {
        NEAR_Z,
        setViewport,
        width: () => w,
        height: () => h,
        focal: () => focal,
        project,
        projectHud,
        depthFade,
        line,
        edges,
        setParallax(x, y) { camX = x || 0; camY = y || 0; },

        shake(amount, decayMs = 250) {
            shakeAmp = Math.max(shakeAmp, amount);
            shakeDecay = decayMs;
        },
        /** Line-endpoint noise for `ms` (damage feedback). */
        jitter(px, ms) { jitter = px; jitterLeft = ms; },
        flash(color, ms) { flashColor = color; flashT = 0; flashDur = ms; },
        get shaking() { return shakeAmp; },
        get jittering() { return jitter; },
        get flashing() { return flashColor; },

        update(dt) {
            if (shakeAmp > 0) {
                shakeAmp -= shakeAmp * Math.min(1, dt / shakeDecay);
                if (shakeAmp < 0.1) shakeAmp = 0;
            }
            if (jitterLeft > 0) {
                jitterLeft -= dt;
                if (jitterLeft <= 0) jitter = 0;
            }
            if (flashColor) {
                flashT += dt;
                if (flashT >= flashDur) flashColor = null;
            }
        },

        drawFlash(ctx) {
            if (!flashColor) return;
            ctx.fillStyle = flashColor;
            ctx.globalAlpha = (1 - flashT / flashDur) * 0.35;
            ctx.fillRect(0, 0, w, h);
            ctx.globalAlpha = 1;
        },

        reset() {
            camX = camY = 0;
            shakeAmp = jitter = jitterLeft = 0;
            flashColor = null;
        },
    };
}

// ── Starfield ─────────────────────────────────────────────────────────────
// 3D points in front of the camera, scrolled toward it; a star that passes
// the camera respawns far away.

const STAR_COUNT = 140;
const STAR_FAR = 400;

export function createStarfield(rand = Math.random) {
    const stars = [];
    const place = (s, z) => {
        s.x = (rand() * 2 - 1) * 300;
        s.y = (rand() * 2 - 1) * 220;
        s.z = z;
        return s;
    };
    for (let i = 0; i < STAR_COUNT; i++) stars.push(place({}, NEAR_Z + rand() * STAR_FAR));

    return {
        stars,
        advance(dz) {
            for (const s of stars) {
                s.z -= dz;
                if (s.z < NEAR_Z + 1) place(s, STAR_FAR);
            }
        },
        draw(ctx, cam) {
            ctx.fillStyle = "#ffffff";
            for (const s of stars) {
                const p = cam.project(s.x, s.y, s.z);
                if (!p.visible) continue;
                const fade = cam.depthFade(s.z, STAR_FAR);
                if (fade < 0.05) continue;
                ctx.globalAlpha = fade;
                const sz = 1 + (1 - s.z / STAR_FAR) * 1.5;
                ctx.fillRect(p.x | 0, p.y | 0, sz, sz);
            }
            ctx.globalAlpha = 1;
        },
    };
}
