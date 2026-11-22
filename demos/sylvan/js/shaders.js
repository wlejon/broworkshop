// js/shaders.js — Custom brokernel (.bk) shaders for translucent rippling water, cascading whitewater,
// underwater caustics + slope moss, continuous S-wave bending koi, and synchronized wind sway.

export const TERRAIN_CAUSTIC_BK = `
module hook;
import mesh;
import scene;

struct Params {
  time: f32,
  sunBoost: f32,
  mossBoost: f32,
  pad: f32,
}
@binding(4, 0) var params: uniform<Params>;

fn h2(p: vec2<f32>) -> f32 {
  var q = p * 0.137 + vec2<f32>(17.3, 31.7);
  var s = sin(dot(q, vec2<f32>(127.1, 311.7))) * 43758.5453;
  return s - floor(s);
}

fn n2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (vec2<f32>(3.0) - 2.0 * f);
  let a = h2(i);
  let b = h2(i + vec2<f32>(1.0, 0.0));
  let c = h2(i + vec2<f32>(0.0, 1.0));
  let d = h2(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn h2_vec(p: vec2<f32>) -> vec2<f32> {
  let q = vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
}

fn voronoi_ridge(p: vec2<f32>, t: f32) -> f32 {
  let n = floor(p);
  let f = fract(p);
  var d1: f32 = 8.0;
  var d2: f32 = 8.0;
  for (var dy: i32 = -1; dy <= 1; dy += 1) {
    for (var dx: i32 = -1; dx <= 1; dx += 1) {
      let g = vec2<f32>(dx as f32, dy as f32);
      let rnd = h2_vec(n + g);
      let o = 0.5 + 0.42 * sin(t * 1.15 + rnd * 6.2831);
      let r = g + o - f;
      let d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  let edge = sqrt(d2) - sqrt(d1);
  return pow(1.0 - smoothstep(0.0, 0.24, edge), 2.8);
}

fn caustic_pattern(p_in: vec2<f32>, t: f32) -> f32 {
  // Organic domain-warped Voronoi wave webs -> undulating sunlight filaments (zero polygonal cell lines)
  let warp = vec2<f32>(
    sin(p_in.y * 2.8 + t * 1.45) + 0.45 * cos(p_in.x * 3.7 - t * 1.15),
    cos(p_in.x * 2.6 - t * 1.32) + 0.45 * sin(p_in.y * 3.9 + t * 1.25)
  ) * 0.24;
  let p = p_in + warp;
  let rot_p = vec2<f32>(p.x * 0.78 - p.y * 0.62, p.x * 0.62 + p.y * 0.78);
  let c1 = voronoi_ridge(p * 2.35, t);
  let c2 = voronoi_ridge(rot_p * 3.45 + vec2<f32>(3.7, -2.1), -t * 0.85);
  return pow(clamp(c1 * 0.58 + c2 * 0.52, 0.0, 1.0), 1.35);
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let wp = v.world_pos + scene::camera.eye_world.xyz;
  let macro_n = n2(wp.xz * 2.1 + wp.y * 1.4);
  let micro_n = n2(wp.xz * 9.5 + wp.y * 5.2);
  let crack_n = abs(n2(wp.xz * 5.6 + wp.y * 4.1) - 0.5) * 2.0;

  // Slope-driven velvety moss above waterline with organic crevasse edge breakup
  let upward = smoothstep(0.48, 0.82, s.normal.y + (macro_n - 0.5) * 0.28);
  let dry_zone = smoothstep(0.015, 0.14, wp.y);
  let moss_mask = clamp(upward * dry_zone * params.mossBoost * (0.65 + 0.55 * macro_n), 0.0, 1.0);

  let rock_col = s.base_color * (0.42 + 0.24 * macro_n + 0.12 * micro_n) * (0.76 + 0.24 * crack_n);
  let moss_col = mix(vec3<f32>(0.05, 0.13, 0.03), vec3<f32>(0.13, 0.26, 0.06), micro_n);
  var col = mix(rock_col, moss_col, moss_mask);
  var rough = mix(clamp(s.roughness * (0.85 + 0.22 * (1.0 - macro_n)), 0.35, 0.96), 0.94, moss_mask);

  // Dark glistening wet rock streak mask down the cascade channel + pond tide band
  let wet_ch = (exp(-pow((wp.x - 0.80) / 0.14, 2.0)) + exp(-pow((wp.x - 0.54) / 0.11, 2.0)) + exp(-pow((wp.x - 0.26) / 0.10, 2.0)))
             * smoothstep(-0.02, 0.06, wp.y) * smoothstep(0.96, 0.78, wp.y) * smoothstep(-0.88, -1.65, wp.z);
  let wet_band = max((1.0 - smoothstep(-0.02, 0.095, wp.y)) * smoothstep(-0.42, -0.05, wp.y), clamp(wet_ch, 0.0, 1.0));
  col = mix(col, col * vec3<f32>(0.48, 0.53, 0.56), wet_band * 0.75);
  rough = mix(rough, 0.16, wet_band);

  // Submerged basin Beer-Lambert tint + organic cellular Voronoi caustic filaments
  let sub_depth = clamp(-wp.y / 0.35, 0.0, 1.0);
  if (wp.y < 0.005) {
    let absorb = mix(vec3<f32>(1.0), vec3<f32>(0.44, 0.76, 0.72), sub_depth * 0.82);
    col = col * absorb;
    let caust = caustic_pattern(wp.xz, params.time) * params.sunBoost * smoothstep(0.0, 0.08, -wp.y) * smoothstep(-0.1, 0.9, s.normal.y);
    col += vec3<f32>(0.18, 0.30, 0.29) * caust * 0.62;
    out.emissive += vec3<f32>(0.03, 0.07, 0.07) * caust;
  }

  out.base_color = col;
  out.roughness = rough;
  return out;
}
`;

