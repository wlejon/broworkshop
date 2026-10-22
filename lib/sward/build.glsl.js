// build.glsl.js — the sward module's vertex half (SWARD_BUILD): a blade
// built from its cell and slot alone. See index.js.
//
//   - a blade is a leaf, a dead leaf or a flowering culm, by its hash and
//     the share of each where it grows (tufts, flowering, dead), and has an
//     age: young leaves stand up from the crown's middle, older and longer
//     ones arch out from it and droop under their own weight, a few lie
//     lodged, the dead ones lie at the foot;
//   - its shape is its tilt from upright along its length (a lean at the
//     root, its rest curvature, and the bend of the wind and the movers,
//     added as tilt vectors so nothing passes through a flip), integrated up
//     the blade; it tapers to a fine point and twists a little about its
//     length;
//   - the wind is the scene's field: the steady lean, each blade's own sway,
//     and the travelling gust bands of sceneWindGustAt, each blade answering
//     by its own flex;
//   - near the eye it is lit as its own folded face (surface.glsl.js), the
//     sun glowing through it from behind; with distance more and more as the
//     sward it stands in, so a meadow reads as one surface;
//   - its colour runs from lush to sun-dried with the field's dry mask, paler
//     at its sheath, dark at the root and lifted where a gust bends it;
//   - in a far ring a live leaf is a fan card of a few leaves (surface.glsl.js
//     cuts it), which may carry a herb's bloom (the engine's).
//
// info, which surface.glsl.js reads back: x the kind (0 a leaf, 1 a
// flowering culm, 2 a dead leaf, 3 a far fan of leaves) plus under 0.5 its
// dither; y a culm's head (0 a loose panicle .. 15 a dense spike) plus the
// share of its card it truly covers (a fan's: a leaf's width in the card's);
// z its ripeness; w its stem's width over its head's in 1/1000s, plus the
// share of its card the stem truly covers.

