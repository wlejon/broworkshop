// js/fresnel_shaders.js — Custom WGSL Bronze shader hooks for Fresnel optics, mercury bath & beacon cones.

export const FRESNEL_GLASS_BK = `
module hook;
import mesh;
import scene;

struct Params {
  time: f32,
  lampGlow: f32,
  dispersion: f32,
  pad: f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let uv = scene::screen_uv(v.pixel);
  let disp = out.normal.xy * 0.026 * params.dispersion;
  let r = scene::sample_scene_color(clamp(uv + disp * 1.15, vec2<f32>(0.002), vec2<f32>(0.998))).r;
  let g = scene::sample_scene_color(clamp(uv + disp * 0.85, vec2<f32>(0.002), vec2<f32>(0.998))).g;
  let b = scene::sample_scene_color(clamp(uv + disp * 0.55, vec2<f32>(0.002), vec2<f32>(0.998))).b;
  let crown = vec3<f32>(r, g, b) * vec3<f32>(0.92, 0.99, 0.97);

  let ndotv = clamp(dot(normalize(out.normal), normalize(-v.world_pos)), 0.0, 1.0);
  let fres = 0.06 + 0.94 * pow(1.0 - ndotv, 3.6);
  let ridge = clamp(abs(sin(v.uv.y * 18.0)), 0.0, 1.0);
  let caustic = params.lampGlow * (0.14 + 0.18 * (1.0 - ridge)) * vec3<f32>(1.0, 0.86, 0.54);

  out.base_color = vec3<f32>(0.10, 0.16, 0.16);
  out.roughness = 0.16 + ridge * 0.06;
  out.metallic = 0.04;
  out.emissive = crown * (0.72 - fres * 0.25) + caustic + vec3<f32>(0.16, 0.22, 0.25) * fres * 0.55;
  out.alpha = clamp(0.68 + fres * 0.24, 0.0, 0.94);
  return out;
}
`;

export const MERCURY_BATH_BK = `
module hook;
import mesh;

struct Params {
  time: f32,
  spin: f32,
  pad0: f32,
  pad1: f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let p = v.world_pos.xz;
  let r = length(p);
  let th = atan2(p.y, p.x);
  let e = 0.015;
  let h0 = sin(r * 38.0 - params.time * 4.2) * 0.5 + cos(th * 6.0 - params.spin * 6.0) * 0.5;
  let hx = sin(length(p + vec2<f32>(e, 0.0)) * 38.0 - params.time * 4.2) * 0.5;
  let hz = sin(length(p + vec2<f32>(0.0, e)) * 38.0 - params.time * 4.2) * 0.5;
  out.normal = normalize(s.normal + vec3<f32>((h0 - hx) * 0.26, 0.0, (h0 - hz) * 0.26));
  out.base_color = vec3<f32>(0.42, 0.44, 0.47);
  out.metallic = 0.76;
  out.roughness = 0.34;
  return out;
}
`;

export const BEACON_BEAM_BK = `
module hook;
import mesh;

struct Params {
  beamGain: f32,
  time: f32,
  pad0: f32,
  pad1: f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let axial = smoothstep(0.0, 0.12, v.uv.y) * pow(max(0.0, 1.0 - v.uv.y), 1.65);
  let ndotv = clamp(abs(dot(normalize(out.normal), normalize(-v.world_pos))), 0.0, 1.0);
  let soft_cone = pow(ndotv, 1.75);
  let strength = axial * soft_cone * params.beamGain;
  out.base_color = vec3<f32>(0.02, 0.02, 0.02);
  out.roughness = 0.90;
  out.metallic = 0.0;
  out.emissive = vec3<f32>(1.0, 0.85, 0.52) * strength * 0.42;
  out.alpha = clamp(strength * 0.34, 0.0, 0.42);
  return out;
}
`;

export const LANTERN_PANE_BK = `
module hook;
import mesh;

struct Params {
  wind: f32,
  lampGlow: f32,
  pad0: f32,
  pad1: f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
  var out = s;
  let ndotv = clamp(abs(dot(normalize(out.normal), normalize(-v.world_pos))), 0.0, 1.0);
  let fres = pow(1.0 - ndotv, 3.0);
  let mist = smoothstep(0.0, 0.4, 1.0 - v.uv.y) * (0.04 + 0.06 * params.wind);
  out.base_color = vec3<f32>(0.08, 0.14, 0.16);
  out.roughness = 0.22 + mist;
  out.metallic = 0.02;
  out.emissive = vec3<f32>(0.14, 0.20, 0.24) * fres + vec3<f32>(0.36, 0.32, 0.24) * mist * params.lampGlow * 0.35;
  out.alpha = clamp(0.16 + fres * 0.44 + mist, 0.0, 0.65);
  return out;
}
`;
