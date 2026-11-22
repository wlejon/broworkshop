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
  let d1 = length(p - vec2<f32>(0.86, -0.98));
  let d2 = length(p - vec2<f32>(0.34, -1.04));
  let ring1 = sin(d1 * 18.0 - t * 6.5) * exp(-d1 * 1.65) * 0.008;
  let ring2 = sin(d2 * 22.0 - t * 7.2) * exp(-d2 * 2.15) * 0.005;
  let wind_w = sin(p.x * 6.2 + p.y * 4.5 + t * 2.3) * 0.0032 * (0.4 + 0.6 * br)
             + cos(p.x * 9.5 - p.y * 7.8 - t * 2.8) * 0.0022 * (0.4 + 0.6 * br);
  return ring1 + ring2 + wind_w;
}

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
  var out = v;
  let h = wave_h(v.pos.xz, params.time, params.breeze);
  let eps = 0.03;
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

  // Fine capillary ripple normal detail on top of vertex swell
  let gx = cos(p.x * 16.0 + p.y * 11.0 + t * 3.1) * 0.045 + sin(p.x * 27.0 - p.y * 19.0 - t * 3.8) * 0.028;
  let gz = sin(p.x * 13.0 - p.y * 17.0 + t * 2.9) * 0.045 + cos(p.x * 23.0 + p.y * 25.0 + t * 3.4) * 0.028;
  out.normal = normalize(s.normal + vec3<f32>(gx, 0.0, gz));

  // Waterfall plunge aeration foam + radiating concentric froth rings (soft Gaussian, never solid mesh hoops)
  let d1 = length(p - vec2<f32>(0.86, -0.96));
  let d2 = length(p - vec2<f32>(0.34, -1.02));
  let core_foam = exp(-d1 * d1 * 18.0) * 0.72 + exp(-d2 * d2 * 30.0) * 0.56;
  let ring_wave1 = pow(max(0.0, sin(d1 * 15.0 - t * 4.8)), 3.0) * exp(-d1 * 2.6) * 0.45;
  let ring_wave2 = pow(max(0.0, sin(d2 * 18.0 - t * 5.2)), 3.0) * exp(-d2 * 3.4) * 0.34;
  let shore_foam = smoothstep(1.86, 2.02, r) * (0.12 + 0.14 * sin(p.x * 11.0 + p.y * 11.0 + t * 1.4));
  let foam = clamp(core_foam + ring_wave1 + ring_wave2 + shore_foam, 0.0, 0.92);

  // Schlick Fresnel transparency: crystal-clear downward view of koi & pebbles, mirror sheen at grazing angles
  let view_dir = normalize(-v.world_pos);
  let ndotv = clamp(dot(out.normal, view_dir), 0.0, 1.0);
  let fresnel = 0.03 + 0.97 * pow(1.0 - ndotv, 4.2);

  let water_col = mix(vec3<f32>(0.05, 0.25, 0.29), vec3<f32>(0.16, 0.44, 0.48), fresnel);
  out.base_color = mix(water_col, vec3<f32>(0.86, 0.96, 0.99), foam);
  out.roughness = mix(0.025, 0.52, foam);
  out.metallic = 0.02;
  out.emissive = vec3<f32>(0.18, 0.28, 0.30) * foam * 0.35;
  let clear_base = clamp(0.28 + (1.0 - params.clarity) * 0.22, 0.20, 0.56);
  out.alpha = clamp(mix(clear_base + fresnel * 0.58, 0.90, foam), 0.24, 0.94);
  return out;
}
`;

export const WATERFALL_SHADER_BK = `
module hook;
import mesh;

struct Params {
  time: f32,
  flow: f32,
  glow: f32,
  pad: f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
  var out = v;
  let ripple = sin(v.uv.y * 14.0 - params.time * 7.5 + v.uv.x * 6.0) * 0.012;
  out.pos += v.normal * ripple;
  return out;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let t = params.time * (1.35 + 0.4 * params.flow);
  let u = v.uv.x;
  let y = v.uv.y;

  // Multi-scale downward-streaming aerated whitewater threads
  let s1 = sin(u * 22.0 + sin(y * 7.0 - t * 1.4) * 1.5) * 0.5 + 0.5;
  let s2 = sin((y * 10.0 - t * 2.8) + sin(u * 34.0) * 0.9) * 0.5 + 0.5;
  let s3 = cos((y * 20.0 - t * 4.4) - u * 18.0) * 0.5 + 0.5;
  let threads = pow(s1 * 0.5 + s2 * 0.3 + s3 * 0.2, 1.3);

  // Softly feathered lateral & crest borders (no rigid plank edge)
  let edge_fade = smoothstep(0.0, 0.22, u) * smoothstep(1.0, 0.78, u);
  let crest_froth = smoothstep(0.18, 0.0, y) * 0.45;
  let plunge_froth = smoothstep(0.75, 1.0, y) * 0.65;
  let foam = clamp(threads * 0.72 + crest_froth + plunge_froth, 0.0, 1.0);

  out.base_color = mix(vec3<f32>(0.36, 0.74, 0.84), vec3<f32>(0.92, 0.98, 1.0), foam);
  out.roughness = mix(0.08, 0.38, foam);
  out.emissive = out.base_color * (0.20 + foam * 0.36) * params.glow;
  out.alpha = clamp(edge_fade * (0.48 + 0.46 * foam), 0.0, 0.95);
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
  let glint = smoothstep(0.45, 0.98, c) * smoothstep(0.25, 0.85, s.normal.y) * 0.24;
  out.base_color += vec3<f32>(0.22, 0.34, 0.34) * glint;
  out.emissive += vec3<f32>(0.08, 0.14, 0.14) * glint;
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
