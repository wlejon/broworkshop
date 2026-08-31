// tools/shader-lab/presets.js

export const PRESETS = {
    raymarch: `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec4 u_mouse;
uniform float u_param1; // Speed
uniform float u_param2; // Shape morph
uniform float u_param3; // Color palette
uniform float u_param4; // Gloss / specular

float sdSphere(vec3 p, float s) {
    return length(p) - s;
}

float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float map(vec3 p) {
    float t = u_time * u_param1;
    vec3 q = p;
    q.xz *= mat2(cos(t * 0.5), -sin(t * 0.5), sin(t * 0.5), cos(t * 0.5));
    q.yz *= mat2(cos(t * 0.3), -sin(t * 0.3), sin(t * 0.3), cos(t * 0.3));

    float d1 = sdTorus(q, vec2(1.2, 0.45));
    float d2 = sdSphere(p - vec3(0.0, sin(t * 1.5) * 0.4, 0.0), 0.7);
    float blend = mix(d1, d2, sin(u_param2) * 0.5 + 0.5);

    float plane = p.y + 1.8;
    return min(blend, plane);
}

vec3 calcNormal(vec3 p) {
    float eps = 0.001;
    vec2 h = vec2(eps, 0.0);
    return normalize(vec3(
        map(p + h.xyy) - map(p - h.xyy),
        map(p + h.yxy) - map(p - h.yxy),
        map(p + h.yyx) - map(p - h.yyx)
    ));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
    vec3 ro = vec3(0.0, 0.5, 4.0);
    vec3 rd = normalize(vec3(uv, -1.5));

    // Mouse orbit
    if (u_mouse.z > 0.0) {
        float angX = (u_mouse.x / u_resolution.x - 0.5) * 4.0;
        float angY = (u_mouse.y / u_resolution.y - 0.5) * 2.0;
        ro.xz *= mat2(cos(angX), -sin(angX), sin(angX), cos(angX));
        ro.yz *= mat2(cos(angY), -sin(angY), sin(angY), cos(angY));
        rd = normalize(vec3(uv, -1.5));
        rd.xz *= mat2(cos(angX), -sin(angX), sin(angX), cos(angX));
        rd.yz *= mat2(cos(angY), -sin(angY), sin(angY), cos(angY));
    }

    float t = 0.0;
    float d = 0.0;
    for (int i = 0; i < 96; i++) {
        vec3 p = ro + rd * t;
        d = map(p);
        if (d < 0.001 || t > 25.0) break;
        t += d;
    }

    vec3 col = vec3(0.05, 0.07, 0.1) - rd.y * 0.05; // Sky gradient

    if (t < 25.0) {
        vec3 p = ro + rd * t;
        vec3 n = calcNormal(p);
        vec3 light = normalize(vec3(0.8, 1.2, 0.9));

        float diff = max(dot(n, light), 0.0);
        float spec = pow(max(dot(reflect(rd, n), light), 0.0), 32.0 * u_param4);
        float ao = clamp(map(p + n * 0.2) / 0.2, 0.0, 1.0);

        vec3 matCol = 0.5 + 0.5 * cos(u_time * 0.2 + u_param3 * 6.28 + vec3(0.0, 2.0, 4.0));
        if (p.y < -1.79) {
            // Checker ground
            vec2 c = floor(p.xz * 1.5);
            float check = mod(c.x + c.y, 2.0);
            matCol = mix(vec3(0.2), vec3(0.6), check);
        }

        col = matCol * (diff * 0.8 + 0.15) * ao + spec * 0.6;
    }

    col = pow(col, vec3(1.0 / 2.2)); // Gamma correction
    fragColor = vec4(col, 1.0);
}`,

    fractal: `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_param1;
uniform float u_param2;
uniform float u_param3;
uniform float u_param4;

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;

    float zoom = pow(0.75, u_time * u_param1 * 0.5);
    vec2 c = uv * zoom * 2.5 + vec2(-0.743643887037158704752191506114774, 0.131825904205311970493132056385139);

    vec2 z = vec2(0.0);
    int maxIter = int(60.0 + u_param2 * 20.0);
    int iter = 0;

    for (int i = 0; i < 180; i++) {
        if (i >= maxIter) break;
        if (dot(z, z) > 4.0) break;
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        iter = i;
    }

    vec3 col = vec3(0.0);
    if (iter < maxIter - 1) {
        float f = float(iter) - log2(max(1.0, log2(dot(z, z))));
        col = 0.5 + 0.5 * sin(f * 0.15 + u_param3 * 6.28 + vec3(0.0, 1.2, 2.4));
    }

    fragColor = vec4(col, 1.0);
}`,

    voronoi: `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_param1;
uniform float u_param2;
uniform float u_param3;
uniform float u_param4;

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
    vec2 p = uv * (4.0 + u_param2);

    vec2 n = floor(p);
    vec2 f = fract(p);

    float m_dist = 8.0;
    vec2 m_point = vec2(0.0);

    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = hash2(n + g);
            o = 0.5 + 0.5 * sin(u_time * u_param1 + 6.2831 * o);
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < m_dist) {
                m_dist = d;
                m_point = o;
            }
        }
    }

    vec3 col = vec3(m_dist * 0.8);
    col += 0.3 * sin(m_point.x * 12.0 + u_param3 * 6.28 + vec3(0.0, 2.0, 4.0));
    fragColor = vec4(col, 1.0);
}`,

    plasma: `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_param1;
uniform float u_param2;
uniform float u_param3;
uniform float u_param4;

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    float t = u_time * u_param1 * 0.8;

    float v1 = sin(uv.x * 10.0 + t);
    float v2 = sin(10.0 * (uv.x * sin(t / 2.0) + uv.y * cos(t / 3.0)) + t);
    float cx = uv.x + 0.5 * sin(t / 5.0);
    float cy = uv.y + 0.5 * cos(t / 3.0);
    float v3 = sin(sqrt(100.0 * (cx * cx + cy * cy) + 1.0) + t);

    float v = v1 + v2 + v3;
    vec3 col = vec3(
        sin(v * 3.14159 + u_param3 * 6.28),
        sin(v * 3.14159 + 2.0),
        sin(v * 3.14159 + 4.0)
    ) * 0.5 + 0.5;

    fragColor = vec4(col, 1.0);
}`,

    fire: `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_param1;
uniform float u_param2;
uniform float u_param3;
uniform float u_param4;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
    vec2 p = uv * 3.0;

    float t = u_time * u_param1 * 2.0;
    vec2 q = vec2(p.x, p.y + t);
    float n = fbm(q * 1.5 + fbm(q * 2.0 - t * 0.5));

    float shape = 1.0 - length(vec2(p.x * 2.0, p.y + 0.6));
    float fire = clamp(shape + n * 0.8, 0.0, 1.0);

    vec3 col = mix(vec3(0.0), vec3(1.0, 0.2, 0.0), fire);
    col = mix(col, vec3(1.0, 0.8, 0.1), pow(fire, 3.0));
    col = mix(col, vec3(1.0, 1.0, 0.9), pow(fire, 6.0));

    fragColor = vec4(col, 1.0);
}`
};
