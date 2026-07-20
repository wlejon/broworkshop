// =============================================================================
// Horizon — distant terrain as an image, not a mesh
// =============================================================================
//
// Everything past the near mesh is raymarched through a heightfield texture in
// a fragment shader. No geometry, no chunk streaming, no LOD rings.
//
// This is not an optimisation of the mesh path, it is a different mechanism.
// A mesh has to exist before you can see it, so covering what is visible from
// orbit would mean generating and meshing millions of km2 of 30 m terrain. The
// raymarcher draws whatever the heightfield says is there, at whatever
// resolution the screen needs, for the cost of one texture fetch per step.
//
// It also removes the two bugs the mesh path kept producing at this range: LOD
// rings cannot crack if there are no LOD rings, and the depth buffer no longer
// has to span 1 m to 4000 km — the near mesh needs ~15 km and nothing else is
// in the depth buffer at all.
//
// The dome is drawn opaque and owns everything beyond the near field: distant
// land, distant ocean, and sky. The near mesh and the local water plane draw in
// front of it normally.
// =============================================================================

export function createHorizon(scene, opts) {
    const RADIUS = opts.radius || 20000;      // dome radius, inside the far plane
    const START  = opts.start  || 11000;      // where the near mesh stops mattering
    const REACH  = opts.reach  || 2000000;    // how far to march before giving up

    const dome = scene.createMesh({
        data: Mesh.sphere(RADIUS, 32, 16),
        position: [0, 0, 0],
        color: [0, 0, 0],
        // The camera lives inside the dome, so it sees the inward faces — which
        // backface culling would throw away, and the bug would read as "the
        // custom shader never ran". A ray from inside crosses the sphere once
        // going forward, so drawing both sides costs nothing and is simpler than
        // reversing the winding.
        twoSided: true,
        castsShadow: false,
    });

    dome.setShader({
        fragment: `
uniform sampler2D u_height;
uniform vec3  u_camPos;     // true world position (vWorldPos is camera-relative)
uniform vec4  u_field;      // originX, originZ, metresPerTexel, texelsPerSide
uniform vec3  u_sun;
uniform vec2  u_march;      // tStart, tEnd

// Heightfield lookup in world metres. Outside the field we return deep ocean
// rather than clamping the edge texel, which would smear the last coastline
// outwards into an infinite continent.
float heightAt(vec2 xz) {
    float span = u_field.z * u_field.w;
    vec2 uv = (xz - u_field.xy) / span;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return -4000.0;
    return texture(u_height, uv).r;
}

void userFragment(inout vec3 baseColor, inout vec3 normal, inout float metallic,
                  inout float roughness, inout vec3 emissive, inout float alpha) {
    vec3 dir = normalize(vWorldPos);

    float t = u_march.x;
    float tEnd = u_march.y;
    bool hit = false;
    float hy = 0.0;
    vec3  p = vec3(0.0);

    // Steps grow with distance: a texel subtends less screen space the further
    // away it is, so a fixed step would oversample near and undersample far.
    // 160 steps at 2.5% growth reaches ~2000 km from an 11 km start.
    for (int i = 0; i < 160; i++) {
        p = u_camPos + dir * t;
        hy = heightAt(p.xz);
        if (p.y < hy) { hit = true; break; }
        t *= 1.025;
        t += 60.0;
        if (t > tEnd) break;
    }

    vec3 col;
    if (hit) {
        // Refine: the hit is somewhere in the last (large) step, and without
        // this the coastlines come out as visible stair-steps.
        float lo = t / 1.025 - 60.0, hi = t;
        for (int k = 0; k < 12; k++) {
            float m = 0.5 * (lo + hi);
            vec3 q = u_camPos + dir * m;
            if (q.y < heightAt(q.xz)) hi = m; else lo = m;
        }
        t = hi;
        p = u_camPos + dir * t;
        hy = heightAt(p.xz);

        // Gradient normal, sampled a texel out so it matches the data's own scale.
        //
        // RELIEF is the vertical exaggeration. A true normal from a 7.68 km
        // gradient is almost straight up — a 1000 m ridge over 15 km is a 4
        // degree slope — so honest shading renders the far field as a flat
        // silhouette with no landform in it at all. Cartographic relief shading
        // exaggerates for exactly this reason. It affects the normal only; the
        // horizon line still comes from the real heights.
        const float RELIEF = 6.0;
        float e = u_field.z;
        float hx = heightAt(p.xz + vec2(e, 0.0)) - heightAt(p.xz - vec2(e, 0.0));
        float hz = heightAt(p.xz + vec2(0.0, e)) - heightAt(p.xz - vec2(0.0, e));
        vec3 n = normalize(vec3(-hx * RELIEF, 2.0 * e, -hz * RELIEF));

        if (hy <= 0.0) {
            col = vec3(0.02, 0.10, 0.20);                     // ocean
        } else {
            float snow = smoothstep(1400.0, 2400.0, hy);
            float rock = smoothstep(500.0, 1600.0, hy);
            col = mix(vec3(0.20, 0.34, 0.12), vec3(0.42, 0.40, 0.38), rock);
            col = mix(col, vec3(0.90, 0.92, 0.95), snow);
        }
        col *= 0.35 + 0.75 * max(dot(n, normalize(u_sun)), 0.0);

        // Aerial perspective. Without it the far field reads as a flat cutout
        // pasted behind the near terrain rather than as distance.
        //
        // Haze cannot be a function of raw distance: looking down from 300 km
        // the ray is 300 km long but nearly all of it is vacuum, and distance
        // -based haze whites out the entire planet. What matters is how much
        // ATMOSPHERE the ray crossed. Density falls as exp(-y/H), and along a
        // straight ray y is linear in t, so the integral is closed-form and
        // costs two exps:
        //     integral(exp(-y/H) ds) = t * H/dy * (exp(-y1/H) - exp(-y0/H))
        // Horizontal at sea level that reduces to t, as it should.
        const float H = 8000.0;      // atmospheric scale height
        float y0 = u_camPos.y, y1 = hy;
        float dy = y0 - y1;
        float depth = (abs(dy) < 1.0)
            ? t * exp(-max(y1, 0.0) / H)
            : t * (H / dy) * (exp(-max(y1, 0.0) / H) - exp(-max(y0, 0.0) / H));
        float haze = 1.0 - exp(-depth * 0.00002);
        col = mix(col, vec3(0.62, 0.72, 0.84), clamp(haze, 0.0, 1.0) * 0.9);
    } else {
        // Sky. The dome is opaque and replaces the environment out here, so it
        // has to supply this itself.
        float up = clamp(dir.y, 0.0, 1.0);
        col = mix(vec3(0.62, 0.72, 0.84), vec3(0.16, 0.36, 0.68), pow(up, 0.55));
    }

    baseColor = vec3(0.0);
    emissive  = col;      // unshaded: this is already lit
    alpha     = 1.0;
}`,
        uniforms: {
            u_camPos: [0, 0, 0],
            u_field:  [0, 0, 7680, 64],
            u_sun:    [0.4, 0.85, 0.35],
            u_march:  [START, REACH],
        },
    });

    return {
        node: dome,

        // Hand the dome a heightfield. `originX/originZ` are the world position
        // of texel (0,0); `metres` is metres per texel.
        setField(tex, originX, originZ, metres) {
            dome.setShaderTexture('u_height', tex);
            dome.setShaderUniform('u_field', [originX, originZ, metres, tex.width]);
        },

        // The dome is a skybox: it must stay centred on the camera, or flying
        // 20 km in any direction puts you outside it and it vanishes.
        follow(camPos) {
            dome.position = [camPos[0], camPos[1], camPos[2]];
            dome.setShaderUniform('u_camPos', [camPos[0], camPos[1], camPos[2]]);
        },
    };
}