export const WATER_SHADER_BK = `
module hook;
import mesh;
import scene;

struct Params {
  time: f32,
  breeze: f32,
  entry0: vec2<f32>,
  entry1: vec2<f32>,
  entry2: vec2<f32>,
  pad0: vec2<f32>,
}
@binding(4, 0) var params: uniform<Params>;

fn wave_h(p: vec2<f32>, t: f32, br: f32) -> f32 {
  let d1 = length(p - params.entry0);
  let d2 = length(p - params.entry1);
  let d3 = length(p - params.entry2);
  let ring1 = sin(d1 * 21.0 - t * 6.5) * exp(-d1 * 2.5) * 0.0042;
  let ring2 = sin(d2 * 25.0 - t * 7.2) * exp(-d2 * 2.8) * 0.0032;
  let ring3 = sin(d3 * 27.0 - t * 6.9) * exp(-d3 * 3.0) * 0.0026;
  // Five golden-angle rotated directional wave trains for organic fluid movement
  let amp = 0.0014 * (0.35 + 0.65 * br);
  let w1 = sin(dot(p, vec2<f32>( 5.9,  3.1)) + t * 2.1) * amp;
  let w2 = sin(dot(p, vec2<f32>(-4.2,  6.7)) - t * 2.5) * amp * 0.85;
  let w3 = sin(dot(p, vec2<f32>( 8.3, -4.9)) + t * 2.9) * amp * 0.65;
  let w4 = sin(dot(p, vec2<f32>(-9.8, -3.4)) - t * 3.3) * amp * 0.45;
  return ring1 + ring2 + ring3 + w1 + w2 + w3 + w4;
}

fn hash21(p: vec2<f32>) -> f32 {
  var q = fract(p * vec2<f32>(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn smooth_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), u.x),
             mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}

fn capillary_ripples(p: vec2<f32>, t: f32, br: f32) -> vec2<f32> {
  let s = 0.7 + 0.6 * br;
  var gx: f32 = 0.0;
  var gz: f32 = 0.0;
  // Rotated dual-octave organic ripple gradients (zero axis-aligned grid artifacts)
  let p1 = vec2<f32>(p.x * 0.86 - p.y * 0.51, p.x * 0.51 + p.y * 0.86);
  let p2 = vec2<f32>(p.x * -0.42 - p.y * 0.91, p.x * 0.91 - p.y * 0.42);
  let n1 = smooth_noise(p1 * 6.5 + vec2<f32>(t * 0.45, -t * 0.35));
  let n2 = smooth_noise(p2 * 13.0 + vec2<f32>(-t * 0.62, t * 0.51));
  let eps = 0.04;
  let nx1 = smooth_noise((p1 + vec2<f32>(eps, 0.0)) * 6.5 + vec2<f32>(t * 0.45, -t * 0.35));
  let nz1 = smooth_noise((p1 + vec2<f32>(0.0, eps)) * 6.5 + vec2<f32>(t * 0.45, -t * 0.35));
  let nx2 = smooth_noise((p2 + vec2<f32>(eps, 0.0)) * 13.0 + vec2<f32>(-t * 0.62, t * 0.51));
  let nz2 = smooth_noise((p2 + vec2<f32>(0.0, eps)) * 13.0 + vec2<f32>(-t * 0.62, t * 0.51));
  gx = ((n1 - nx1) * 0.09 + (n2 - nx2) * 0.055) * s;
  gz = ((n1 - nz1) * 0.09 + (n2 - nz2) * 0.055) * s;
  return vec2<f32>(gx, gz);
}

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
  var out = v;
  let h = wave_h(v.pos.xz, params.time, params.breeze);
  let eps = 0.025;
  let hx = wave_h(v.pos.xz + vec2<f32>(eps, 0.0), params.time, params.breeze);
  let hz = wave_h(v.pos.xz + vec2<f32>(0.0, eps), params.time, params.breeze);
  out.pos.y += h;
  out.normal = normalize(vec3<f32>((h - hx) / eps, 1.0, (h - hz) / eps));
  out.v0 = vec4<f32>(v.pos.x, h, v.pos.z, length(v.pos.xz));
  return out;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let p = v.v0.xz;
  let t = params.time;

  let cap = capillary_ripples(p, t, params.breeze);
  out.normal = normalize(s.normal + vec3<f32>(cap.x, 0.0, cap.y));

  // Real scene-depth thickness + Snell refraction of submerged koi, leaf shadows, stems & river cobbles
  let uv = scene::screen_uv(v.pixel);
  let surf_d = max(0.05, -scene::view_pos(v.world_pos).z);
  let bg_d = scene::linear_depth(scene::sample_scene_depth(uv));
  let water_depth = max(0.0, bg_d - surf_d);

  let refr_off = out.normal.xz * 0.026 * clamp(water_depth * 3.5, 0.0, 1.0);
  let cand_uv = clamp(uv + refr_off, vec2<f32>(0.002), vec2<f32>(0.998));
  let test_d = scene::linear_depth(scene::sample_scene_depth(cand_uv));
  let safe_uv = select(test_d > surf_d, cand_uv, uv);
  let thickness = max(0.0, select(test_d > surf_d, test_d, bg_d) - surf_d);
  let refr_col = scene::sample_scene_color(safe_uv);

  // Deeper Beer-Lambert optical absorption -> rich emerald/jade depth gradients without flat cyan wash
  let absorb = exp(-thickness * vec3<f32>(2.75, 1.05, 0.78));
  let transmitted = refr_col * absorb;

  // Noise-broken aerated plunge bubbles & delicate rock-lap meniscus foam
  let fn1 = smooth_noise(p * 18.0 + vec2<f32>(t * 1.4, -t * 1.1));
  let d1 = length(p - params.entry0);
  let d2 = length(p - params.entry1);
  let d3 = length(p - params.entry2);
  let plunge = exp(-d1 * d1 * 56.0) * (0.48 + 0.52 * fn1) * 0.85
             + exp(-d2 * d2 * 72.0) * (0.48 + 0.52 * fn1) * 0.72
             + exp(-d3 * d3 * 82.0) * (0.48 + 0.52 * fn1) * 0.65;
  let froth = pow(max(0.0, sin(d1 * 20.0 - t * 4.8)), 5.0) * exp(-d1 * 5.2) * fn1 * 0.25
            + pow(max(0.0, sin(d2 * 22.0 - t * 5.2)), 5.0) * exp(-d2 * 5.8) * fn1 * 0.20;
  let meniscus = (1.0 - smoothstep(0.0, 0.036, water_depth)) * smoothstep(0.003, 0.015, water_depth) * (0.12 + 0.16 * fn1);
  let foam = clamp(plunge + froth + meniscus, 0.0, 0.85);

  let view_dir = normalize(-v.world_pos);
  let ndotv = clamp(dot(out.normal, view_dir), 0.0, 1.0);
  let fresnel = 0.022 + 0.978 * pow(1.0 - ndotv, 4.8);

  let foam_col = vec3<f32>(0.88, 0.95, 0.98);
  out.base_color = mix(vec3<f32>(0.012, 0.048, 0.056), foam_col, foam);
  out.roughness = mix(0.022, 0.44, foam);
  out.metallic = 0.02;
  out.emissive = transmitted * (1.0 - fresnel) * (1.0 - foam) * 0.88;
  out.alpha = smoothstep(0.0, 0.024, water_depth) * 0.985;
  return out;
}
`;

