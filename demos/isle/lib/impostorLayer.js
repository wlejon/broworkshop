// impostorLayer.js — CHUNK 2 of the foliage-LOD system.
//
// Render a set of trees as ONE instanced batch of camera-facing billboard
// quads, each sampling the octahedral impostor atlas baked in CHUNK 1
// (lib/impostor.js). One scene.createInstancedMesh draw replaces a heavy
// branch+leaf triangle mesh: N quads instead of hundreds of thousands of
// leaf-card triangles.
//
// How it works (see impostor.js's file header for the octahedral mapping and
// its exact inverse, which the vertex shader below reproduces):
//   - Instances carry IDENTITY rotation + uniform scale, so the per-instance
//     basis R is pure scale. The billboard geometry is rebuilt in the vertex
//     shader (userVertex) as a SPHERICAL (fully view-facing, pitch included)
//     camera-facing quad, using only uCameraEye, the per-instance translation,
//     and world up.
//   - The per-instance tree->camera direction runs through the octahedral
//     INVERSE to pick one atlas cell; its uv sub-rect is passed to the
//     fragment stage as `flat` varyings so the whole quad samples one cell.
//   - The fragment re-samples uBaseColorTex inside that cell and discards where
//     the baked (transparent-background) alpha is below the cutout threshold.

