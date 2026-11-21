// World-space triplanar limestone strata PBR hook + animated karst river water surface.

/** Attach non-voxel triplanar geological shading + analytic rock relief to a Surface Nets chunk or skirt. */
export function attachKarstShader(meshNode) {
    meshNode.setShader({
        module: `
            module hook;
            import scene;
            import mesh;

            fn strata_field(p: vec3<f32>) -> f32 {
                let warp = sin(p.x * 0.042 + p.z * 0.036) * 2.1 + sin(p.z * 0.095 - p.x * 0.072) * 0.9;
                let primary = sin(p.y * 1.55 + warp) * 0.56;
                let fine = sin(p.y * 4.6 + warp * 1.6) * 0.26;
                let streaks = sin(p.x * 0.72 + p.z * 0.61) * sin(p.z * 0.83 - p.x * 0.49) * 0.24;
                return primary + fine + streaks;
            }

            pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
                let wp = v.world_pos + scene::camera.eye_world.xyz;
                let n0 = normalize(v.normal);
                let sky_exp = clamp(v.color.x, 0.0, 1.0);
                let cavity_ao = clamp(v.color.y, 0.0, 1.0);

                let b0 = strata_field(wp);
                let eps = 0.09;
                let gx = strata_field(wp + vec3<f32>(eps, 0.0, 0.0)) - b0;
                let gy = strata_field(wp + vec3<f32>(0.0, eps, 0.0)) - b0;
                let gz = strata_field(wp + vec3<f32>(0.0, 0.0, eps)) - b0;
                let grad = vec3<f32>(gx, gy, gz) / eps;

                // Sedimentary limestone palettes (cream travertine, weathered grey karst, ochre iron vein)
                let strata_t = clamp(0.5 + 0.5 * sin(wp.y * 0.78 + sin(wp.x * 0.035 + wp.z * 0.03) * 2.2), 0.0, 1.0);
                let micro_t = clamp(0.5 + 0.5 * b0, 0.0, 1.0);
                let buff = vec3<f32>(0.45, 0.39, 0.30);
                let slate = vec3<f32>(0.22, 0.23, 0.23);
                let ochre = vec3<f32>(0.44, 0.27, 0.17);
                let cave_dark = vec3<f32>(0.18, 0.18, 0.18);

                var rock = mix(slate, buff, strata_t * 0.75 + micro_t * 0.25);
                let iron_band = smoothstep(0.68, 0.92, sin(wp.y * 0.34 + cos(wp.x * 0.025 - wp.z * 0.02) * 1.4) * 0.5 + 0.5);
                rock = mix(rock, ochre, iron_band * 0.55);

                // Dark damp calcite rock inside caves & shadowed cliff overhangs
                rock = mix(cave_dark, rock, smoothstep(0.05, 0.65, sky_exp) * 0.78 + 0.22);

                // Sunlit alpine grass & cavern skylight moss (strictly suppressed in shaded caves/underhangs)
                let up_slope = smoothstep(0.54, 0.80, n0.y);
                let turf_macro = 0.5 + 0.5 * sin(wp.x * 0.055 + cos(wp.z * 0.048) * 1.6);
                let emerald = vec3<f32>(0.08, 0.20, 0.06);
                let golden = vec3<f32>(0.17, 0.25, 0.08);
                let deep_moss = vec3<f32>(0.09, 0.28, 0.07);
                let veg_base = mix(emerald, golden, turf_macro);
                let skylight_moss = smoothstep(14.0, 7.5, wp.y);
                let veg = mix(veg_base, deep_moss, skylight_moss);

                let above_water = smoothstep(6.2, 8.2, wp.y);
                let lit_top = smoothstep(0.28, 0.72, sky_exp);
                let grass_mask = up_slope * lit_top * above_water;

                // Dark wet shoreline stone near river water plane (y ~ 5.2 m)
                let wet_band = smoothstep(7.4, 5.1, wp.y);
                let wet_tint = mix(vec3<f32>(1.0), vec3<f32>(0.48, 0.50, 0.49), wet_band);

                // Snow dust only on distant high mountain peaks above 95 m
                let snow_mask = smoothstep(95.0, 128.0, wp.y) * smoothstep(0.55, 0.86, n0.y);

                let grad_tan = grad - n0 * dot(grad, n0);
                let bump_n = normalize(n0 - grad_tan * mix(0.11, 0.025, grass_mask));

                var col = mix(rock, veg, grass_mask) * wet_tint;
                col = mix(col, vec3<f32>(0.82, 0.86, 0.90), snow_mask * 0.85);
                col *= mix(0.42, 1.0, cavity_ao);

                var out = s;
                out.base_color = col;
                out.normal = bump_n;
                out.roughness = clamp(mix(mix(0.84, 0.92, grass_mask), 0.26, wet_band * 0.85), 0.18, 0.96);
                return out;
            }
        `,
    });
}