export const WATERFALL_SHADER_BK = `
module hook;
import mesh;
import scene;

struct Params {
  time: f32,
  flow: f32,
  glow: f32,
  pad: f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
  var out = v;
  let arch = smoothstep(0.0, 0.15, v.uv.y);
  let ripple = sin(v.uv.y * 20.0 - params.time * 8.6 + v.uv.x * 10.0) * 0.003 * arch;
  out.pos += v.normal * ripple;
  return out;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let t = params.time * (1.65 + 0.4 * params.flow);
  let u = v.uv.x;
  let y = v.uv.y;

  // Fine rock-hugging glassy threads with curved organic breakup
  let s1 = sin(u * 20.0 + sin(y * 12.0 - t * 2.1) * 1.5) * 0.5 + 0.5;
  let s2 = sin((y * 18.0 - t * 4.2) + sin(u * 30.0) * 1.1) * 0.5 + 0.5;
  let s3 = cos((y * 32.0 - t * 6.0) - u * 18.0) * 0.5 + 0.5;
  let threads = pow(s1 * 0.42 + s2 * 0.36 + s3 * 0.22, 1.9);

  let uv = scene::screen_uv(v.pixel);
  let refr_uv = clamp(uv + vec2<f32>((s1 - 0.5) * 0.014, (s2 - 0.5) * 0.016), vec2<f32>(0.002), vec2<f32>(0.998));
  let bg = scene::sample_scene_color(refr_uv);

  let edge_fade = smoothstep(0.0, 0.26, u) * smoothstep(1.0, 0.74, u);
  let top_fade = smoothstep(0.0, 0.14, y);
  let crest_froth = smoothstep(0.22, 0.06, y) * top_fade * 0.22;
  let plunge_froth = smoothstep(0.76, 1.0, y) * 0.56;
  let foam = clamp(threads * 0.52 + crest_froth + plunge_froth, 0.0, 0.88);

  out.base_color = mix(vec3<f32>(0.04, 0.12, 0.15), vec3<f32>(0.90, 0.96, 0.99), foam * 0.68);
  out.roughness = mix(0.025, 0.34, foam);
  out.emissive = bg * (1.0 - foam * 0.70) * 0.86 + out.base_color * foam * 0.12 * params.glow;
  out.alpha = clamp(edge_fade * top_fade * (0.42 + 0.48 * foam), 0.0, 0.92);
  return out;
}
`;