const QUAD = (() => {
    // Unit quad in XY, corners at (+/-1, +/-1). The positions carry the corner
    // identity that userVertex reads as billboard axes; z is unused. Normals
    // are placeholders (userVertex overwrites the shading normal per-view).
    const positions = new Float32Array([
        -1, -1, 0,
         1, -1, 0,
         1,  1, 0,
        -1,  1, 0,
    ]);
    const normals = new Float32Array([
        0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
    const uvs = new Float32Array([
        0, 0, 1, 0, 1, 1, 0, 1,
    ]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    return { positions, normals, uvs, indices };
})();

// Vertex chunk. Spliced at global scope, so it may declare `flat out` varyings
// and read the instance attributes (aInstRow0..2) and uCameraEye directly.
const VERTEX_CHUNK = `
uniform vec2  u_grid;    // atlas grid (cols, rows)
uniform vec3  u_center;  // tree-local bounds center (billboard pivot, pre-scale)
uniform float u_half;    // billboard half-extent in world units at scale 1
uniform vec2  u_cull;    // (fadeStart, cullEnd) metres from camera: solid inside
                         // fadeStart, dither-dissolves to nothing by cullEnd,
                         // collapsed (zero fragments) beyond. Bounds the drawn
                         // billboard count by radius, so cost no longer grows
                         // with world size or camera altitude — the L0 terrain
                         // forest tint carries the look past the cull radius.

flat out vec2 v_uvMin;
flat out vec2 v_uvMax;
out float v_fade;        // 1 = solid, ->0 across the band (dither in fragment)

void userVertex(inout vec3 pos, inout vec3 normal, inout vec2 uv) {
    // Per-instance world translation (node-local; uInstModel is identity here).
    vec3 instPos = vec3(aInstRow0.w, aInstRow1.w, aInstRow2.w);
    // Approximate tree center in world for the view direction (scale applied
    // to u_center later via R is negligible for a normalized direction).
    vec3 centerWorld = instPos + u_center;

    // Distance cull + fade. 3D distance, so a high camera (all trees far below)
    // collapses the whole set to zero cost and the terrain tint carries it.
    float camDist = length(uCameraEye - centerWorld);
    v_fade = 1.0 - smoothstep(u_cull.x, u_cull.y, camDist);

    // SPHERICAL (fully view-facing) billboard basis: the quad faces the camera
    // on ALL axes including pitch. At steep top-down views (a flyover's main
    // angle) a Y-locked quad foreshortens to a thin streak; a spherical quad
    // keeps its face toward the eye and presents the octahedral top-down cell
    // as a proper crown. Basis: f = view dir (eye->center); right is horizontal
    // (perp to world-up and f); up completes the frame and tilts with pitch.
    vec3 worldUp = vec3(0.0, 1.0, 0.0);
    vec3 toEye = uCameraEye - centerWorld;          // tree -> camera (cell pick)
    vec3 f = normalize(centerWorld - uCameraEye);   // view direction eye->center
    vec3 right = cross(worldUp, f);
    float rl = length(right);
    // Degenerate only when looking straight down the world-up axis; a stable
    // fallback keeps the quad well-formed there.
    right = (rl > 1e-4) ? right / rl : vec3(1.0, 0.0, 0.0);
    vec3 up = cross(f, right);

    // Rebuild the camera-facing quad. pos.xy carry corner signs in [-1,1].
    float qx = pos.x;
    float qy = pos.y;
    vec3 offset = u_center + right * (qx * u_half) + up * (qy * u_half);
    // R * offset + trans (R = scale*I) places it in world.
    pos = offset;

    // Shading normal faces the camera (transformed by R = scale*I downstream).
    normal = normalize(toEye);

    // Octahedral INVERSE (dir = tree->camera). Mirrors impostor.js header.
    vec3 dir = normalize(toEye);
    vec3 ad = abs(dir);
    vec3 d = dir / (ad.x + ad.y + ad.z);   // project onto the octahedron
    float coordX = d.x + d.z;
    float coordY = d.x - d.z;
    float uu = coordX * 0.5 + 0.5;
    float vv = coordY * 0.5 + 0.5;
    float col = floor(clamp(uu, 0.0, 0.999999) * u_grid.x);
    float row = floor(clamp(vv, 0.0, 0.999999) * u_grid.y);
    col = clamp(col, 0.0, u_grid.x - 1.0);
    row = clamp(row, 0.0, u_grid.y - 1.0);
    vec2 cellSz = vec2(1.0 / u_grid.x, 1.0 / u_grid.y);
    v_uvMin = vec2(col, row) * cellSz;
    v_uvMax = v_uvMin + cellSz;

    // Quad-local uv in [0,1] for within-cell sampling.
    uv = vec2(qx * 0.5 + 0.5, qy * 0.5 + 0.5);

    // Beyond the cull radius, collapse the quad to its pivot: a degenerate
    // triangle rasterises to zero fragments, so culled trees cost nothing but
    // the (negligible) vertex shader.
    if (v_fade <= 0.001) pos = u_center;
}
`;

// Fragment chunk. Samples the resolved atlas cell and cuts out transparent
// background. Atlas data is top-down (captureFrame / ImageData row order); the
// GL texture samples v=0 at the first (top) data row, so the within-cell v is
// flipped to keep the tree upright (billboard top -> tree top).
const FRAGMENT_CHUNK = `
flat in vec2 v_uvMin;
flat in vec2 v_uvMax;
in float v_fade;              // distance fade (1 solid, ->0 at the cull edge)

void userFragment(inout vec3 baseColor, inout vec3 normal,
                  inout float metallic, inout float roughness,
                  inout vec3 emissive, inout float alpha) {
    vec2 cellUV = vec2(vUV.x, 1.0 - vUV.y);
    vec2 uv = v_uvMin + cellUV * (v_uvMax - v_uvMin);
    vec4 tex = texture(uBaseColorTex, uv);
    if (tex.a < 0.5) discard;   // alpha cutout against the transparent bake

    // Distance dissolve: as a tree recedes toward the cull radius, a per-pixel
    // screen-door hash thins it out so it melts into the L0 terrain forest tint
    // behind it (same green), instead of popping. No second full-screen layer.
    if (v_fade < 0.999) {
        float hash = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        if (hash > v_fade) discard;
    }
    // The atlas is baked UNLIT (impostor.js), so tex.rgb is ~linear albedo, NOT
    // an already-tonemapped image. Emitting it (baseColor 0, color into
    // emissive) lets the scene's single ACES tonemap map it once — matching the
    // natural saturation/contrast of the source. (The old lit bake was ACES'd
    // in the capture and then ACES'd AGAIN here, reading washed-out/pale.)
    // The card is flat-shaded as a result; per-view form shading would need a
    // baked normal map (a later item), not a re-light of this flat albedo.
    baseColor = vec3(0.0);
    emissive = tex.rgb;
    alpha = 1.0;
}
`;

/**
 * Create ONE instanced billboard layer that renders `transforms` as octahedral
 * impostor cards sampling `impostor` (a CHUNK-1 bake result).
 *
 * Instances are forced to identity rotation (billboards face the camera; a
 * baked tree yaw is meaningless for a view-dependent impostor) while position
 * and uniform scale are preserved.
 *
 * @param {SceneGraph} scene
 * @param {Object} impostor  bakeImpostorAtlas result: { atlasRGBA, width,
 *   height, cols, rows, bounds:{center,radius} }
 * @param {Float32Array|number[]} transforms  9 floats/instance
 *   (px,py,pz, qx,qy,qz,qw, scale, variantIndex)
 * @param {Object} [opts]  { margin=1.03, cullNear=450, cullFar=950 } — margin
 *   must match the bake's margin so the billboard world size equals the ortho
 *   frame the atlas was baked at. cullNear/cullFar are the distance-fade band in
 *   metres: billboards are solid within cullNear, dither-dissolve into the L0
 *   terrain forest tint by cullFar, and cost nothing beyond it.
 * @returns {{ node:SceneNode, quadCount:number, setCull:(near,far)=>void }}
 */
export function createImpostorLayer(scene, impostor, transforms, opts) {
    opts = opts || {};
    const margin = opts.margin != null ? opts.margin : 1.03;
    const cullNear = opts.cullNear != null ? opts.cullNear : 450;
    const cullFar  = opts.cullFar  != null ? opts.cullFar  : 950;

    const src = (transforms instanceof Float32Array) ? transforms : new Float32Array(transforms);
    const count = Math.floor(src.length / 9);

    // Force identity rotation, keep position + uniform scale + variantIndex.
    const xf = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
        const o = i * 9;
        xf[o]     = src[o];      // px
        xf[o + 1] = src[o + 1];  // py
        xf[o + 2] = src[o + 2];  // pz
        xf[o + 3] = 0;           // qx
        xf[o + 4] = 0;           // qy
        xf[o + 5] = 0;           // qz
        xf[o + 6] = 1;           // qw (identity)
        xf[o + 7] = src[o + 7];  // scale
        xf[o + 8] = src[o + 8];  // variantIndex (unused; atlas cell is view-picked)
    }

    // Base-color texture: raw RGBA8, same { width, height, data } shape as
    // createMesh. atlasRGBA is a Uint8ClampedArray; hand the binding a plain
    // Uint8Array view over the same bytes.
    const rgba = impostor.atlasRGBA;
    const data = (rgba instanceof Uint8Array)
        ? rgba
        : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length);

    const node = scene.createInstancedMesh({
        mesh: new Mesh(QUAD),
        instancesFromTransforms: xf,
        texture: { width: impostor.width, height: impostor.height, data },
        color: [1, 1, 1],
        metallic: 0.0,
        roughness: 1.0,
        doubleSided: true,     // billboard winding varies with view
        castsShadow: false,
        receivesShadow: false,
        // NOTE: intentionally NOT using atlasCols/atlasRows — that built-in
        // path picks ONE cell per instance from the packed alpha variant. Here
        // the cell is chosen per-view in the shader, so we bind the whole atlas
        // and remap UVs ourselves.
    });

    const bnd = impostor.bounds || { center: [0, 0, 0], radius: 1 };
    const half = Math.max(bnd.radius, 1e-3) * margin;

    node.setShader({
        vertex: VERTEX_CHUNK,
        fragment: FRAGMENT_CHUNK,
        uniforms: {
            u_grid: [impostor.cols, impostor.rows],
            u_center: [bnd.center[0], bnd.center[1], bnd.center[2]],
            u_half: half,
            u_cull: [cullNear, cullFar],
        },
    });

    return {
        node,
        quadCount: count,
        setCull(near, far) { node.setShaderUniform('u_cull', [near, far]); },
    };
}