/** Build the animated turquoise canyon & subterranean river surface at `waterY`. */
export function createWaterNode(scene, waterY) {
    const segs = 64, n = segs + 1, extent = 140;
    const pos = new Float32Array(n * n * 3);
    const nrm = new Float32Array(n * n * 3);
    const idx = new Uint32Array(segs * segs * 6);

    for (let iz = 0; iz < n; iz++) {
        const wz = -extent + (iz / segs) * (extent * 2);
        for (let ix = 0; ix < n; ix++) {
            const wx = -extent + (ix / segs) * (extent * 2);
            const v = iz * n + ix;
            pos[v * 3] = wx;
            pos[v * 3 + 1] = waterY;
            pos[v * 3 + 2] = wz;
            nrm[v * 3] = 0;
            nrm[v * 3 + 1] = 1;
            nrm[v * 3 + 2] = 0;
        }
    }
    let k = 0;
    for (let iz = 0; iz < segs; iz++) {
        for (let ix = 0; ix < segs; ix++) {
            const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
            idx[k++] = a; idx[k++] = c; idx[k++] = b;
            idx[k++] = b; idx[k++] = c; idx[k++] = d;
        }
    }

    const node = scene.createMesh({
        positions: pos, normals: nrm, indices: idx,
        color: [0.05, 0.28, 0.30, 1.0],
        roughness: 0.08,
        metallic: 0.06,
        castsShadow: false,
    });
    node.setShader({
        module: `
            module hook;
            import scene;
            import mesh;

            pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
                let wp = v.world_pos + scene::camera.eye_world.xyz;
                let t = scene::camera.wind_params.x;

                let w1x = cos(wp.x * 0.72 + wp.z * 0.45 + t * 1.45) * 0.72;
                let w1z = cos(wp.x * 0.72 + wp.z * 0.45 + t * 1.45) * 0.45;
                let w2x = -sin(wp.z * 1.18 - wp.x * 0.62 - t * 1.15) * 0.62;
                let w2z = sin(wp.z * 1.18 - wp.x * 0.62 - t * 1.15) * 1.18;
                let nx = -(w1x + w2x * 0.7) * 0.032;
                let nz = -(w1z + w2z * 0.7) * 0.032;
                let ripple_n = normalize(vec3<f32>(nx, 1.0, nz));

                let to_eye = normalize(scene::camera.eye_world.xyz - wp);
                let fresnel = pow(1.0 - clamp(dot(ripple_n, to_eye), 0.0, 1.0), 3.0);

                let deep = vec3<f32>(0.025, 0.16, 0.18);
                let turq = vec3<f32>(0.07, 0.35, 0.37);
                let flow = 0.5 + 0.5 * sin(wp.z * 0.08 + wp.x * 0.06 - t * 0.4);

                var out = s;
                out.base_color = mix(mix(deep, turq, 0.35 + 0.28 * flow), vec3<f32>(0.18, 0.46, 0.50), fresnel * 0.7);
                out.normal = ripple_n;
                out.roughness = mix(0.06, 0.14, flow);
                return out;
            }
        `,
    });
    return node;
}