export const KOI_SHADER_BK = `
module hook;
import mesh;
import scene;

struct Params {
  time: f32,
  swimPhase: f32,
  bendAmp: f32,
  turnCurve: f32,
}
@binding(4, 0) var params: uniform<Params>;

fn lat_disp(s: f32) -> f32 {
  let wave = sin(params.swimPhase - s * 5.1) * (0.004 + params.bendAmp * s * s);
  let curve = params.turnCurve * s * s;
  return wave + curve;
}

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
  var out = v;
  // Head sits near x = 0, caudal tail extends toward x = -0.40
  let s = clamp(-v.pos.x / 0.40, 0.0, 1.0);
  let dz = lat_disp(s);
  let eps = 0.025;
  let slope = (lat_disp(clamp(s + eps, 0.0, 1.0)) - lat_disp(max(0.0, s - eps))) / (2.0 * eps * 0.40);

  // Subtle pectoral fin rowing lift near fin tips (|z| > 0.042)
  let fin_mask = smoothstep(0.038, 0.085, abs(v.pos.z)) * smoothstep(0.45, 0.10, s);
  let fin_y = sin(params.swimPhase * 0.85 + select(v.pos.z > 0.0, 0.0, 0.6)) * 0.012 * fin_mask;

  out.pos.z += dz;
  out.pos.y += fin_y;

  // Rotate local normals around Y by spine curvature tangent slope so highlights glide smoothly
  let c = 1.0 / sqrt(1.0 + slope * slope);
  let sn = -slope * c;
  out.normal = normalize(vec3<f32>(
    v.normal.x * c - v.normal.z * sn,
    v.normal.y,
    v.normal.x * sn + v.normal.z * c
  ));
  return out;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let wp = v.world_pos + scene::camera.eye_world.xyz;
  // Subtle shimmering water caustic glints on koi back under clear pond surface
  let c = sin(wp.x * 16.0 + params.time * 2.2) * cos(wp.z * 16.0 - params.time * 1.9);
  let glint = smoothstep(0.55, 0.98, c) * smoothstep(0.30, 0.85, s.normal.y) * 0.11;
  out.base_color += vec3<f32>(0.16, 0.24, 0.24) * glint;
  out.emissive += vec3<f32>(0.04, 0.08, 0.08) * glint;
  return out;
}
`;

