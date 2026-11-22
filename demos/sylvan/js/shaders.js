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

fn caustic_pattern(p: vec2<f32>, t: f32) -> f32 {
  let a = sin(p.x * 4.7 + t * 1.45 + cos(p.y * 3.9 - t * 1.15));
  let b = sin(p.y * 5.3 - t * 1.30 + sin(p.x * 4.1 + t * 0.95));
  let w = 1.0 - abs(a + b) * 0.5;
  return pow(clamp(w, 0.0, 1.0), 4.0);
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

  // Dark glistening wet tide band where water laps rock & bank shoreline
  let wet_band = (1.0 - smoothstep(-0.02, 0.095, wp.y)) * smoothstep(-0.42, -0.05, wp.y);
  col = mix(col, col * vec3<f32>(0.52, 0.56, 0.58), wet_band * 0.72);
  rough = mix(rough, 0.18, wet_band);

  // Submerged basin Beer-Lambert tint + animated sunlight caustic filaments
  let sub_depth = clamp(-wp.y / 0.35, 0.0, 1.0);
  if (wp.y < 0.005) {
    let absorb = mix(vec3<f32>(1.0), vec3<f32>(0.42, 0.78, 0.74), sub_depth * 0.85);
    col = col * absorb;
    let c1 = caustic_pattern(wp.xz, params.time);
    let c2 = caustic_pattern(wp.xz * 1.43 + vec2<f32>(2.4, -1.7), -params.time * 0.82);
    let caust = (c1 + c2 * 0.7) * params.sunBoost * smoothstep(0.0, 0.08, -wp.y) * smoothstep(-0.1, 0.9, s.normal.y);
    col += vec3<f32>(0.28, 0.44, 0.42) * caust;
    out.emissive += vec3<f32>(0.08, 0.18, 0.18) * caust;
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
  clarity: f32,
  pad: f32,
}
@binding(4, 0) var params: uniform<Params>;

fn wave_h(p: vec2<f32>, t: f32, br: f32) -> f32 {
  let d1 = length(p - vec2<f32>(0.80, -1.00));
  let d2 = length(p - vec2<f32>(0.54, -1.04));
  let d3 = length(p - vec2<f32>(0.26, -1.06));
  let ring1 = sin(d1 * 22.0 - t * 6.8) * exp(-d1 * 2.2) * 0.0055;
  let ring2 = sin(d2 * 26.0 - t * 7.4) * exp(-d2 * 2.6) * 0.0040;
  let ring3 = sin(d3 * 28.0 - t * 7.0) * exp(-d3 * 2.8) * 0.0032;
  let wind_w = sin(p.x * 6.8 + p.y * 4.8 + t * 2.2) * 0.0026 * (0.35 + 0.65 * br)
             + cos(p.x * 11.0 - p.y * 8.2 - t * 2.7) * 0.0018 * (0.35 + 0.65 * br);
  return ring1 + ring2 + ring3 + wind_w;
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
  let r = v.v0.w;
  let t = params.time;

  // Dual-scale capillary wind & splash ripple normal perturbation
  let gx = cos(p.x * 19.0 + p.y * 13.0 + t * 3.0) * 0.036 + sin(p.x * 31.0 - p.y * 23.0 - t * 3.8) * 0.022;
  let gz = sin(p.x * 15.0 - p.y * 19.0 + t * 2.8) * 0.036 + cos(p.x * 27.0 + p.y * 29.0 + t * 3.3) * 0.022;
  out.normal = normalize(s.normal + vec3<f32>(gx, 0.0, gz));

  // Real scene-depth thickness + Snell refraction of submerged koi, stems & river cobbles
  let uv = scene::screen_uv(v.pixel);
  let surf_d = max(0.05, -scene::view_pos(v.world_pos).z);
  let bg_d = scene::linear_depth(scene::sample_scene_depth(uv));
  let water_depth = max(0.0, bg_d - surf_d);

  let refr_off = out.normal.xz * 0.024 * clamp(water_depth * 3.8, 0.0, 1.0);
  let cand_uv = clamp(uv + refr_off, vec2<f32>(0.002), vec2<f32>(0.998));
  let test_d = scene::linear_depth(scene::sample_scene_depth(cand_uv));
  let safe_uv = select(test_d > surf_d, cand_uv, uv);
  let thickness = max(0.0, select(test_d > surf_d, test_d, bg_d) - surf_d);
  let refr_col = scene::sample_scene_color(safe_uv);

  // Beer-Lambert optical absorption (red attenuates faster than deep pond jade/blue-teal)
  let absorb = exp(-thickness * vec3<f32>(2.1, 0.72, 0.56));
  let transmitted = refr_col * absorb;

  // Delicate small plunge-bubble foam right at the 3 rocky trickle entry points
  let d1 = length(p - vec2<f32>(0.80, -1.00));
  let d2 = length(p - vec2<f32>(0.54, -1.04));
  let d3 = length(p - vec2<f32>(0.26, -1.06));
  let core_foam = exp(-d1 * d1 * 62.0) * 0.65 + exp(-d2 * d2 * 78.0) * 0.52 + exp(-d3 * d3 * 88.0) * 0.45;
  let ripple_froth = pow(max(0.0, sin(d1 * 22.0 - t * 5.2)), 5.0) * exp(-d1 * 5.0) * 0.24
                   + pow(max(0.0, sin(d2 * 24.0 - t * 5.8)), 5.0) * exp(-d2 * 5.6) * 0.18;
  let meniscus = (1.0 - smoothstep(0.0, 0.032, water_depth)) * smoothstep(0.002, 0.012, water_depth) * 0.18;
  let foam = clamp(core_foam + ripple_froth + meniscus, 0.0, 0.85);

  let view_dir = normalize(-v.world_pos);
  let ndotv = clamp(dot(out.normal, view_dir), 0.0, 1.0);
  let fresnel = 0.025 + 0.975 * pow(1.0 - ndotv, 4.6);

  let foam_col = vec3<f32>(0.88, 0.96, 0.99);
  out.base_color = mix(vec3<f32>(0.015, 0.055, 0.065), foam_col, foam);
  out.roughness = mix(0.028, 0.48, foam);
  out.metallic = 0.02;
  out.emissive = transmitted * (1.0 - fresnel) * (1.0 - foam) * 0.95;
  // Feather seamlessly along curved shoreline depth -> zero sharp rim seam
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
  let ripple = sin(v.uv.y * 18.0 - params.time * 8.2 + v.uv.x * 8.0) * 0.004;
  out.pos += v.normal * ripple;
  return out;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let t = params.time * (1.55 + 0.4 * params.flow);
  let u = v.uv.x;
  let y = v.uv.y;

  // Fine garden-scale glassy threads clinging to rock with natural refractive bend
  let s1 = sin(u * 18.0 + sin(y * 11.0 - t * 1.8) * 1.4) * 0.5 + 0.5;
  let s2 = sin((y * 16.0 - t * 3.6) + sin(u * 28.0) * 0.9) * 0.5 + 0.5;
  let s3 = cos((y * 28.0 - t * 5.2) - u * 16.0) * 0.5 + 0.5;
  let threads = pow(s1 * 0.45 + s2 * 0.35 + s3 * 0.20, 1.8);

  let uv = scene::screen_uv(v.pixel);
  let refr_uv = clamp(uv + vec2<f32>((s1 - 0.5) * 0.010, (s2 - 0.5) * 0.012), vec2<f32>(0.002), vec2<f32>(0.998));
  let bg = scene::sample_scene_color(refr_uv);

  let edge_fade = smoothstep(0.0, 0.24, u) * smoothstep(1.0, 0.76, u);
  let crest_froth = smoothstep(0.14, 0.0, y) * 0.34;
  let plunge_froth = smoothstep(0.80, 1.0, y) * 0.48;
  let foam = clamp(threads * 0.48 + crest_froth + plunge_froth, 0.0, 0.85);

  out.base_color = mix(vec3<f32>(0.05, 0.14, 0.17), vec3<f32>(0.90, 0.97, 1.0), foam * 0.72);
  out.roughness = mix(0.03, 0.36, foam);
  out.emissive = bg * (1.0 - foam * 0.68) * 0.82 + out.base_color * foam * 0.16 * params.glow;
  out.alpha = clamp(edge_fade * (0.44 + 0.44 * foam), 0.0, 0.92);
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
