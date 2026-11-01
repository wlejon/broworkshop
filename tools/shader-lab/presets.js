// tools/shader-lab/presets.js — brokernel image kernels. Each is a grid
// kernel `main_image` run once per canvas pixel (kernel-runtime.js):
//
//   out         the canvas's pixels, RGBA in 0..1, row 0 at the top
//   resolution  the canvas's size in pixels
//   time        seconds since start (paused with the clock)
//   mouse       (x, y, clickX, clickY), y up from the bottom; z > 0 while held
//   param       the four sliders under the viewport (x, y, z, w)

const SIGNATURE = `@kernel @grid(2)
fn main_image(g: grid<2>, out: write_store<vec4<f32>, 2>,
              resolution: vec2<f32>, time: f32, mouse: vec4<f32>, param: vec4<f32>) {
    // The pixel's centre, y up from the bottom.
    let frag = vec2<f32>(g.x() as f32 + 0.5, resolution.y - (g.y() as f32) - 0.5);`;

export const PRESETS = {
    raymarch: `// SDF raymarching: a torus morphing into a sphere over a checker floor.
// param.x speed, param.y shape morph, param.z palette, param.w gloss.

fn rot(v: vec2<f32>, a: f32) -> vec2<f32> {
    let c = cos(a);
    let s = sin(a);
    return vec2<f32>(v.x * c - v.y * s, v.x * s + v.y * c);
}

// Turn v about y by ax, then about x by ay.
fn orbit(v: vec3<f32>, ax: f32, ay: f32) -> vec3<f32> {
    let xz = rot(vec2<f32>(v.x, v.z), ax);
    let yz = rot(vec2<f32>(v.y, xz.y), ay);
    return vec3<f32>(xz.x, yz.x, yz.y);
}

fn sd_torus(p: vec3<f32>, t: vec2<f32>) -> f32 {
    let q = vec2<f32>(length(vec2<f32>(p.x, p.z)) - t.x, p.y);
    return length(q) - t.y;
}

fn map(p: vec3<f32>, t: f32, morph: f32) -> f32 {
    let q = orbit(p, t * 0.5, t * 0.3);
    let d1 = sd_torus(q, vec2<f32>(1.2, 0.45));
    let d2 = length(p - vec3<f32>(0.0, sin(t * 1.5) * 0.4, 0.0)) - 0.7;
    let blend = mix(d1, d2, sin(morph) * 0.5 + 0.5);
    return min(blend, p.y + 1.8);
}

fn calc_normal(p: vec3<f32>, t: f32, morph: f32) -> vec3<f32> {
    let e = 0.001;
    return normalize(vec3<f32>(
        map(p + vec3<f32>(e, 0.0, 0.0), t, morph) - map(p - vec3<f32>(e, 0.0, 0.0), t, morph),
        map(p + vec3<f32>(0.0, e, 0.0), t, morph) - map(p - vec3<f32>(0.0, e, 0.0), t, morph),
        map(p + vec3<f32>(0.0, 0.0, e), t, morph) - map(p - vec3<f32>(0.0, 0.0, e), t, morph)));
}

${SIGNATURE}
    let uv = (frag - resolution * 0.5) / resolution.y;
    let t = time * param.x;
    var ro = vec3<f32>(0.0, 0.5, 4.0);
    var rd = normalize(vec3<f32>(uv.x, uv.y, -1.5));
    if mouse.z > 0.0 {
        let ax = (mouse.x / resolution.x - 0.5) * 4.0;
        let ay = (mouse.y / resolution.y - 0.5) * 2.0;
        ro = orbit(ro, ax, ay);
        rd = orbit(rd, ax, ay);
    }

    var dist: f32 = 0.0;
    for i in 0..96 {
        let d = map(ro + rd * dist, t, param.y);
        if d < 0.001 || dist > 25.0 {
            break;
        }
        dist += d;
    }

    var col = vec3<f32>(0.05, 0.07, 0.1) - rd.y * 0.05;   // sky
    if dist < 25.0 {
        let p = ro + rd * dist;
        let n = calc_normal(p, t, param.y);
        let light = normalize(vec3<f32>(0.8, 1.2, 0.9));
        let diff = max(dot(n, light), 0.0);
        let refl = rd - n * (2.0 * dot(n, rd));
        let spec = pow(max(dot(refl, light), 0.0), 32.0 * param.w);
        let ao = clamp(map(p + n * 0.2, t, param.y) / 0.2, 0.0, 1.0);
        var mat = cos(vec3<f32>(0.0, 2.0, 4.0) + (time * 0.2 + param.z * 6.28)) * 0.5 + 0.5;
        if p.y < -1.79 {
            // Checker ground.
            let c = floor(vec2<f32>(p.x, p.z) * 1.5);
            let s = c.x + c.y;
            let check = s - floor(s * 0.5) * 2.0;
            mat = mix(vec3<f32>(0.2, 0.2, 0.2), vec3<f32>(0.6, 0.6, 0.6), vec3<f32>(check, check, check));
        }
        col = mat * ((diff * 0.8 + 0.15) * ao) + spec * 0.6;
    }
    col = pow(max(col, vec3<f32>(0.0, 0.0, 0.0)), vec3<f32>(1.0 / 2.2, 1.0 / 2.2, 1.0 / 2.2));   // gamma
    out[g.x(), g.y()] = vec4<f32>(col.x, col.y, col.z, 1.0);
}
`,

    fractal: `// A Mandelbrot zoom into Seahorse Valley.
// param.x zoom speed, param.y iterations, param.z palette.

${SIGNATURE}
    let uv = (frag - resolution * 0.5) / resolution.y;
    let zoom = pow(0.75, time * param.x * 0.5);
    let c = uv * (zoom * 2.5) + vec2<f32>(-0.743643887, 0.131825904);

    var z = vec2<f32>(0.0, 0.0);
    let max_iter = (60.0 + param.y * 20.0) as i32;
    var iter: i32 = 0;
    for i in 0..180 {
        if i >= max_iter || dot(z, z) > 4.0 {
            break;
        }
        z = vec2<f32>(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        iter = i;
    }

    var col = vec3<f32>(0.0, 0.0, 0.0);
    if iter < max_iter - 1 {
        let f = (iter as f32) - log2(max(1.0, log2(dot(z, z))));
        col = sin(vec3<f32>(0.0, 1.2, 2.4) + (f * 0.15 + param.z * 6.28)) * 0.5 + 0.5;
    }
    out[g.x(), g.y()] = vec4<f32>(col.x, col.y, col.z, 1.0);
}
`,

    voronoi: `// Voronoi cells whose seeds drift.
// param.x drift speed, param.y density, param.z palette.

fn hash2(p: vec2<f32>) -> vec2<f32> {
    let q = vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)));
    return fract(sin(q) * 43758.5453);
}

${SIGNATURE}
    let uv = (frag - resolution * 0.5) / resolution.y;
    let p = uv * (4.0 + param.y);
    let n = floor(p);
    let f = p - n;

    var m_dist: f32 = 8.0;
    var m_point = vec2<f32>(0.0, 0.0);
    for jj in 0..3 {
        for ii in 0..3 {
            let cell = vec2<f32>((ii - 1) as f32, (jj - 1) as f32);
            let o = sin(hash2(n + cell) * 6.2831 + time * param.x) * 0.5 + 0.5;
            let r = cell + o - f;
            let d = dot(r, r);
            if d < m_dist {
                m_dist = d;
                m_point = o;
            }
        }
    }

    let col = sin(vec3<f32>(0.0, 2.0, 4.0) + (m_point.x * 12.0 + param.z * 6.28)) * 0.3 + m_dist * 0.8;
    out[g.x(), g.y()] = vec4<f32>(col.x, col.y, col.z, 1.0);
}
`,

    plasma: `// Interfering sine waves.
// param.x speed, param.z palette.

${SIGNATURE}
    let uv = frag / resolution;
    let t = time * param.x * 0.8;
    let v1 = sin(uv.x * 10.0 + t);
    let v2 = sin(10.0 * (uv.x * sin(t / 2.0) + uv.y * cos(t / 3.0)) + t);
    let cx = uv.x + 0.5 * sin(t / 5.0);
    let cy = uv.y + 0.5 * cos(t / 3.0);
    let v3 = sin(sqrt(100.0 * (cx * cx + cy * cy) + 1.0) + t);
    let v = (v1 + v2 + v3) * 3.14159;
    let col = vec3<f32>(sin(v + param.z * 6.28), sin(v + 2.0), sin(v + 4.0)) * 0.5 + 0.5;
    out[g.x(), g.y()] = vec4<f32>(col.x, col.y, col.z, 1.0);
}
`,

    fire: `// A flame: value-noise FBm warped by itself, scrolling up.
// param.x speed.

fn hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn value_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = p - i;
    let a = hash(i);
    let b = hash(i + vec2<f32>(1.0, 0.0));
    let c = hash(i + vec2<f32>(0.0, 1.0));
    let d = hash(i + vec2<f32>(1.0, 1.0));
    let u = f * f * (vec2<f32>(3.0, 3.0) - f * 2.0);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

fn fbm(p0: vec2<f32>) -> f32 {
    var v: f32 = 0.0;
    var a: f32 = 0.5;
    var p = p0;
    for i in 0..4 {
        v += a * value_noise(p);
        p = p * 2.0;
        a *= 0.5;
    }
    return v;
}

${SIGNATURE}
    let uv = (frag - resolution * 0.5) / resolution.y;
    let p = uv * 3.0;
    let t = time * param.x * 2.0;
    let q = vec2<f32>(p.x, p.y + t);
    let n = fbm(q * 1.5 + fbm(q * 2.0 - t * 0.5));

    let shape = 1.0 - length(vec2<f32>(p.x * 2.0, p.y + 0.6));
    let fire = clamp(shape + n * 0.8, 0.0, 1.0);
    let f3 = pow(fire, 3.0);
    let f6 = pow(fire, 6.0);
    var col = vec3<f32>(1.0, 0.2, 0.0) * fire;
    col = mix(col, vec3<f32>(1.0, 0.8, 0.1), vec3<f32>(f3, f3, f3));
    col = mix(col, vec3<f32>(1.0, 1.0, 0.9), vec3<f32>(f6, f6, f6));
    out[g.x(), g.y()] = vec4<f32>(col.x, col.y, col.z, 1.0);
}
`,
};