export const PLANT_SWAY_BK = `
module hook;
import mesh;

struct Params {
  time: f32,
  breeze: f32,
  maxH: f32,
  phase: f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
  var out = v;
  let h = clamp(v.pos.y / max(params.maxH, 0.05), 0.0, 1.5);
  let flex = h * h;
  let gust = sin(params.time * 1.65 + params.phase + v.pos.x * 1.8)
           + 0.45 * cos(params.time * 2.85 + params.phase * 1.7 + v.pos.z * 2.4);
  let amp = (0.015 + 0.058 * params.breeze) * flex;
  out.pos.x += gust * amp;
  out.pos.z += sin(params.time * 1.30 + params.phase * 0.9) * amp * 0.55;
  out.pos.y -= amp * amp * 0.35;
  return out;
}
`;

export const TREE_SWAY_BK = `
module hook;
import mesh;
import scene;

struct Params {
  time: f32,
  breeze: f32,
  rootPos: vec3<f32>,
  flutterAmp: f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
  var out = v;
  let wp = v.world_pos + scene::camera.eye_world.xyz;
  let h = max(0.0, wp.y - params.rootPos.y);
  let reach = length(wp.xz - params.rootPos.xz);
  let cant = pow(clamp(h / 2.6, 0.0, 1.2), 1.75) + 0.18 * clamp(reach / 1.8, 0.0, 1.0) * smoothstep(0.15, 0.85, h);
  let w_amp = (0.014 + 0.062 * params.breeze) * cant;
  let gust_x = sin(params.time * 1.15 + wp.z * 0.65) + 0.35 * cos(params.time * 2.1 + wp.x * 0.9);
  let gust_z = cos(params.time * 0.95 + wp.x * 0.55) * 0.62;
  // Local fluttering only on leaf cards (flutterAmp > 0)
  let flut = sin(params.time * 5.8 + wp.x * 11.0 + wp.z * 9.0) * params.flutterAmp * (0.25 + 0.75 * params.breeze) * v.uv.y;
  out.pos.x += gust_x * w_amp + flut;
  out.pos.z += gust_z * w_amp + flut * 0.6;
  out.pos.y += sin(params.time * 4.5 + wp.x * 7.0) * params.flutterAmp * 0.45 * v.uv.y;
  return out;
}
`;