export const BUILD = /* glsl */ `
#ifdef SWARD_BUILD
// No blade bends further than this from upright (its tip some 40 degrees
// under level); a bend toward it saturates rather than stops.
const float SW_TILT_MAX = 2.3;
// The unit direction of a blade tilted t (rad from upright, toward t's way
// across the ground).
vec3 swDir(vec2 t) {
    float m = length(t);
    float s = m > 1e-4 ? sin(m) / m : 1.0;
    return vec3(t.x * s, cos(m), t.y * s);
}
// A blade's tilt at s (0 root .. 1 tip) along it: its lean at the root r,
// the wind's and the movers' bend w (a leaf's stiff foot gives least, a culm
// bends evenly along), its rest curvature c (arching more toward the tip).
// All are tilt vectors, so they add without a flip whatever their ways, and
// the sum saturates at SW_TILT_MAX.
vec2 swTilt(vec2 r, vec2 w, vec2 c, float s, bool culm) {
    float ws = culm ? s : s * (0.6 + 0.4 * s);
    vec2 t = r + w * ws + c * pow(s, 1.6);
    float m = length(t);
    return m > 1e-4 ? t * (SW_TILT_MAX * tanh(m / SW_TILT_MAX) / m) : t;
}

bool swardBuild(SwardCell s, int j, SwardRing ring, vec3 v, inout SwardVertex b) {
    ivec2 c = s.cell;
    vec4 h = s.h, f = s.f;
    vec4 hb = vec4(grassHash(c, j * 4), grassHash(c, j * 4 + 1), grassHash(c, j * 4 + 2), grassHash(c, j * 4 + 3));
    vec3 gn = s.ground;
    vec2 root = s.root, tc = s.own.xy;
    float bunch = s.own.z, clump = s.own.w, d = s.d;
    vec3 eye = camera.eyeWorld.xyz;
    float H = grassSwardHeight();
    int vpb = ring.verts;
    vec4 he = vec4(grassHash(c, 2048 + j * 4), grassHash(c, 2049 + j * 4), grassHash(c, 2050 + j * 4),
                   grassHash(c, 2051 + j * 4));

    // What the blade is. Culms are the same share of the blades in every
    // ring (SW_CULMS a square metre at a share of 1 among the near ring's
    // SW_NEAR_BLADES), so their share of the cover holds as the rings hand
    // over: a far ring's culm stands for as many culms as its leaves do
    // leaves. Dead leaves are a share of the leaves.
    float lush = 1.0 - clamp(f.b, 0.0, 1.0);
    float tall = smoothstep(0.35, 0.8, sceneWindNoise(root * 0.045 + 3.0) * 0.5 + 0.5);
    vec2 kinds = swKinds(root, lush, tall);
    float pc = kinds.x * SW_CULMS / SW_NEAR_BLADES;
    bool culm = he.x < pc;
    bool dead = !culm && he.x > 1.0 - kinds.y;
    float age = hb.z;

    // Its foot: tillers rise from a small crown, the young ones from its
    // middle (a tuft near the eye; further off blades over the cell).
    bool tufted = ring.tufted;
    float rr = sqrt(hb.x);
    float ra = hb.y * 6.2831853;
    vec2 out2 = vec2(cos(ra), sin(ra));
    float crown = tufted ? mix(0.45, 0.3, bunch) : 1.0;
    vec2 xz = root + out2 * (rr * mix(0.55, 1.0, age) * crown * ring.spread);
    float y0 = grassInField(xz) ? grassFieldAt(xz).r : f.r;
    // The way it leans: out from the crown (and from its tussock's middle,
    // a fountain), a little astray; at random over a far cell.
    float hr = fract(hb.x * 13.73 + hb.z * 5.17);
    vec2 away = out2 * rr + (root - tc) * (bunch * 3.0 / SW_TUSSOCK);
    float az = tufted && dot(away, away) > 1e-8 ? atan(away.y, away.x) + (he.z - 0.5) * 1.1 : hr * 6.2831853;
    vec2 lean = vec2(cos(az), sin(az));

    // Its length: the tuft's height (clumps, the field, tall lush patches)
    // times its own. Leaves grow longer with age, culms stand over them,
    // dead leaves are the short old ones at the foot.
    float ht = H * mix(0.5, 1.4, clump * clump) * (0.85 + 0.3 * h.z) *
               mix(1.0, mix(0.8, 1.7, tall * lush), SW_VARIETY) * f.a;
    float len = culm ? ht * mix(1.35, 1.75, he.y)
              : dead ? ht * mix(0.25, 0.7, he.y)
                     : ht * mix(0.45, 1.3, age) * (0.85 + 0.3 * he.y);

    // Its rest posture: a lean at the root and a curvature along it. Young
    // leaves stand, older ones lean out and arch, the long ones drooping
    // past level under their own weight (outer leaves of a tussock most);
    // a few lie lodged; the dead lie at the foot; a culm stands, its head
    // nodding a little.
    float r0, droop;
    if (culm) {
        r0 = 0.04 + 0.12 * he.z;
        droop = 0.1 + 0.25 * he.w;
    } else if (dead) {
        r0 = 0.75 + 0.55 * he.z;
        droop = 0.5 + 0.7 * he.w;
    } else {
        // Sun-dried leaves have lost their turgor: they splay and flop.
        float wilt = 1.0 - lush;
        r0 = mix(0.1, 0.75, age) + 0.3 * wilt * age;
        droop = (0.25 + 1.5 * age * sqrt(age)) * clamp(len / 0.4, 0.3, 2.0) * mix(0.75, 1.25, he.w) * (1.0 + 0.5 * bunch * rr) *
                (1.0 + 0.8 * wilt);
        if (he.w < 0.04) {
            r0 = 1.1 + 0.3 * he.y;
            droop *= 0.4;
        }
    }

    // The wind: a lean downwind, the travelling gusts, and each blade's own
    // sway along its lean, each by the blade's flex (a long leaf gives most,
    // a culm's head catches it, a dead leaf hardly stirs); then the movers'
    // push, and their trample as a lean from the root the way it was pushed.
    float gu = sceneWindGustAt(root);
    float calm = clamp(camera.windField.z / SW_REFERENCE_SPEED, 0.0, 2.0);
    vec2 wdir = camera.windField.xy;
    float flex = culm ? 1.2 : dead ? 0.35 : mix(0.7, 1.3, he.w) * clamp(0.55 + 0.6 * len / max(H, 1e-3), 0.6, 1.5);
    float flut = sin(6.2831853 * sceneWindCycles((2.2 + hb.y * 2.5) / 6.2831853) + dot(xz, wdir) * 0.9 + hr * 9.0) *
                 (0.06 * calm + 0.12 * gu);
    vec2 Wb = (wdir * swWindBend(gu) + lean * flut) * (SW_WIND * flex);
    float trample;
    vec2 lie;
    vec2 pb = grassInfluence(xz, trample, lie);
    trample = min(trample, 1.0);
    // A culm's stem is stiffer than a leaf and carries its head high, so a
    // push swings it less and it is seldom laid flat.
    Wb += pb * (culm ? 0.7 : 1.6);
    float flattened = trample * mix(0.75, 1.0, hb.z) * (culm ? 0.5 : 1.0);
    vec2 R = lean * r0 + lie * (flattened * 1.3 / max(length(lie), 0.25));
    vec2 C = lean * droop;

    // Along it: a culm's card spends its first row on the bare stem and the
    // rest on its head.
    int seg = max((vpb - 1) / 2, 1);
    float k1 = 1.0 / float(seg);
    float y = v.y;
    if (culm) y = y <= k1 + 1e-4 ? y / k1 * SW_CULM_STEM : SW_CULM_STEM + (y - k1) / (1.0 - k1) * (1.0 - SW_CULM_STEM);
    // Its point there: its direction integrated from the root (Simpson's
    // rule over the tilt at the root, halfway and here).
    vec2 T0 = swTilt(R, Wb, C, 0.0, culm);
    vec2 Th = swTilt(R, Wb, C, 0.5 * y, culm);
    vec2 Ty = swTilt(R, Wb, C, y, culm);
    vec3 tang = swDir(Ty);
    vec3 P = (swDir(T0) + 4.0 * swDir(Th) + tang) * (y * len / 6.0);
    P.y = max(P.y, 0.01 * len * y);   // a lodged leaf lies on the ground, not through it
    vec3 base = vec3(xz.x - eye.x, y0 - eye.y, xz.y - eye.z);

    // Its face: square to its lean (a leaf arches over its flat), turned a
    // little astray and twisting along its length. A culm turns to the eye.
    float twist = (he.z - 0.5) * 1.6;
    float yaw = az + 1.5707963 + (fract(he.y * 7.7) - 0.5) * 0.5 + twist * y;
    vec3 side = vec3(cos(yaw), 0.0, sin(yaw));
    if (culm) {
        vec3 s2 = cross(tang, -(base + P));
        if (dot(s2, s2) > 1e-8 * dot(base + P, base + P)) side = s2;
    }
    side -= tang * dot(side, tang);
    float sl = dot(side, side);
    side = sl > 1e-8 ? side * inversesqrt(sl) : normalize(vec3(-tang.y, tang.x, 0.0) + vec3(0.0, 0.0, 1e-3));

    // Its width: the ring's (growing with distance, widened by its thinning)
    // and never under about two thirds of a pixel (a thinner blade only
    // flickers in and out of the samples). A leaf tapers to a fine point
    // over its length; one only a pixel or so wide keeps a blunter taper, so
    // its tip does not flicker either.
    float px = ring.pixel;
    float dv = length(vec3(xz.x, y0, xz.y) - eye);
    float wdRaw = ring.width;
    float wd = max(wdRaw, dv * px * 0.65);
    float across = v.x > 1e-4 ? 0.5 : v.x < -1e-4 ? -0.5 : 0.0;
    float wv, ref;
    bool fan = !tufted && !culm && !dead;
    if (culm) {
        // The stem a third of a leaf's width; a loose panicle spreads some
        // eight leaf widths, a dense spike three (of the ring's leaves, as a
        // far culm stands for as many culms as its leaves do leaves). The
        // fragment cuts both from the card, which is at least about a pixel
        // across; what that covers past their true widths (kHead, kStem) the
        // fragment takes back.
        float form = smoothstep(0.35, 0.65, sceneWindNoise(root * 0.05 + vec2(91.0, -13.0)) * 0.5 + 0.5);
        float stemP = wdRaw * 0.3, headP = wdRaw * mix(8.0, 3.0, form);
        float stemW = max(stemP, dv * px * 0.7);
        float headW = max(headP, dv * px * 1.2);
        bool tip = v.y > 1.0 - 1e-4;
        wv = tip ? 0.0 : (v.y < 1e-4 || (seg > 2 && y < SW_CULM_STEM + 1e-3)) ? stemW : headW;
        ref = headW;
        // Packed: whole parts the stem's share of the card (1/1000s) and the
        // head's form (1/15s), fractions what each covers of its card.
        b.info.w = floor(stemW / headW * 1000.0 + 0.5) + 0.99 * (stemP / stemW);
        b.info.y = floor(form * 15.0 + 0.5) + 0.99 * (headP / headW);
        b.info.z = clamp(0.9 - lush + 0.4 * (he.z - 0.5), 0.0, 1.0);
    } else if (fan) {
        // A far live leaf stands for a few: a card fanning out from a narrow
        // foot (SW_FAN_WIDTH of its width at the middle), cut per pixel into
        // SW_FAN_STRANDS tapering leaves (surface.glsl.js's swFanSurface), so
        // a far sward reads as fine blades, not broad leaves. Their width
        // keeps the leaf's cover (a strand is shorter than the card and
        // tapers).
        float Wm = wd * SW_FAN_WIDTH;
        wv = Wm * mix(0.35, 1.0, clamp(2.0 * y, 0.0, 1.0));
        ref = Wm;
        b.info.y = SW_FAN_COVER / SW_FAN_STRANDS / SW_FAN_WIDTH * mix(0.75, 1.35, age);
    } else {
        float sharp = smoothstep(0.9, 2.5, wdRaw / max(dv * px, 1e-6));
        float taper = pow(max(1.0 - pow(y, 2.2), 0.0), 0.8) * (0.8 + 0.2 * smoothstep(0.0, 0.2, y));
        // An older leaf is broader (a young one a narrow rolled shoot).
        wv = wd * mix(pow(max(1.0 - y, 0.0), 0.7), taper, sharp) * (dead ? 0.8 : mix(0.75, 1.35, age));
        ref = wd;
    }
    b.info.x = (culm ? 1.0 : dead ? 2.0 : fan ? 3.0 : 0.0) + 0.49 * fract(he.w * 17.3 + hb.x);
    b.carries = fan;
    b.pos = base + side * (across * wv) + P;
    b.normal = normalize(cross(side, tang));
    b.side = side;
    b.uv = vec2(across * wv / ref, y);

    // Colour: lush to dry by the mask and the clump, each blade its own value
    // and a little hue (the streaks that make a sward read as blades rather
    // than as a painted surface); a leaf's sheath paler and yellower at its
    // foot; dead leaves straw to dun; a culm's stem greener than its head.
    // An outer ring's blade is fewer, wider blades' worth: its value spreads
    // a little wider, so the sward's grain keeps its contrast as the rings
    // hand over.
    float coarse = pow(max(ring.coarse, 1.0), 0.12);
    // Once a blade is a pixel or two wide its own value is noise: many
    // blades share a pixel and theirs average out. What still shows is how
    // the blades of a tussock differ from the next one's (its crown in
    // more light, a hollow between, its own age and greenness), so a far
    // blade takes its tussock's value and hue more than its own.
    float own = mix(1.0, clamp(wdRaw / (dv * px * 12.0), 0.15, 1.0), smoothstep(10.0, 40.0, d));
    ivec2 tg = ivec2(floor(root / SW_TUSSOCK));
    float tusTone = sceneWindHash(tg + ivec2(-71, 503)), tusHue = sceneWindHash(tg + ivec2(907, -33));
    float tone = 0.975 + mix(tusTone - 0.5, fract(hb.y * 7.31 + hb.x) - 0.5, own) * 0.55 * coarse;
    float hue = mix(tusHue, fract(hb.w * 5.31 + hr), own);
    vec3 green = SW_LUSH * mix(vec3(0.85, 0.95, 1.1), vec3(1.15, 1.05, 0.8), hue) * tone;
    vec3 dryc = SW_DRY * mix(0.85, 1.15, hr) * tone;
    vec3 col = mix(dryc, green, clamp(lush * 1.3 - 0.15 + clump * 0.2, 0.0, 1.0));
    if (dead) col = mix(swDeadColor(he.y), dryc, 0.3) * mix(0.85, 1.15, hr);
    else if (culm) col = mix(green * vec3(1.05, 1.1, 0.9), dryc, 0.2 + 0.5 * (1.0 - lush));
    else col = mix(col * vec3(1.3, 1.25, 0.75) + vec3(0.01, 0.012, 0.0), col * mix(1.08, 0.94, age), smoothstep(0.03, 0.15, y));
    // Shade: dark low in the sward (its depth by how high the point stands,
    // so a drooping tip low down is shaded too). Far off a blade is a pixel
    // or two: its dark root would leave only the tips showing (a field of
    // dots), so with distance the blade takes the mean of that shade along
    // its whole length and reads as the sward it stands for, as dark as the
    // near blades are on average.
    float sh = clamp(max(P.y / max(0.7 * ht, 1e-3), 0.5 * y), 0.0, 1.0);
    float far = smoothstep(12.0, 70.0, d) * 0.75;
    col *= mix(mix(SW_ROOT_SHADE, 1.0 + 0.2 * sh, sh), swMeanShade(), far);
    col *= 1.0 + SW_SHEEN * (gu * sh * 1.2 + swGustFar(gu) * smoothstep(4.0, 20.0, d));
    col *= 1.0 + 0.4 * flattened;   // a flattened lane shows the blades' paler length
    b.color = col;
    b.ao = mix(mix(0.5, 1.0, sh), 0.8, far);
    // Near the eye a blade is lit as its own face; further off more and more
    // as the sward it stands in (a hillside reads as turf, not a field of
    // bright tips): its blades' mean as the eye sees them (surface.glsl.js
    // turns this way into the sward's light and facet).
    b.bulk = mix(mix(0.3, SW_BULK, smoothstep(2.0, 14.0, d)), 0.95, far);
    // The way its blades stand: the ground's normal tipped by the sward's
    // lay in the wind and its gusts (swLay), from where the sward's light
    // takes over from the blade's own face (2-12 m). The lay is the sward's,
    // steady while the blade stirs.
    vec2 lay = swLay(gu) * smoothstep(2.0, 12.0, d);
    b.up = swUp(gn, lay);
    // Seen against a low sun a far meadow still glows through its blades,
    // less than a near blade held to the light.
    b.far = smoothstep(8.0, 40.0, d) * 0.25;
    return true;
}
#endif
`;
