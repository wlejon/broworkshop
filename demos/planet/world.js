// The planet world: an Earth-sized body whose land is made by its processes
// (terrain.js: plates and their belts, the continents on them, the rivers
// that drain and carve them, the climate) over a FastNoise tree of the fine
// relief, and whose surface is what that climate grows. The views and the
// capture script share it.
import { sceneViewport, orbitRotation, Camera } from "/lib/kit/viewport3d.js";
import { planetController } from "/lib/kit/planetcam.js";
import { SUN_LUX, AIR } from "/lib/kit/sky.js";
import { herbModule } from "/lib/herbs/index.js";
import { swardModule } from "/lib/sward/index.js";
import { treeModule, treeSpecies } from "/lib/trees/index.js";
import { TEMPERATE, BROADLEAF, BIRCH, CONIFER, SHRUB, OAK, LIME } from "/lib/trees/temperate.js";
import { R, SEED, N, add, mul, fbm, TREE, PROCESSES, ARGV } from "/app/terrain.js";

export { R };

export const vp = sceneViewport('#stage', {
    // (Yaw about the view's own up: the globe turns under a drag from any side.)
    orbit: { target: [0, 0, 0], dist: 3e7, fov: 40, near: 1e4, far: 1e8, rot: orbitRotation(0, -1.2), yawAxis: 'view' },
    // (The wheel is the planet's own, below; walking and flying take the mouse.)
    controls: { orbitButton: 0, panButton: 2, minDist: 2, maxDist: 6e7, zoomRate: 0, accept: () => ctl.mode === 'orbit' },
});
export const { scene } = vp;

// --- the surface ----------------------------------------------------------------------

// What grows where, by the climate: warm or cold by latitude and height,
// wet or dry by the belts of the air's circulation and the sea's reach.
const SURFACE = `
// How far past the ice line the broad climate is at a point (degrees: the
// line \`line\`, less the year's mean of its broad ground); landSurface's ice
// reads its gradient for how wide its edge is.
float iceClimate(vec3 at, vec3 up, float line) {
    float sl = up.y;
    return line - (28.0 - 44.0 * sl * sl - 6.5 * max(landGrid(0, at).x, 0.0) / 1000.0);
}
// How wet the air is that feeds the snow at a point: the processes' (channel
// 1's w) as its mean over the land some 600 km about it, weighed by how much
// it is land (terrain.js's snowAir, channel 2's x and y: the means of the
// land's wetness and of the land). (The ice line read the point's own: the
// air dries a few hundred km in from a coast, so on a cold land the ice and
// the late snow lay as a rim tracing every coast, a dry bare interior inside
// it; a mean with the sea's in it kept the rim, wider.) Its land's mean, the
// same along a coast as inland.
float snowWet(vec3 at, float here) {
    // (The point's own only a little, as a twelfth of the reach's land, for
    // a small island whose reach is all sea: at a coast, where half of it is
    // sea, more of it kept the coast's wet air's rim.)
    vec2 m = landGrid(2, at).xy;
    return (0.25 * here + 12.0 * m.x) / (0.25 + 12.0 * m.y);
}

// The surface below reads its inputs through the engine's footprint-aware
// reads (docs/land-api.js, "FILTERED READS"): every value with its mean
// over the texel and the spread that mean hides, each line the share of the
// texel past it, so it draws the same at every footprint with no case for
// a coarse or a fine texel.
LandSurface landSurface(LandPoint q) {
    vec4 g = landGrid(1, q.at);
    float ground = landGrid(0, q.at).x;   // (the processes' ground; g.x is the catchment's log)
    float lat = asin(clamp(q.up.y, -1.0, 1.0));
    float h = q.height;
    if (h < 0.0) {
        // The seabed (the land's sea over it): the shelf's sand, the deep's mud.
        return landSurfaceOf(mix(vec3(0.16, 0.14, 0.10), vec3(0.05, 0.05, 0.045), smoothstep(5.0, 120.0, -h)));
    }
    float sl = sin(lat);
    // The air's temperature cools with the height of the broad ground, the
    // processes': the relief's few hundred metres over it moved every line
    // drawn from it (tree line, tundra, snow) degrees either way, blob by
    // blob, a far land mottled from edge to edge. A range keeps its own
    // heights: snow on its crests and a tree line up its flanks. A plain's
    // hills keep none: a few hundred metres there are a degree or two, yet
    // where the year sits near a line they flecked a polar plain with snow
    // and tundra blob by blob from orbit.
    float share = smoothstep(0.3, 0.7, g.y);
    float temp = 28.0 - 44.0 * sl * sl - 6.5 * mix(max(ground, 0.0), h, share) / 1000.0;
    // The landform (landTerrain): the slope, its aspect and the hollow at
    // 90 m, the crest (its relief over its surroundings) and the broader
    // valley at 600 m, each read at 1.5 texels where that is wider (the
    // heights there the ground as that scale sees it) and a hollow then its
    // mean over the texel: from orbit the few metres a broad form makes,
    // not the grid's cells, which drew the snow, tundra and rock as blocks
    // of the cells' staircase. (The sea's ground as its level: a coast's
    // ring on the sea floor stood every coast up as a crest, a band some
    // 10 degrees colder and bare rock tracing every coast all round.)
    LandTerrain T = landTerrain(q, 90.0, 0.0), W = T;
    // (Where both read at 1.5 texels, the same heights: the wider's hollow
    // is the narrower's, scaled to its scale; read again only where not.)
    if (1.5 * q.footprint < 600.0) W = landTerrain(q, 600.0, 0.0);
    else W.hollow *= (600.0 * 600.0) / (90.0 * 90.0);
    float crest = clamp(-W.hollow, -400.0, 400.0);
    float hollow = T.hollow;      // >0 concave (a hollow), <0 convex (a spur)
    float valleyC = W.hollow;     // the same, wider
    float tanS = max(T.grade, 0.005);
    // Facing the pole (the rise toward the equator): cooler, moister,
    // its woods denser; facing the sun the drier and paler. (-1 .. 1)
    float poleward = clamp(-T.slope.y * sign(q.up.y) / max(T.grade, 0.02), -1.0, 1.0) * smoothstep(0.02, 0.15, T.grade);
    // The relief the height here lacks, as each line's spread over it: the
    // heights' spread at the texel's scale where the temperature reads h (a
    // range), and each regional level's band (terrain.js) as far as the
    // level is not in here (past the regions about the eye, or read by a
    // texel wider than its cells), so a far range's crests are a share of
    // snow, not snow or rock texel by texel, and the land past the regions
    // is the same share as the land in them seen from as far.
    #define LACKS(level, amp) ((amp) * (1.0 - landGridCover(level, q.at)))
    float hidden = share * T.height.spread + g.y * (LACKS(0, 30.0) + LACKS(1, 120.0) + LACKS(2, 330.0) + LACKS(3, 520.0));
    // (A third of it: the lines are cut by the ground's own shape, so what
    // is left of the hidden relief only softens them by its share; at full
    // spread they lay over the ridges as smears.)
    float spread = 0.33 * 6.5 * hidden / 1000.0;
    // The water the ground gathers, as a wetness index: the catchment
    // (log10 km², the finest regional level's here, its branches some
    // cells wide) over the slope it drains down, plus the hollows. (The
    // catchment as its mean over a cell of the finest grid read here: a D8
    // network draws each branch as the cells' staircase.)
    vec4 gSpread;
    float gx = landGridMean(1, q.at, landGridCell(q.at), gSpread).x;
    float twi = gx - 0.6 * log(tanS) / log(10.0) + 0.006 * clamp(hollow, -100.0, 100.0) + 0.004 * clamp(valleyC, -150.0, 150.0);
    // The slope facing the pole the cooler (a degree), the sun's the warmer.
    temp -= 1.0 * poleward;
    // How moist the ground is by its place in the landform (0 the dry
    // spurs and sunny shoulders .. 1 the hollows and valley floors the
    // water gathers in): the zones of wood, meadow and bare ground follow it.
    float moist = smoothstep(0.3, 2.6, twi + 0.4 * poleward);
    // (Its mean over the hill country, about which the zones are set, so
    // the land's mean colour holds.)
    const float moist0 = 0.35;
    // The fall line (downhill, in the body's frame) and streaks down it: a
    // fine noise averaged along the fall line, so it runs in gullies and
    // scree chutes a few times longer than wide (a few texels at least).
    vec3 fall = -(T.slope.x * T.east + T.slope.y * T.north) / tanS;
    float Ls = max(2.0 * q.footprint, 120.0);
    vec3 Pq = landBodyPoint(q.at);
    float streak = 0.0;
    for (int k = -2; k <= 2; ++k) streak += landValueNoise((Pq + fall * (float(k) * 1.3 * Ls)) / Ls + 7.1);
    streak *= 0.9 * smoothstep(0.03, 0.12, tanS);
    // Bands along the contours (terraces, the outcrops a layer makes): a
    // noise of the height itself, fast across the contours, slow along
    // them; faded where the texel spans a band.
    float bandW = 30.0 / tanS;
    float band = landValueNoise(Pq / 1800.0 + h / 30.0 + 3.3) * (1.0 - smoothstep(0.25 * bandW, 0.5 * bandW, q.footprint)) * smoothstep(0.03, 0.1, tanS);
    // An exposed crest is the colder (wind, thin soil: the trees and the
    // late snow keep off it), a sheltered hollow the milder: some 2.5
    // degrees a hundred metres, as Earth's tree lines run down the ridges
    // and up the gullies.
    temp -= 0.025 * crest;
    // The patchwork (stands of wood and meadow hundreds of metres across,
    // octaves 2.4 km to 190 m), only to break the zones' edges and vary the
    // density inside them: the zones themselves are the landform's.
    LandStat toneG = landGrain(Pq, 0.0, 2400.0, 4, 0.43, 0.8, 0.0), clearingG = landGrain(Pq, 41.7, 2400.0, 4, 0.43, 0.8, 0.0);
    float tone = toneG.mean, clearing = clearingG.mean;
    // The grain that breaks a line between two covers: octaves from 1.6 km
    // down to 8 m (a rough, fractal edge), read at the texel or 60 m: an
    // edge is a texel or so sharp where the view resolves the grain and the
    // share of each side where it does not; near the ground, where the
    // plants stand along it, it eases over the tens of metres of the
    // stands' own edges, the octaves under 60 m its ramp.
    LandStat grainG = landGrain(Pq, 5.3, 1600.0, 8, 0.47, 0.68, 60.0);
    float grain = grainG.mean, unres = grainG.spread;
    // Each climate line the share of the texel past it (landShare): its
    // value the temperature's distance past the line's middle in half
    // widths of the line, moved by the landform (up the moist gullies, down
    // the dry spurs and the crests) and ragged by the grain, spread by what
    // the grain and the relief do not hold. (The crests' own share again,
    // so the lines run along the ridges more than the grain's blobs do.)
    float lineN = 0.1 * tone + 0.006 * clamp(crest, -150.0, 150.0) - 0.9 * (moist - moist0) + 0.25 * streak + 0.5 * grain;
    float lineS = 0.5 * (0.06 + 1.1 * unres);
    #define LINE(x, half) landShare(LandStat((x) / (half) + lineN, length(vec2(lineS, 0.5 * spread / (half)))), 0.0)
    #define COLD(warm, cold) LINE(0.5 * ((warm) + (cold)) - temp, 0.5 * ((warm) - (cold)))
    #define WARM(cold, warm) (1.0 - COLD(warm, cold))
    // The processes' (the plants' woods read the same), and wetter down the
    // valleys where the drainage gathers (from a few km² of catchment; g.x
    // is its log10).
    // (A big river runs green through dry country: its banks watered from
    // upstream however dry the air over them.)
    float wet = clamp(g.w + 0.25 * smoothstep(0.5, 3.0, g.x) + 0.35 * (1.0 - g.w) * smoothstep(3.7, 5.2, g.x), 0.0, 1.0);
    // What the land's colour reads: the ground's water the same over the
    // slopes and the valleys that gather it, a little more down the bigger
    // valleys and along a big river through dry country. (The cover's wet
    // above gathers from a few km² of catchment: the catchment's log is a
    // smooth field kilometres wide, so a colour by it drew every valley of
    // the network as a dark band of forest between pale uplands, the
    // drainage as a map from 90 km up, not as relief. Its mean over a
    // land, which a far texel's catchment reads, is kept: from orbit the
    // land is as green as it was.)
    float wetC = clamp(g.w + 0.19 + 0.06 * smoothstep(2.0, 4.5, g.x) + 0.2 * (1.0 - g.w) * smoothstep(3.7, 5.2, g.x), 0.0, 1.0);
    float steep = 1.0 - q.normal.y;
    // (How much of the slope the texel's normal does not hold: the relief's
    // spread over the scale it was read at.)
    float steepS = T.height.spread / T.scale;

    // Bare ground by how dry (ochre sand to tan steppe), what grows over it
    // by how wet and how warm: a warm wet lowland's deep broadleaf green, a
    // cold one's darker conifer, a dry or cool one's lighter yellow-green.
    // (Linear albedos as Earth's from orbit: a forest's 0.04 to 0.06, its
    // conifers darkest; grassland's some 0.11; steppe's 0.2; sand's 0.35.)
    vec3 desert = vec3(0.50, 0.35, 0.19), steppe = vec3(0.27, 0.21, 0.11);
    vec3 grassWarm = vec3(0.085, 0.13, 0.035), grassCool = vec3(0.09, 0.115, 0.05);
    vec3 forestWarm = vec3(0.024, 0.058, 0.016), forestCold = vec3(0.022, 0.042, 0.022);
    vec3 tundra = vec3(0.085, 0.09, 0.05), rock = vec3(0.19, 0.185, 0.175);
    vec3 snow = vec3(0.82, 0.84, 0.87);
    float warmth = WARM(4.0, 20.0);
    vec3 grass = mix(grassCool, grassWarm, warmth), forest = mix(forestCold, forestWarm, warmth);
    // (The woods' lines as Earth's continental tree lines: forest wherever
    // the year's mean is over some -2.5 degrees and it is wet enough,
    // thinning to the tree line near -5.5; tundra past it. Lines set
    // warmer had the cooler hills of a temperate land in tundra and rock,
    // pale blotches over every ridge from far up: at -3 the uplands' tops
    // still stood bald over a forested range, a camouflage of pale patches
    // from 90 km up; the crests' own cold, below, still bares the highest.)
    // (Darker and lighter stands, mean 1; the meadows' and the steppe's
    // grain the same, fainter. The wet hollows the darker, the crests the
    // lighter: their mean over a land is about none.)
    // (The woods darkest down the moist hollows and on the slopes facing the
    // pole, lightest on the dry spurs; banded along the contours; the
    // noise a little. The meadows' and the steppe's the same, fainter.)
    // (The fine grain shades the canopy in stands down to the texel.)
    forest *= clamp(1.0 + 0.07 * tone + 0.16 * grain - 0.6 * (moist - moist0) - 0.12 * poleward + 0.1 * band, 0.4, 1.8);
    grass *= clamp(1.0 + 0.05 * tone + 0.06 * grain - 0.3 * (moist - moist0) - 0.08 * poleward + 0.12 * band, 0.5, 1.5);
    steppe *= clamp(1.0 + 0.04 * tone + 0.05 * grain - 0.2 * (moist - moist0) + 0.1 * band, 0.6, 1.4);
    // The canopy thins up the slopes toward the tree line, a gradient over
    // some 8 degrees (a kilometre or more of height) rather than a step:
    // lighter and greyer as the crowns stand apart over the ground's own
    // cover, the ridges and dry spurs first (they are the colder, by crest
    // and by lineN), the moist gullies last.
    float thin = 1.0 - smoothstep(-5.5, 2.5, temp - 2.5 * (0.1 * tone - 0.9 * (moist - moist0)));
    forest = mix(forest, mix(1.3 * forest, tundra, 0.15), 0.6 * thin);
    // The drainage: gullies and stream lines as fine dark threads down the
    // slopes, the woods densest and wettest along them: the zero lines of
    // a noise averaged along the fall line (so they run down it), at two
    // spacings, 1.8 km and 800 m; off the crests. Each spacing's threads
    // are their mean share where the texel cannot hold their width.
    float thread = 0.0;
    for (int j = 0; j < 2; ++j) {
        float L = j == 0 ? 1800.0 : 800.0;
        float n = 0.0;
        for (int k = -2; k <= 2; ++k) n += landValueNoise((Pq + fall * (float(k) * 0.7 * L)) / L + 13.7 + float(j) * 5.1);
        float sharp = 1.0 - smoothstep(0.08, 0.2, abs(n));
        float held = 1.0 - smoothstep(0.08 * L, 0.16 * L, q.footprint);
        thread = max(thread, mix(0.2, sharp, held) * (j == 0 ? 1.0 : 0.7));
    }
    thread *= smoothstep(0.03, 0.1, tanS) * (1.0 - smoothstep(40.0, 140.0, crest));
    forest *= 1.0 - 0.4 * thread;
    grass *= 1.0 - 0.2 * thread;
    vec3 c = mix(desert, steppe, smoothstep(0.08, 0.24, wetC));
    c = mix(c, grass, smoothstep(0.24, 0.38, wetC));
    // The woods broken by meadows and clearings (more on the drier, the
    // steeper and the colder ground): open where the ground is dry by its
    // place (the spurs and shoulders, the sunny slopes, the steep faces,
    // broken down the fall line), the share of the texel past the line, so
    // a far texel's woods are as open as its ground's. (Only the driest and
    // steepest open: a forested range's dry crests and spurs are a thinner,
    // lighter canopy, not meadow; opened from openG over 0.75 they were
    // bald patches over every hilltop, the region view a camouflage of pale
    // blotches on dark woods.)
    float woods = smoothstep(0.36, 0.54, wetC) * WARM(-7.5, -2.5);
    float openG = 2.2 * (moist0 - moist) + 1.2 * (0.6 - wetC) + 2.5 * steep - 0.3 * poleward + 0.5 * streak * smoothstep(0.1, 0.3, steep) + 0.3 * clearing + 0.4 * grain;
    woods *= 1.0 - 0.75 * landShare(openG, length(vec2(0.025 + 0.3 * unres, 0.3 * clearingG.spread)), 1.9);
    c = mix(c, forest, woods);
    tundra *= 1.0 - 0.25 * thread;
    c = mix(c, tundra, COLD(-5.5, -10.5));
    // Bare rock where it is steep and high (a range, or above the trees):
    // a lowland's steep hillsides are wooded or grassed over, not a net of
    // grey crests across every hill.
    // (A range's flanks wooded where the air is still mild up them, bare
    // as it cools toward the tree line.)
    float alpine = max(smoothstep(0.15, 0.5, g.y) * mix(0.4, 1.0, COLD(4.0, -2.0)), COLD(-2.0, -6.0));
    // (The crests bare first, the gullies last; scree in streaks down the
    // fall line under the steep crests; cut crisp by the grain. A crest's
    // rock is a narrow line: a texel whose normal does not hold the slope's
    // relief holds it as a share, its turf and scrub beside it.)
    float rockV = steep + 0.0015 * crest - 0.002 * clamp(hollow, -100.0, 100.0) + 0.1 * streak + 0.05 * grain;
    float rockS = landShare(rockV, length(vec2(0.0125 + 0.05 * unres, steepS)), 0.5) * alpine;
    c = mix(c, rock, rockS);
    // Above the trees the ground thins to scree and rock, on the crests,
    // spurs and steep faces first and the more of it the colder, so the
    // rock hands over to the snow, not tundra to snow: just past the tree
    // line only narrow crisp lines along the crests and streaks down the
    // falls, the turf between, and the more of it the higher.
    float bare = 0.005 * crest - 2.0 * clamp(hollow / T.scale, -0.15, 0.15) + 3.0 * steep + 0.5 * streak + 0.3 * grain - 0.75 + 0.9 * COLD(-8.0, -14.0);
    float rockH = COLD(-5.5, -10.5) * alpine * landShare(bare, length(vec2(0.03 + 0.3 * unres, 3.0 * steepS)), 0.0);
    c = mix(c, rock, rockH);
    // Ice where the year is cold and the snow falls deep enough to outlast
    // the summers: the wetter the air, the warmer the line it holds to
    // (a maritime icefield's mean near -13 here, a dry land's none above
    // -22: a cold desert is tundra and bare rock, not ice; from -7, a swing
    // of 15 degrees drew a cold land's snow by its wetness more than its
    // cold, along its wetter coasts round a bare interior). (This climate's
    // means run some 5 degrees under Earth's at 45 to 65 degrees, so its
    // lines sit as far under Earth's.) The margin follows the ground: the
    // ice flows down the valleys that gather it (outlet glaciers), the
    // low coasts melt it back (dark strips), and the relief that stands
    // over its neighbours (ridges, nunataks) stands clear of it near its
    // edge; deep inside the sheet all of it is buried.
    float relief = h - ground;
    float valley = smoothstep(0.5, 3.5, g.x);
    vec3 t1 = T.east, t2 = -T.north;
    float iceLine = mix(-22.0, -13.0, smoothstep(0.15, 0.65, snowWet(q.at, g.w)));
    float m = iceLine - temp + 3.0 * valley - 4.0 * (1.0 - smoothstep(0.0, 500.0, ground)) * (1.0 - valley)
            - 6.0 * relief / 1000.0;
    // The edge as sharp as the view: the broad climate's change over two
    // texels, and on a range the relief a texel hides. (A margin drawn
    // with a fixed width of degrees lay a hundred km soft over a plateau,
    // whose climate changes a degree in as far: a bank of fog.)
    // (Taken across the texel: over a fixed 2 km it held the ground's slope,
    // 6.5 degrees a km of rise, and times a far texel's footprint that was
    // a margin tens of degrees soft, half ice over a whole cold land from
    // orbit where the nearer tiles had a few fields, square tile by tile.)
    float D = max(2000.0, q.footprint);
    vec2 grad = vec2(iceClimate(q.at + t1 * D, normalize(q.up + t1 * (D / ${R}.0)), iceLine) - iceClimate(q.at - t1 * D, normalize(q.up - t1 * (D / ${R}.0)), iceLine),
                     iceClimate(q.at + t2 * D, normalize(q.up + t2 * (D / ${R}.0)), iceLine) - iceClimate(q.at - t2 * D, normalize(q.up - t2 * (D / ${R}.0)), iceLine)) / (2.0 * D);
    float w = max(length(grad) * 2.0 * q.footprint, 0.02) + 0.5 * spread * share;
    // (Of the landform's spread only a little: the broad climate's lines are
    // smooth, so cut by them alone a far texel's edge is crisp with no
    // staircase; widened by the landform's degrees, the edge lay hundreds of
    // km soft, a bank of fog. The storms' noise below breaks the snow up.)
    float ice = landShare(m, 0.5 * w, 0.0) * (1.0 - smoothstep(0.45, 0.75, steep));
    // (Its accumulation zone a snow's white; down toward the margin the
    // bare ice of its ablation zone, greyer and bluer.)
    // (By the broad climate alone: the ground's grain would mottle it.)
    vec3 iceC = mix(vec3(0.45, 0.53, 0.62), vec3(0.76, 0.80, 0.86), smoothstep(0.0, 5.0, iceLine - temp + 3.0 * valley));
    // The year's late snow past the ice: patches on the ridges and high
    // ground where it is cold enough, the valleys and steep faces clear.
    // (Longest on the high ground, in the hollows and gullies that drift
    // full, and on the slopes facing the pole; the noise's grain of the
    // relief, round blobs, a little.)
    // (And unevenly from region to region, as the winters' storms left it,
    // some 3 degrees each way over 250 and 80 km, so a cold land's snow
    // from afar is fields and gaps, not one sheet following its lines: its
    // octaves under the texel at their mean, their spread the edge's.)
    // (Its line 2.5 degrees warmer than the ice's, not 4: a cold
    // continent's north lay under one soft white mass of it, a bank of
    // cloud from orbit.)
    LandStat storms = landStatScale(landGrain(Pq, 61.3, 2.5e5, 2, 0.32, 0.55, 0.0), 0.8);
    float lie = (iceLine + 2.5) - temp + 3.0 * relief / 1000.0 - 3.0 * valley + 0.015 * clamp(hollow, -60.0, 100.0) + 1.5 * poleward + storms.mean;
    float patches = 0.8 * landShare(lie, length(vec2(0.5 * w, storms.spread)), 0.0) * (1.0 - smoothstep(0.35, 0.6, steep));
    c = mix(c, snow, patches * (1.0 - ice));
    c = mix(c, iceC, ice);
#ifdef PROBE
    // (Where the woods stand and why: red the woods' share, green the finest
    // regional level's cover, blue the catchment, log10 km² over 6.)
    c = vec3(woods, landGridCover(0, q.at), gx / 6.0) * 0.5;
#endif
#ifdef DRAINAGE
    // (The rivers' catchments: blue from 10 km² to a million.)
    c = mix(vec3(0.3, 0.28, 0.25), vec3(0.0, 0.05, 0.5), smoothstep(1.0, 6.0, g.x));
#endif
#ifdef ATTRS
    // (The terrain's attributes: red the wetness index, green the hollows
    // (bright) and spurs (dark), blue the pole-facing slopes.)
    c = vec3(smoothstep(0.0, 3.0, twi), 0.5 + 0.01 * clamp(hollow + valleyC, -50.0, 50.0), 0.5 + 0.5 * poleward) * 0.5;
#endif
#ifdef WETNESS
    // (How wet: red dry, through yellow, to blue wet.)
    c = mix(mix(vec3(0.5, 0.05, 0.02), vec3(0.45, 0.4, 0.05), smoothstep(0.0, 0.5, g.w)), vec3(0.02, 0.08, 0.5), smoothstep(0.5, 1.0, g.w));
#endif
#ifdef TEMPERATURE
    // (The year's mean: blue under -20 C, white at -10, green at 0, red
    // over 20; a dark band every 5 degrees of it, a line every 10 degrees
    // of latitude.)
    c = temp < -10.0 ? mix(vec3(0.02, 0.05, 0.5), vec3(0.6), smoothstep(-20.0, -10.0, temp))
      : temp < 0.0 ? mix(vec3(0.6), vec3(0.05, 0.4, 0.05), smoothstep(-10.0, 0.0, temp))
      : mix(vec3(0.05, 0.4, 0.05), vec3(0.6, 0.05, 0.02), smoothstep(0.0, 20.0, temp));
    c *= mix(0.4, 1.0, smoothstep(0.0, 0.08, abs(fract(temp / 5.0 + 0.5) - 0.5)));
    // (30 degrees black, 40 red, 50 yellow, 60 cyan, 70 magenta.)
    float tens = floor(abs(degrees(lat)) / 10.0 + 0.5);
    vec3 lineC = tens < 3.5 ? vec3(0.0) : tens < 4.5 ? vec3(1.0, 0.0, 0.0) : tens < 5.5 ? vec3(1.0, 1.0, 0.0) : tens < 6.5 ? vec3(0.0, 1.0, 1.0) : vec3(1.0, 0.0, 1.0);
    c = mix(c, lineC, 1.0 - smoothstep(0.0, 0.008, abs(fract(degrees(lat) / 10.0 + 0.5) - 0.5)));
#endif
    LandSurface s = landSurfaceOf(c);
    float grows = smoothstep(0.15, 0.45, wet) * WARM(-4.0, 4.0) * (1.0 - smoothstep(0.3, 0.55, steep));
    s.cover = vec4(grows, 1.0 - smoothstep(0.15, 0.5, wet), 0.6 + 0.6 * wet, smoothstep(0.55, 0.8, wet) * grows);
    s.herbs = 0.3 * grows;
    return s;
}
`;

// --- the body, the land and the light --------------------------------------------

// Where the place starts: a point on the body (its frame), a temperate
// lowland at 39° N with a range in sight.
export const START = (() => {
    const d = [0.2848, 0.6286, -0.7237], l = Math.hypot(d[0], d[1], d[2]);
    return d.map((x) => (x / l) * R);
})();
scene.setBody({ radius: R, at: START });

export const land = scene.createLand({ height: TREE, seed: SEED, surface: (ARGV.includes('attrs') ? '#define ATTRS\n' : '') + (ARGV.includes('probe') ? '#define PROBE\n' : '') + (ARGV.includes('drainage') ? '#define DRAINAGE\n' : '') + (ARGV.includes('wetness') ? '#define WETNESS\n' : '') + (ARGV.includes('temperature') ? '#define TEMPERATURE\n' : '') + SURFACE, processes: PROCESSES, sea: { level: 0, absorb: [0.6, 0.18, 0.12] } });

// --- the plants -------------------------------------------------------------------------

// The temperate wood's trees where the climate says (the processes' z),
// in stands and clearings a few hundred metres across; conifers as it
// grows cold (w), the broadleaves' kinds where it is warm. Shrubs in the
// woods' thickets and their edges. The plants stand on the land's own
// height (its tree, the processes' base under it).
const clamp01 = (a) => N('Min', { LHS: N('Max', { LHS: a, RHS: 0 }), RHS: 1 });
const affine = (a, s, o) => add(mul(a, s), o);
const warmShare = (k) => ({ own: 'w', scale: -k, offset: k });
const stands = clamp01(affine(fbm(700, 3, 21), 2.4, 0.62));
const thicket = clamp01(affine(fbm(120, 2, 22), 3.0, -0.2));
// (Drawn as far as they are placed: the land is their canopy from the
// node's range on, so a range past the rules' left a band with neither.)
// (`open`: a field 0 .. 1 the plants' chance is times, 0 where none stand:
// keepClear's pads.)
const plantRules = (open) => ({
    ground: TREE, seed: SEED, range: 6000,
    layers: [
        { spacing: 6, jitter: 0.9, sink: 0.1, seed: 11, chance: { own: 'z', times: open ? mul(stands, open) : stands },
          species: [{ species: CONIFER, weight: { own: 'w' } }, { species: BROADLEAF, weight: warmShare(0.45) },
                    { species: OAK, weight: warmShare(0.25) }, { species: BIRCH, weight: warmShare(0.2) },
                    { species: LIME, weight: warmShare(0.1) }],
          scale: affine(fbm(400, 2, 23), 0.2, 0.95), scaleVariety: 0.25,
          tint: affine(fbm(300, 2, 24), 1.4, 0), tintVariety: 0.4 },
        { spacing: 3, jitter: 1.0, sink: 0.05, seed: 12, chance: { own: 'z', scale: 0.35, offset: 0.02, times: open ? mul(thicket, open) : thicket },
          species: [SHRUB], scaleVariety: 0.4, tintVariety: 1.0 },
    ],
});
export const PLANT_RULES = plantRules(null);
// (plantsrange=<m>: drawn only so far, the land's canopy past it, so the same
// land can be seen drawn both ways.)
export const plants = scene.createPlants({
    module: treeModule(), species: TEMPERATE.map(treeSpecies), receivesShadow: true, range: +(ARGV.find((s) => s.startsWith('plantsrange=')) || 'plantsrange=6000').slice(12), land,
    rules: PLANT_RULES,
});
plants.castsShadow = true;

// The grass and herbs where the surface's cover grows them (its turf the
// land's look out past the blades).
export const grass = scene.createGrass({
    ground: land, turf: !ARGV.includes('noturf'),
    sward: swardModule({ lush: [0.08, 0.15, 0.035], dry: [0.26, 0.21, 0.08] }),
    herbs: herbModule({ species: ['bracken', 'woodsorrel', { preset: 'daisy', abundance: 1.5 }, 'poppy'] }),
});

// The sun: a direction in the body's frame (the light's, from the sun),
// turned into the place frame whenever the place moves.
export const sunBody = (() => { const d = [-0.3, -0.75, 0.6], l = Math.hypot(d[0], d[1], d[2]); return d.map((x) => x / l); })();
export const sun = scene.createLight({ type: 'directional', direction: [0, -1, 0], castsShadow: true, intensity: SUN_LUX });
function placeSun() {
    const b = scene.place.basis;   // row-major, column j is place axis j in the body's frame
    sun.direction = [0, 1, 2].map((j) => b[j] * sunBody[0] + b[3 + j] * sunBody[1] + b[6 + j] * sunBody[2]);
}
placeSun();
scene.addEventListener('reanchor', placeSun);
// (noair: none, so a probe of the land's own look from far and near has no
// air between: ladder.js's control.)
scene.setAtmosphere(Object.assign({ enabled: !ARGV.includes('noair') }, AIR, ARGV.find((s) => s.startsWith('turbidity=')) ? { turbidity: +ARGV.find((s) => s.startsWith('turbidity=')).slice(10) } : {}));
// (Metered on the sun's light: a planet of dark sea and forest stays dark
// and its snow white, from orbit to the grass.)
// (ev=<EV100>: fixed there instead, so a probe's frames are exposed alike
// whatever came before: ladder.js's.)
const FIXED_EV = ARGV.find((s) => s.startsWith('ev='));
scene.setExposure(FIXED_EV ? { mode: 'fixed', ev: +FIXED_EV.slice(3) } : { mode: 'auto', meter: 'incident' });
// Near the ground the view is exposed for the woods it stands in, as a
// photographer would: about 1.2 stops over the sun's reading at the grass,
// none from a few km up, where the land is seen whole.
let exposedFor = 0;
function exposeFor(pos) {
    if (FIXED_EV) return;
    const h = Math.max(eyeHeight(pos), 1);
    const comp = 1.2 * Math.min(Math.max(1 - Math.log10(h / 20) / 2, 0), 1);
    if (Math.abs(comp - exposedFor) < 0.05) return;
    exposedFor = comp;
    scene.setExposure({ mode: 'auto', meter: 'incident', compensation: comp });
}

// --- the clouds ---------------------------------------------------------------------

// The weather's lows: where the air turns about a low, its clouds wind
// into it (the westerlies' cyclones, a continent wide, and a few tropical
// ones, tighter and faster), counter-clockwise in the north and clockwise
// in the south. Two vec4s a low: its centre and turn (radians at its
// heart), then its size (radians) and how overcast its heart is.
const LOWS = (() => {
    let s = (SEED * 7919) >>> 0;
    const rnd = () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const data = [];
    const low = (lat, lon, turn, size, heart, eye) => {
        const c = Math.cos(lat);
        const hemi = lat >= 0 ? 1 : -1;
        data.push(c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon), hemi * turn, size, heart, eye, 0);
    };
    // Where the place lies in the frame lowCommas reads a low at `lat`,
    // `lon` of `size` in (x east, y poleward, in its sizes): Infinity on
    // the far side.
    const placeDir = START.map((x) => x / R);
    const reach = (lat, lon, size) => {
        const c = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
        const cd = c[0] * placeDir[0] + c[1] * placeDir[1] + c[2] * placeDir[2];
        if (cd < 0.4) return Infinity;
        const nl = Math.hypot(-c[0] * c[1], 1 - c[1] * c[1], -c[2] * c[1]);
        const north = [-c[0] * c[1] / nl, (1 - c[1] * c[1]) / nl, -c[2] * c[1] / nl];
        const v = placeDir.map((x, k) => (x - c[k] * cd) / cd);
        const east = [c[1] * north[2] - c[2] * north[1], c[2] * north[0] - c[0] * north[2], c[0] * north[1] - c[1] * north[0]];
        const qx = (v[0] * east[0] + v[1] * east[1] + v[2] * east[2]) / size;
        const qy = (v[0] * north[0] + v[1] * north[1] + v[2] * north[2]) * Math.sign(lat) / size;
        return [qx, qy];
    };
    // Whether a low's cloud (lowCommas': its head and bands, its cold
    // front, its warm front's shield) reaches the place, with a margin.
    const reaches = (lat, lon, size) => {
        const q = reach(lat, lon, size);
        if (q === Infinity) return false;
        const [x, y] = q;
        if (Math.hypot(x, y) < 2.7) return true;
        const s = Math.min(Math.max(-y - 0.3, 0), 3.6);
        if (-y - 0.3 > -0.5 && -y - 0.3 < 4.0 && Math.abs(x - (0.45 - 0.1 * s - 0.2 * s * s)) < 0.9) return true;
        const yr = y - (-0.3 - 0.3 * (x - 0.45));
        return x > 0.0 && x < 2.3 && yr > -0.4 && yr < 1.4;
    };
    // (Each hemisphere's storm track holds eight, their longitudes spread
    // about the world with a little wander, as the westerlies' lows are;
    // none whose weather reaches the place, whose sky is a fair day's, so
    // one that would is moved on east.)
    for (let i = 0; i < 16; i++) {
        const lat = (i % 2 ? -1 : 1) * (0.68 + 0.32 * rnd());
        let lon = ((i >> 1) + (i % 2) * 0.5 + 0.5 * (rnd() - 0.5)) / 8 * Math.PI * 2;
        const size = 0.17 + 0.08 * rnd();
        for (let k = 0; k < 8 && reaches(lat, lon, size); k++) lon += Math.PI / 16;
        low(lat, lon, 1.0 + 1.0 * rnd(), size, 0.3 + 0.3 * rnd(), 0);
    }
    for (let i = 0; i < 3; i++) {
        const lat = (rnd() < 0.5 ? -1 : 1) * (0.2 + 0.2 * rnd());
        low(lat, rnd() * Math.PI * 2, 3.5 + 1.5 * rnd(), 0.04 + 0.015 * rnd(), 0.9, 1);
    }
    return data;
})();
const WEATHER = fbm(1.4e6, 5, 41, 0.55), SHOWERS = fbm(2.6e5, 4, 42);
// The cover's texture: how thick the cloud is and where a system's margin
// frays, some 350 km down to 25 km; and finer, the trades' streets.
const CLOUD_TEX = fbm(3.5e5, 5, 43, 0.6), CLOUD_FINE = fbm(5.0e4, 2, 44, 0.5);

// The deck from 2.5 km to 10.5 km (its bases over the hills and the low
// view's eye). Its cover by the general circulation and
// the climate the land's processes reckon (channel 1's w, how wet; channel
// 0's x the ground, under the sea too): the rain belt a narrow broken line north of
// the equator, clusters of towers and anvils; the subtropics' highs clear,
// but for the trades' cumulus over the sea and sheets of stratocumulus in
// cells off the western coasts (land to the east); the westerlies' storm
// tracks, eight lows a hemisphere, each a broad swirling system 1500 to
// 3000 km across: its head a shield wound into spiral bands of varying
// width and brightness with gaps between and a dry slot wrapping in, its
// cold front a broken band 200 to 400 km wide trailing equatorward some
// thousands of kilometres and fraying toward its tail, its warm front's
// shield to the east, and behind it over the sea the cold air's open cells
// (a honeycomb veil from afar), as over the storm tracks' seas between
// them; the tropical cyclones' dense discs, clear eyes and spiral bands;
// fair weather's cumulus over moist land; thin cloud over the
// poles' ice. Every shape read through a bent direction (cloudBent), so no
// edge is ruled, and every share a mean over the footprint, so from orbit
// a field of heaps is a veil at its cover.
// Its base at a point: the cover, gathered into the decks' closed cells
// and the fields' clusters (a mesoscale noise 160 km a tile), from a base
// a few hundred metres over the deck's bottom to tops as high as the cover
// says, rounding toward them where the air is convective and cut square
// where it is not. The engine cuts it into billows (its Perlin-Worley,
// 12 km a tile) and erodes their edges (cauliflower above, wisps at the
// bases); from afar, the share of the sky they cover.
//
//   cover  x the share of the sky the clouds cover, y how convective they
//          are (0 a front's or a deck's slab .. 1 heaped cumulus), z how
//          high their tops reach (of the deck), w how much they lie in
//          closed cells (marine stratocumulus)
export const CLOUD_BOTTOM = 2500, CLOUD_TOP = 10500;
// (How many metres the clouds' base takes to rise across their surfaces:
// the engine's billows and detail move the surface by a fifth of it, some
// 150 m each way.)
const CLOUD_EDGE = 1500;
// (The engine's lattice of heaps: a cell a heap at most.)
const HEAP_CELL = 2500;
// (keepClear's air: after the lows in the deck's data, a count and then the
// points, directions in the drifted frame, at most AIR_MOST.)
const AIR_AT = LOWS.length / 4;
export const AIR_MOST = 64 - AIR_AT - 1;
const AIR_CLEAR = 2500;
const CLOUDS =WEATHER.glsl({ name: 'cloudWeather', dims: [3] }) + SHOWERS.glsl({ name: 'cloudShowers', dims: [3] }) +
               CLOUD_TEX.glsl({ name: 'cloudTex', dims: [3] }) + CLOUD_FINE.glsl({ name: 'cloudFine', dims: [3] }) + `
const int LOWS = ${LOWS.length / 8};
const float R = ${R}.0;

// How far a heap may grow at a cell's middle, up (the drifted frame), for
// the air keepClear keeps: none within AIR_CLEAR of a point, growing to its
// own a heap's cell further out (so it shrinks to nothing, never cut off).
float clearAir(vec3 up) {
    float k = 1.0;
    int n = int(cloudData(${AIR_AT}).x);
    for (int i = 0; i < n; ++i)
        k = min(k, smoothstep(${AIR_CLEAR}.0, ${AIR_CLEAR + HEAP_CELL}.0, R * length(up - cloudData(${AIR_AT} + 1 + i).xyz)));
    return k;
}

vec3 turnAbout(vec3 d, vec3 c, float k) {
    float ck = cos(k), sk = sin(k);
    return d * ck + cross(c, d) * sk + c * dot(c, d) * (1.0 - ck);
}

// The cover's texture (\`fine\` the finer one) drawn out along the wind:
// five reads along \`way\`, over \`len\` metres each way, so what it picks out
// is streaks along the wind some \`len\` long, frayed at their ends, not round
// lumps. (Simplex fbm, not the engine's tiling noise: that one's
// Perlin-Worley is cellular and mostly high, so a share cut from it is
// polygons, the cells' walls, from orbit.) 0 .. 1, its mean a half.
float streaked(vec3 p, vec3 way, float len, int seed, bool fine) {
    float s = 0.0;
    for (int k = -2; k <= 2; ++k) {
        vec3 q = p + way * (0.5 * float(k) * len);
        s += (fine ? cloudFine(q, seed) : cloudTex(q, seed)) * (k == 0 ? 0.28 : (abs(k) == 1 ? 0.22 : 0.14));
    }
    return clamp(0.5 + 0.8 * s, 0.0, 1.0);
}

// The direction the weather's noise is read at: each low turns the air
// about it, most at its heart, so what crosses it winds into a spiral.
// \`spin\`: xyz the way along a tropical cyclone's bands, w how much the
// streaks follow it rather than the wind (1 within its bands).
vec3 swirled(vec3 d, out float heart, out vec4 spin) {
    heart = 0.0;
    spin = vec4(0.0);
    for (int i = 0; i < LOWS; ++i) {
        vec4 a = cloudData(2 * i), b = cloudData(2 * i + 1);
        float s = acos(clamp(dot(d, a.xyz), -1.0, 1.0)) / b.x;
        // (A tropical cyclone's the other way: what is read at the turned
        // direction shows turned back, so its texture wound out the way
        // the air turns, against its bands; turned back, it winds with them.)
        float turn = a.w * exp(-s * s) * (b.z > 0.5 ? -0.5 : 1.0);
        d = turnAbout(d, a.xyz, turn);
        // (A westerly low's heart is its comma's: lowCommas. A tropical
        // cyclone's is its central dense overcast, a bright disc some 0.7
        // of its size across about a small clear eye, and the rain bands
        // leaving it: logarithmic spirals pitched some 20 degrees (so they
        // wind out, not round in rings), two main ones and a fainter third,
        // narrowing, greying and breaking into streaks along themselves
        // as they go out to some 3.5 sizes.)
        float h = 0.4 * exp(-0.5 * s * s);
        if (b.z > 0.0 && s < 4.0) {
            vec3 t1 = normalize(cross(a.xyz, abs(a.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
            vec3 t2 = cross(a.xyz, t1);
            float ang = atan(dot(d, t2), dot(d, t1));
            // (The bands' phase and the disc's rim moved by the engine's
            // noise, some 60 and 25 km, so the storm is ragged cloud, not a
            // clean drawn spiral.)
            vec4 nt = cloudNoise(d * (R / 4.5e5), 1.0 / 64.0);
            vec4 nf = cloudNoise(d.zxy * (R / 1.8e5), 1.0 / 64.0);
            const float K = 1.7;   // 1 / tan of the bands' pitch, past the turn's
            float hs = sign(a.w);
            float psi = ang + hs * K * log(max(s, 0.05)) + 0.9 * (nt.x - 0.5);
            // (The way along a band at d: psi constant, so out by 1 and
            // round by -K, and by the turn's fall with s, 2 s^2 of it.)
            vec3 er = normalize(d - a.xyz * dot(d, a.xyz) + 1e-6 * t1);
            vec3 armWay = normalize(er - hs * (K + 2.0 * s * s * abs(turn)) * cross(a.xyz, er));
            // (The streaks along the bands: the engine's noise read in the
            // spiral's own frame, the phase across a band (8 tiles a turn,
            // so it tiles round) and the log of the distance along it, some
            // 30 km across and hundreds of km along. Five reads along the
            // band's way, streaked(), over a noise finer than their spacing
            // comb out stripes across it, not along.)
            vec4 sn = cloudNoise(vec3(psi * (8.0 / 6.2832), 0.7 * log(max(s, 0.05)), 0.37 + 0.11 * float(i)), 1.0 / 32.0);
            float streak = clamp(1.6 * (0.6 * sn.x + 0.4 * sn.y) - 0.45, 0.0, 1.0);
            float ph = 0.5 + 0.5 * cos(2.0 * psi + 0.8 * (nf.x - 0.5));
            float ph3 = 0.5 + 0.5 * cos(3.0 * psi + 1.7);
            float phase = max(ph, 0.65 * ph3);
            float outer = smoothstep(4.0, 1.8, s + 0.6 * (nf.y - 0.5));
            float width = mix(0.5, 0.8, smoothstep(0.8, 3.2, s));
            float bands = smoothstep(width, width + 0.2, phase + 0.25 * (streak - 0.5)) * outer;
            bands *= smoothstep(0.2, 0.5, streak + 0.35 * (1.0 - smoothstep(1.0, 3.0, s)));
            float bright = mix(0.5, 0.82, streak) * mix(1.0, 0.75, smoothstep(1.5, 3.5, s));
            // (The overcast's rim pushed out where a band leaves it.)
            float rim = 0.75 + 0.35 * ph + 0.2 * (nt.y - 0.5);
            float cdo = smoothstep(rim, rim - 0.25, s);
            float eye = smoothstep(0.07, 0.14, s + 0.04 * (nf.x - 0.5));
            h = mix(h, max(cdo, bands * bright) * eye, b.z);
            float sw = b.z * smoothstep(4.0, 2.8, s);
            if (sw > spin.w) spin = vec4(armWay, sw);
        }
        heart = max(heart, b.y * h);
    }
    return d;
}

// A soft band: 1 within half of \`w\` of its line, 0 from \`w\` on.
float bandOf(float d, float w) { return smoothstep(w, 0.25 * w, d); }

// The westerlies' lows (the extratropical ones, no eye), each a broad
// swirling system, in its frame (x east, y poleward, in its sizes, some
// 1000 to 1600 km; so the south's mirror the north's and turn the other
// way). The head a shield some two and a half sizes across about the
// centre, poleward and west of it, in spiral bands of the air winding in
// (logarithmic, three arms, their width and brightness varied by the
// texture \`t\`), thinner between them, the bands going on thinner past the
// shield; the dry slot a clear arm wrapping in from the south-west to the
// centre. The cold front from the triple point (east and a little
// equatorward of the centre) a band trailing equatorward and west some
// three and a half sizes, a few thousand kilometres, 200 to 400 km wide
// and widening, broken by the texture and fraying toward its tail; the
// warm front's shield poleward of its line, east of the triple point.
// Behind the cold front and under the head the cold air's open cells. x
// the overcast (slabs), y the open cells' share (heaps), z how much of
// either is a low's. \`p\` the point the texture is read at (m), \`f\` the
// showers' noise there (0 .. 1, its mean a half), what breaks the front.
vec3 lowCommas(vec3 d, vec3 p, float f) {
    vec3 best = vec3(0.0);
    float t = cloudNoise(p / 7.0e5, 1.0 / 64.0).x;                       // (some 90 km)
    float t2 = cloudNoise(vec3(p.z, p.y, p.x) / 2.6e5, 1.0 / 64.0).x;    // (some 30 km)
    float tex = 0.65 * t + 0.35 * t2;
    for (int i = 0; i < LOWS; ++i) {
        vec4 a = cloudData(2 * i), b = cloudData(2 * i + 1);
        if (b.z > 0.5) continue;
        vec3 c = a.xyz;
        float cd = dot(d, c);
        if (cd < 0.4) continue;
        float hemi = sign(a.w);
        vec3 north = normalize(vec3(0.0, 1.0, 0.0) - c * c.y);
        vec3 east = cross(c, north);
        vec3 v = (d - c * cd) / cd;   // (on the plane tangent at the low)
        vec2 q = vec2(dot(v, east), dot(v, north) * hemi) / b.x;
        float r = length(q);
        if (r > 4.5) continue;
        float ang = atan(q.y, q.x);
        // The spiral's phase: constant along an arm winding in the way the
        // air turns, its radius falling by e in some 0.6 of a turn.
        float psi = ang + 2.4 * log(max(r, 0.22)) + 5.0 * (t - 0.5);
        float arms = cos(2.0 * psi + 2.5 * (t2 - 0.5));
        float shieldAt = length(q - vec2(-0.15, 0.15));
        float shield = smoothstep(1.45, 0.75, shieldAt);
        float head = shield * mix(0.55, 1.0, smoothstep(-0.4, 0.5, arms)) * mix(0.8, 1.05, tex);
        head = max(head, 0.75 * smoothstep(2.4, 1.2, r) * smoothstep(0.35, 0.85, arms) * smoothstep(0.3, 0.6, tex));
        // The dry slot: the arm through the south-west a size out.
        float dpsi = mod(psi - (-2.1) + 3.1416, 6.2832) - 3.1416;
        float dry = smoothstep(0.75, 0.25, abs(dpsi)) * smoothstep(1.6, 1.0, r) * smoothstep(0.08, 0.25, r);
        head *= 1.0 - 0.95 * dry;
        // The cold front: x(s) = 0.45 - 0.1 s - 0.2 s^2 at y = -0.3 - s.
        float s = clamp(-q.y - 0.3, 0.0, 3.6);
        float slope = -0.1 - 0.4 * s;
        float xf = 0.45 - 0.1 * s - 0.2 * s * s;
        float dist = abs(q.x - xf) / sqrt(1.0 + slope * slope);
        float fray = s / 3.6;
        float w = mix(2.0e5, 4.0e5, fray) / (b.x * R);
        float cold = bandOf(dist, w) * smoothstep(3.6, 2.6, s) * smoothstep(0.2, -0.05, q.y + 0.3);
        // (Broken: cells of cloud a few tens of kilometres across with
        // gaps between, more of them gaps toward the tail and its edges.)
        float brk = 0.55 + 2.2 * (f - 0.5) + 0.35 * (1.0 - dist / w) - 0.45 * fray;
        cold *= mix(0.3, 1.0, smoothstep(0.25, 0.75, brk));
        // The warm front's shield: poleward of its line from the triple
        // point east and a little equatorward, some size deep.
        // (Its line bowed poleward, its far edges an oval about the shield's
        // middle, every edge moved by the texture some tenths of a size, so
        // none is a straight line in the low's frame: a great circle on the
        // globe.)
        float yl = -0.3 - 0.3 * (q.x - 0.45) + 0.12 * (q.x - 0.45) * (q.x - 0.45) + 0.3 * (t - 0.5);
        float yr = q.y - yl;
        vec2 wo = (q - vec2(1.05, yl + 0.45)) / vec2(0.95, 0.75);
        float warm = smoothstep(-0.1, 0.08, yr) * smoothstep(1.05, 0.55, length(wo) + 0.4 * (tex - 0.5)) *
                     smoothstep(0.2, 0.5, q.x + 0.4 * (t2 - 0.5)) * mix(0.7, 1.0, tex);
        warm *= mix(0.45, 1.0, smoothstep(0.3, 0.7, f + 0.3 * (t - 0.5)));
        float over = max(max(cold, head), 0.85 * warm);
        // The cold air behind the front and under the head's tail.
        float behind = smoothstep(0.05, 0.5, xf - q.x) * smoothstep(-0.4, 0.3, -q.y) * smoothstep(4.4, 3.0, r);
        best = max(best, vec3(over, 0.6 * max(behind, 0.6 * dry), smoothstep(4.5, 3.0, r)));
    }
    return best;
}

// The direction the weather's shapes are read at: bent by the engine's
// noise (two turned tiles, some 1500 and 400 km) a few hundred kilometres
// and less, so no front or deck has a ruled edge.
vec3 cloudBent(vec3 d) {
    vec3 p = d * R;
    vec4 a = cloudNoise(p / 1.5e6, 1.0 / 16.0);
    vec4 b = cloudNoise(vec3(p.z, p.x, p.y) / 4.1e5, 1.0 / 16.0);
    vec3 e = normalize(cross(vec3(0.0, 1.0, 0.0), d) + 1e-5);
    vec3 n = cross(d, e);
    vec2 m = 0.035 * (a.yz - 0.5) + 0.012 * (b.yz - 0.5);
    return normalize(d + e * m.x + n * m.y);
}

// How much land lies east of \`up\` within some 25 degrees, the nearer
// weighing the more, and a little north and south of the line east: where
// a subtropical ocean's cold eastern side lies. Smooth (a mean, not the
// nearest coast's line), so a deck fades out westward.
float landEast(vec3 up) {
    vec3 e = normalize(cross(up, vec3(0.0, 1.0, 0.0)) + 1e-5);
    vec3 nn = cross(e, up);
    float sum = 0.0, wsum = 0.0;
    for (int k = 1; k <= 16; ++k) {
        float t = 0.027 * float(k), wk = exp(-0.18 * float(k));
        for (int j = -1; j <= 1; ++j) {
            vec3 dk = normalize(up * cos(t) + e * sin(t) + nn * (0.04 * float(j)));
            // (Land and the shelf sloping off it: the sea's depth is smooth
            // where the coast's line is the grid's texels.)
            sum += wk * smoothstep(-3000.0, 0.0, cloudLandGrid(1, dk).x);
            wsum += wk;
        }
    }
    return smoothstep(0.03, 0.5, sum / wsum);
}

// The way the low air blows at \`up\` (unit, on the plane tangent there): a
// line from the south-west to the north-east in the north (the trades
// blowing down it toward the equator, the westerlies up it toward the
// pole), its mirror in the south; east as the lows' frames have it.
vec3 windWay(vec3 up) {
    vec3 north = normalize(vec3(0.0, 1.0, 0.0) - up * up.y + vec3(1e-5, 0.0, 0.0));
    vec3 east = cross(up, north);
    return normalize(east + north * 0.3 * sign(up.y));
}

vec4 cloudCover(vec3 up) {
    vec4 g = cloudLandGrid(1, up);
    float lat = asin(clamp(up.y, -1.0, 1.0)), al = abs(lat);
    float heart;
    vec4 spin;
    vec3 bent = cloudBent(up);
    vec3 w = swirled(bent, heart, spin);
    vec3 p = w * R;
    // The belts' latitudes wander, by some 5 degrees each way over a few
    // thousand kilometres, so no belt's edge is a parallel.
    vec4 mw = cloudNoise(bent * (R / 1.7e6), 1.0 / 16.0);
    float wander = 0.16 * (mw.x - 0.5) + 0.08 * (mw.y - 0.5);
    al = al + wander * smoothstep(0.05, 0.25, al);
    // The westerlies draw the weather out east and west.
    float storm = smoothstep(0.62, 0.8, al) * (1.0 - smoothstep(1.05, 1.22, al));
    float n = cloudWeather(p * vec3(1.0, 1.0 + 0.8 * storm, 1.0), 31) * 0.5 + 0.5;
    float f = cloudShowers(p, 32) * 0.5 + 0.5;
    float sea = smoothstep(10.0, -40.0, cloudLandGrid(0, up).x);
    float wet = max(g.w, 0.6 * sea);
    // Where the weather's systems are broken up (the rain belt's clusters,
    // the decks' extent): the engine's soft billows, some 1200 and 2400 km
    // a tile, so what they pick out is hundreds of kilometres across with
    // soft edges, never the showers' finer octaves' speckle.
    vec4 m1 = cloudNoise(p / 1.2e6, 1.0 / 16.0);
    vec4 m2 = cloudNoise(vec3(p.y, p.z, p.x) / 2.4e6, 1.0 / 16.0);
    // The rain belt: a narrow line a few degrees north of the equator,
    // wandering, broken into clusters of towers and their anvils.
    // (Its line wanders some 4 degrees each way and its width with it; clear
    // sky between the clusters, so it is no ruled band along a parallel.)
    float itczLat = 0.08 + 0.07 * (n - 0.5) + 0.14 * (m2.y - 0.5);
    float itcz = exp(-pow((lat - itczLat) / (0.05 * mix(0.7, 1.4, m1.y)), 2.0));
    // The texture every system is read through, along the wind (and wound
    // into a low's spiral, read at its swirled direction): how thick the
    // cloud is, some 350 km down to 25 km, so a system is bright cores grading
    // through thin grey cloud to clear, never one white level; \`edge\` the
    // streaks a system's margin frays into.
    // (In a tropical cyclone, along its bands: a storm's texture streaked
    // east and west combed its bands across.)
    // (A streak has no sense: the band's way turned to the wind's side.)
    vec3 way = windWay(up);
    way = normalize(mix(way, spin.xyz * (dot(spin.xyz, way) < 0.0 ? -1.0 : 1.0), spin.w) + 1e-5 * up);
    float thick = streaked(p, way, 2.5e5, 51, false);
    float edge = streaked(p, way, 1.2e5, 52, false);
    // (Its clusters some 150 to 300 km, round towers' anvils spread a
    // little along the wind, clear sky between.)
    float clusters = smoothstep(0.5, 0.85, 0.6 * (0.5 + 0.5 * cloudTex(p, 53)) + 0.4 * thick);
    float rain = itcz * mix(0.05, 1.0, clusters) * mix(0.6, 1.0, wet);
    // The subtropics' highs: clear, but for the trades' cumulus over the
    // sea and the decks of stratocumulus on the oceans' cold eastern sides
    // (land to the east), thinning westward into the trades.
    float subtrop = exp(-pow((al - 0.47) / 0.17, 2.0));
    float tropics = 1.0 - smoothstep(0.45, 0.62, al);
    // (The trades' cumulus in streets along the wind, some tens of
    // kilometres apart, thinner toward the highs' clear middles.)
    float streets = streaked(p, way, 1.5e5, 54, true);
    float trades = sea * tropics * (0.16 + 0.14 * (m1.x - 0.5) + 0.05 * (f - 0.5)) * (1.0 - 0.6 * itcz) *
                   mix(0.2, 1.8, streets * streets) * mix(0.5, 1.0, smoothstep(0.55, 0.3, subtrop));
    // (The decks lie close off the coasts with much land to their east, in
    // patches a thousand kilometres and more across, not as a sheet over
    // the whole subtropical sea; downwind, toward the equator, they break
    // into streaks and then the trades' streets.)
    float sc = sea * smoothstep(0.17, 0.3, al) * (1.0 - smoothstep(0.55, 0.7, al)) * smoothstep(0.6, 0.95, landEast(up)) *
               smoothstep(-0.05, 0.45, cloudWeather(p, 55) + 0.4 * (edge - 0.5));
    // (Its closed cells some 40 km, dense polygons that from orbit are the
    // deck's texture.)
    float closed = smoothstep(0.2, 0.6, cloudNoise(p / 1.6e5, 1.0 / 16.0).y);
    sc *= mix(0.3, 1.0, thick) * mix(0.6, 1.0, closed) * smoothstep(0.0, 0.5, sc + 0.5 * (edge - 0.5));
    // The storm tracks: the lows' commas, and between them broken weather
    // where the noise lifts it.
    vec3 lows = lowCommas(bent, p, f);
    float track = storm * (1.0 - 0.7 * lows.z);
    float broken = track * smoothstep(0.55 - 0.12 * sea, 1.05, n + 0.3 * (m1.x - 0.5)) * 0.75;
    float polar = smoothstep(1.2, 1.38, al) * smoothstep(0.35, 0.65, n) * 0.65;
    // The tropical cyclones' and the lows' hearts.
    float hearts = smoothstep(0.25, 0.7, heart);
    // (Each thinned and parted here and there, a few hundred kilometres
    // and less: an overcast's texture from afar, its breaks near. The lows
    // carry their own.)
    float grain = clamp(0.82 + 0.6 * (f - 0.5) + 0.3 * (m1.x - 0.5), 0.0, 1.0);
    float over = max(lows.x, max(broken, max(polar, hearts)) * grain);
    // How thick it is: where a system is thickest (a front's core, a low's
    // head, an eyewall) bright, its margins and its broken weather as thin
    // as the texture says, from white through grey to clear; the margins
    // frayed into streaks along the wind, never a smooth or cell-cut edge.
    float core = smoothstep(0.6, 0.95, over);
    over *= mix(mix(0.3, 1.1, thick), 1.0, 0.55 * core);
    over *= smoothstep(0.0, 0.45, over + 0.6 * (edge - 0.5));
    // The cold air over the storm tracks' seas, about and behind the lows:
    // open cells, cumulus on the rims of cells some 50 km across with clear
    // air in their middles, a honeycomb veil from afar; streaked along the
    // wind as the cold air pours out over the sea.
    float honey = smoothstep(0.3, 0.75, 1.0 - cloudNoise(p / 2.2e5, 1.0 / 128.0).y);
    // (Between the lows only where the noise brings an outbreak of it,
    // patches some thousand kilometres, clear sea between.)
    float outbreak = smoothstep(-0.05, 0.3, cloudWeather(p, 56) + 0.3 * (edge - 0.5));
    float coldAir = max(lows.y * sea, storm * sea * 0.45 * outbreak);
    coldAir = min(coldAir * mix(0.3, 1.25, honey) * mix(0.45, 1.25, edge), 0.65);
    // Fair weather's cumulus over temperate land that is not dry: the
    // summer afternoon's fields of them, the sky between.
    // (By the land's wetness over some 400 km, not the point's, and thinning
    // toward the coast over some 150 km: by the point's, which is wet only
    // near a coast, the fields lay as a band tracing every coast, cut at
    // its line.)
    vec3 e1 = normalize(cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(up, e1);
    float lw = 0.25 * g.w * (1.0 - sea), ln = 0.25 * (1.0 - sea), near = 0.0;
    for (int k = 0; k < 12; ++k) {
        float a = 0.5236 * float(k);
        bool inner = (k & 1) == 0;
        vec3 x = normalize(up + (e1 * cos(a) + e2 * sin(a)) * ((inner ? 1.5e5 : 4.0e5) / R));
        float l = smoothstep(-40.0, 10.0, cloudLandGrid(0, x).x);
        lw += l * cloudLandGrid(1, x).w;
        ln += l;
        if (inner) near += l / 6.0;
    }
    float fair = (1.0 - sea) * mix(0.35, 1.0, near) * smoothstep(0.25, 0.6, lw / max(ln, 1e-3)) *
                 smoothstep(0.3, 0.5, al) * (1.0 - smoothstep(0.95, 1.15, al));
    // The heaps' fields organised at the mesoscale: in streets along the
    // wind some 15 to 30 km apart (the noise averaged along the wind over
    // some 200 km) and in patches some 50 to 150 km across, crowded in some
    // and thin to clear in others, so a field seen from tens of kilometres
    // up is lanes and clusters with clear ground between, never an even
    // carpet to the horizon. (Its mean about 1: the field's share as before.)
    float lanes = 0.0;
    for (int k = -2; k <= 2; ++k)
        lanes += cloudNoise((p + way * (5.0e4 * float(k))) / 1.2e5, 1.0 / 64.0).y * (k == 0 ? 0.28 : (abs(k) == 1 ? 0.22 : 0.14));
    float patches = cloudNoise(vec3(p.z, p.x, p.y) / 3.5e5, 1.0 / 64.0).x;
    float meso = clamp(smoothstep(0.3, 0.75, lanes) * 1.1 + 0.25, 0.0, 1.35) * mix(0.35, 1.5, smoothstep(0.35, 0.7, patches));
    float heaps = max(max(trades, coldAir) * mix(0.6, 1.0, meso / 1.4), max(0.52 * fair * (0.7 + 0.8 * (f - 0.5)) * meso, 0.6 * rain));
    // The slabs: the fronts, the hearts, the broken weather, the decks and
    // the rain belt's anvils; the heaps in the sky they leave.
    float slabs = max(max(over, 0.9 * sc), rain * clusters * mix(0.6, 1.05, thick));
    float cover = slabs + heaps * (1.0 - slabs);
    // Heaped where the air is convective (the rain belt, the trades, fair
    // weather, the cold air's cells): the share of the cover the heaps are
    // (so a deck's edge into the trades blends, never switches), and the
    // rain belt's towers.
    float convect = clamp(heaps * (1.0 - slabs) / max(cover, 1e-3) + rain * 0.4, 0.0, 1.0);
    // How high the tops reach: the rain belt's towers, the trades' and
    // fair weather's low cumulus, a front's thick nimbostratus, the
    // stratocumulus' thin deck.
    float towers = clamp(rain * 1.3 + 0.2 * (f - 0.5), 0.0, 1.0);
    float tops = mix(0.4 + 0.3 * max(hearts, lows.x), mix(0.2, 0.95, towers), convect);
    float cells = sc * (1.0 - over);
    tops = mix(tops, 0.12, cells);
    return vec4(cover, convect, tops, cells);
}

vec3 heapHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
}

// How far (m) a point v (m, from the ellipsoid's centre: horizontal x,
// vertical y) is inside an ellipsoid of half-axes r across and hgt up,
// at most (negative: outside); it changes no faster than the distance does.
float ellipsoidIn(vec2 v, float r, float hgt) {
    return (1.0 - length(v / max(vec2(r, hgt), 1.0))) * max(min(r, hgt), 1.0);
}

// The heaps: a cumulus in some of the cells of the engine's lattice
// (setClouds' heaps.cell, HEAP_CELL metres: sky/cloud_heaps.glsl), so the
// heap a view from orbit's edge sees is the heap flown through. Its base
// BASE_SHARP times as steep as its walls (the bases flat: the engine's skin
// moves them little).
const float CLOUD_EDGE = ${CLOUD_EDGE}.0;
const float HEAP_CELL = ${HEAP_CELL}.0;
const float HEAP_SHELL = 0.35;   // (twice it) the share of cells that may hold a heap, as many as the old 3D lattice's shell held
const float BASE_SHARP = 3.0;
const float BASE_SPREAD = 80.0;  // how much the heaps' bases differ (m), about the field's
// (Many small and a few large, as a field's sizes run: from afar the small
// ones a faint grain between the large, not one size of white dots.)
const float HEAP_SMALL = 0.25, HEAP_BIG = 1.4, HEAP_SKEW = 2.5;   // a heap's size (of the cover's), u^HEAP_SKEW between
const float HEAP_SIZE2 = 0.42;   // the mean of its square, as drawn (the largest cut to the cell's reach)
const float HEAP_CLUMP_MOST = 1.7;   // how much more of the heaps a clump holds at most
const float HEAP_SEEN = 0.25;   // the share of its outline's ellipse a heap covers as drawn (its rim the billows', its towers within)
const float BROKEN_TILE = 16000.0;   // the slabs' rafts: the billow noise's tile (m)
const float BROKEN_RISE = 800.0;     // and metres of the slab's edge a unit of the noise
const float BROKEN_LEAST = 600.0;    // the finest of the noise's detail the rafts are cut by (m)
#define CLOUD_HEAPS
// The deck about a body point (drifted), over a footprint: the cover as
// the fields have it there (the decks' closed cells, the fields' clusters),
// how heaped it is, and the base and tops (m up the deck). One code for the
// heaps the engine asks for and the share the far deck reads, so they agree.
void deckAt(vec3 p, vec4 cover, float footprint, out float c, out float wHeap, out float zb, out float zt) {
    const float DECK = ${CLOUD_TOP - CLOUD_BOTTOM}.0;
    // The mesoscale, 160 km a tile: the decks' closed cells (40 km, their
    // rims clear) and the bases' slow rise and fall from place to place.
    const float TM = 160000.0;
    vec4 meso = cloudNoise(p / TM, footprint / TM);
    // The base: a few hundred metres over the deck's bottom, higher or
    // lower region by region (so a far field's bases are no ruled line).
    float base = 0.01 + 0.08 * meso.z;
    float top = base + max(cover.z, 0.06) * (1.0 - base);
    float convect = cover.y, cells = cover.w;
    // (Over a footprint as wide as the cells, their mean: a sheet as grey
    // as they cover, never cut square by the mip's mean of them.)
    float wide = smoothstep(2000.0, 12000.0, footprint);
    c = cover.x * mix(1.0, mix(smoothstep(0.25, 0.55, meso.y), 0.7, wide), cells);
    c = min(c * mix(1.0, 0.75 + 0.5 * meso.x, convect * (1.0 - cells)), 1.0);
    // Heaped where the air is convective; in slabs (a front's, a low's
    // heart, a deck) where it is not.
    wHeap = smoothstep(0.1, 0.35, convect);
    zb = base * DECK;
    zt = top * DECK;
}

// The heap a cell of the engine's lattice holds, where the cover says
// there is one (and the heaps clump): half an ellipsoid on a flat base
// with two towers on it, as wide as the cover is full (and its own size,
// most small and a few large) and as tall as the tops reach (each its own;
// towers only where the tops are high), shrinking to nothing as the cover
// thins (none cut off); and a fragment beside it where the cover is fuller.
float heapClump(vec3 up, float footprint) {
    const float rb = R + ${CLOUD_BOTTOM}.0;
    // (Over the footprint, never finer than a 64th of its tile: read finer
    // by a far view's share, its lumps were a salt-and-pepper grain. And a
    // coarser noise of another channel over it, 41 km a tile: one noise's
    // gaps, as even as its lattice, were a net of holes over a far field.)
    float n = 0.6 * cloudNoise(up * (rb / 14000.0), max(footprint / 14000.0, 1.0 / 64.0)).x +
              0.4 * cloudNoise(up * (rb / 41000.0), max(footprint / 41000.0, 1.0 / 64.0)).y;
    return clamp(1.0 + 2.2 * (n - 0.62), 0.25, HEAP_CLUMP_MOST);
}
bool cloudHeap(CloudHeapCell cl, out CloudHeap h) {
    const float rb = R + ${CLOUD_BOTTOM}.0;
    float cover, wHeap, base, tops;
    deckAt(cl.up * rb, cl.cover, 0.0, cover, wHeap, base, tops);
    vec3 a = cl.hash;
    float clear = clearAir(cl.up);
    float present = smoothstep(0.0, 0.6, cover) * clear;
    // The heaps clump: a noise some 14 km a tile (its lumps a few
    // kilometres) raises and lowers how many stand, so they gather in
    // groups with wide gaps of clear sky between, not a lattice's even
    // spread. (Its mean leaves the share as the cover says; HEAP_SHELL the
    // share of cells that may hold one, as the old lattice's shell kept.)
    float clump = heapClump(cl.up, 0.0);
    float grow = smoothstep(a.x, a.x + 0.15, present * clump * 2.0 * HEAP_SHELL) * wHeap;
    if (grow <= 0.0) return false;
    vec3 b = heapHash(vec3(cl.id) + 17.31), f = heapHash(vec3(cl.id) + 5.13);
    float tall = smoothstep(0.25, 0.9, tops / ${CLOUD_TOP - CLOUD_BOTTOM}.0);
    // Its size: most heaps small, a few large (HEAP_SMALL .. HEAP_BIG of
    // the cover's, skewed to the small); the small ones flat (humilis),
    // the large taller than wide where the tops reach (mediocris).
    float sz = mix(HEAP_SMALL, HEAP_BIG, pow(a.y, HEAP_SKEW));
    float szn = clamp(sz / HEAP_BIG, 0.0, 1.0);
    // (By the cell's own width: the engine's cells are equal-angle, down to
    // 0.71 of HEAP_CELL near a face's edge, and nothing of a heap may lie
    // more than that from its middle.)
    const float cell = cl.side;
    float r = cell * mix(0.42, 0.55, cover) * sz;
    // (No wider than twice its height and a little: a low heap a small
    // dome, never a pancake whose rim thins to a sliver.)
    float hgt = min((tops - base) * mix(0.5, 1.0, a.z) * mix(0.45, 1.0, szn), r * mix(0.8, 2.6, tall) * mix(0.6, 1.0, szn));
    r = min(r, 2.0 * hgt + 120.0) * grow;
    hgt *= grow;
    // Its foot anywhere within 0.35 of a cell of the cell's middle (so the
    // field is no lattice of evenly spaced domes: a heap off its middle is
    // the smaller for it), and nothing of it more than a cell from there
    // (the engine searches the cells about a point that far).
    vec2 foot = (b.xy - 0.5) * 0.7 * cell;
    // (Its towers reach 1.25 of its radius from its foot: 0.7 of it off,
    // 0.55 of it wide.)
    float reach = cell - length(foot);
    r = min(r, reach / 1.3);
    // Its base: the field's condensation level, a few tens of metres off
    // it, cut flat; the dome's middle under it, so its walls rise steep
    // from the base's rim and the whole heap stands over every point of
    // the base (no thin rim the sun lights through).
    float zh = base + BASE_SPREAD * (f.x - 0.5);
    // The body a little smaller than the heap, and the towers out over its
    // rim, so seen from above its outline is lobed, a cauliflower's, not
    // the body's circle with bumps on it. (Towers within the body's rim
    // drew every heap from above as a disc; out to 0.7 of the radius their
    // part past the rim makes up the body's: the heap covers as much.)
    h.lobe[0] = vec4(foot, 0.82 * r, 1.4 * hgt);
    h.middle.x = -0.4 * hgt;
    // The towers: two over the body, on opposite sides more or less, each
    // its own way off its middle, its own size and height, so no two heaps
    // share a silhouette (the engine's turrets crown them).
    float ang0 = 6.2832 * b.z;
    for (int k = 0; k < 2; ++k) {
        vec3 t = fract(b.zxy * vec3(7.13, 3.71, 5.37) * float(k + 1) + a.zxy);
        float ang = ang0 + 3.1416 * float(k) + 1.6 * (t.x - 0.5);
        vec2 o = vec2(cos(ang), sin(ang)) * mix(0.45, 0.7, t.y) * r;
        h.lobe[1 + k] = vec4(foot + o, mix(0.4, 0.55, t.z) * r, mix(0.5, 0.8, t.y) * hgt);
        h.middle[1 + k] = mix(0.2, 0.55, t.z) * hgt;
    }
    h.base = vec4(zh);
    // A fragment beside it where the cover is fuller (as the heaps clump):
    // a small flat heap off its side, close or a little apart, as large as
    // a second heap where the cover is full; on its own base, a few tens of
    // metres off the heap's.
    float fg = smoothstep(f.y, f.y + 0.15, smoothstep(0.15, 0.7, cover) * clump * clear) * wHeap;
    h.lobe[3] = vec4(0.0);
    h.middle.w = 0.0;
    if (fg > 0.0) {
        float rs = cell * mix(0.42, 0.55, cover) * mix(0.3, 0.6, f.z) * mix(1.0, 1.9, smoothstep(0.4, 0.9, cover)) * fg;
        float hs = min(rs * mix(0.6, 1.2, tall), (tops - base) * 0.6) * fg;
        float ang = 6.2832 * fract(13.7 * f.z + b.z);
        vec2 o = foot + vec2(cos(ang), sin(ang)) * (r + rs * mix(0.2, 1.4, fract(7.3 * f.y)));
        // (Kept within the cell's reach.)
        float lo = length(o);
        if (lo + rs > cell) o *= max(cell - rs, 0.0) / lo;
        h.lobe[3] = vec4(o, rs, 1.4 * hs);
        h.middle.w = -0.4 * hs;
        h.base.w = base + BASE_SPREAD * (fract(5.1 * f.x) - 0.5);
    }
    return true;
}

// The share of the air the heaps fill at \`z\` metres up the deck, on the
// mean (what the far deck reads: as cloudHeap makes them), rising over the
// first 300 m from their bases; under 0 below and above them, by how far.
float heapsShare(float z, float base, float tops, float cover, float clump) {
    float tall = smoothstep(0.25, 0.9, tops / ${CLOUD_TOP - CLOUD_BOTTOM}.0);
    float r = HEAP_CELL * mix(0.42, 0.55, cover) * sqrt(HEAP_SIZE2);
    float hgt = max(min((tops - base) * 0.75 * 0.8, r * mix(0.8, 2.6, tall) * 0.85) * 1.1, 300.0);
    // (The share of cells holding one, as cloudHeap grows them: the clump's
    // too, so a far field keeps the groups and the gaps its heaps make.)
    float n = min(2.0 * HEAP_SHELL * smoothstep(0.0, 0.6, cover) * clump, 1.0);
    // (A fragment's mean square, of the cover's size, 0.21 and up to 1.9^2
    // as much where the cover is full: as a share of a heap's.)
    float frag = 0.21 * pow(mix(1.0, 1.9, smoothstep(0.4, 0.9, cover)), 2.0) * smoothstep(0.15, 0.7, cover) / HEAP_SIZE2;
    // (A heap's outline from above about its radius's circle: the body at
    // 0.82 of it, the towers' parts past the body's rim making up the rest.)
    float area = 3.1416 * r * r / (HEAP_CELL * HEAP_CELL) * (1.0 + frag);
    // (What they cover seen from above or below, s0, as the engine draws a
    // share: opaque heaps a view crosses in 600 m (its
    // cloudHeapsShareSigma), here stacked over the profile's height, whose
    // mean is about 0.6 of hgt: a column of shares s covers 1 - (1 - s)^(0.6
    // hgt / 600) of what is under it, so s at the profile's most is the one
    // that makes that s0.)
    float s0 = 1.0 - exp(-n * area * HEAP_SEEN);
    float s = 1.0 - pow(1.0 - s0, max(1000.0 / hgt, 1.0));
    float zr = z - base, hr = zr / hgt;
    if (zr < 0.0) return zr * BASE_SHARP / CLOUD_EDGE;
    if (hr > 1.0) return (hgt - zr) / CLOUD_EDGE;
    return min(s * zr / 300.0, s * (1.0 - hr * hr));
}

// The heaps' share of the air at a point, over its footprint (the engine
// reads it where they are finer than that): as heapsShare has it, and
// some, however little, wherever a heap may stand (up from a little under
// the bases to the towers' most, 1.4 times the tops' reach), so the
// engine's bounds never pass one by.
float cloudHeapsShare(CloudPoint q) {
    if (q.cover.x < 0.01) return 0.0;
    const float DECK = ${CLOUD_TOP - CLOUD_BOTTOM}.0;
    float c, wHeap, zb, zt;
    vec3 pd = cloudDrift(q.p);
    deckAt(pd, q.cover, q.footprint, c, wHeap, zb, zt);
    if (wHeap <= 0.0) return 0.0;
    float z = q.height * DECK;
    float s = heapsShare(z, zb, zt, c, heapClump(normalize(pd), q.footprint)) * wHeap;
    bool may = z > zb - BASE_SPREAD && z < zb + 1.4 * (zt - zb) + 200.0;
    return may ? max(s, 1e-3) : min(s, -1e-3);
}

// The base: where the footprint is finer than the clouds, a front's or a
// deck's slab with its own relief, rising from none to all over CLOUD_EDGE
// metres across its surface; where it is wider, the share of the air the
// slabs fill there. (The heaps are the engine's lattice's: cloudHeap,
// cloudHeapsShare.)
float cloudDensity(CloudPoint q) {
    if (q.cover.x < 0.01) return 0.0;
    const float DECK = ${CLOUD_TOP - CLOUD_BOTTOM}.0;
    // (Carried by the wind, as the engine's forms are.)
    vec3 p = cloudDrift(q.p);
    float c, wHeap, zb, zt;
    deckAt(p, q.cover, q.footprint, c, wHeap, zb, zt);
    float z = q.height * DECK;
    // The slabs are broken where a system thins (a front's margins, a
    // deck's edge): rafts of cloud some 2 to 5 km across where the engine's
    // billow noise (x, BROKEN_TILE a tile) is over a threshold, set so that
    // over the tile they cover the system's share exactly (\`share\`: the
    // contrast from orbit, solid in a system's core and none at its fringe).
    // Over any footprint the share of rafts is read from the noise's mean
    // and spread there (its mip's x and w), so the deck seen from afar is
    // the rafts' mean at every distance: one cloud field, never a near one
    // that is clear where the far one is grey. (Logistic for the normal's
    // CDF, both ways, so the tile's share is the system's to the bit.)
    float share = smoothstep(0.2, 0.8, c);
    vec3 pb = p / BROKEN_TILE;
    vec4 n0 = cloudNoise(pb, 1.0);
    float s0 = sqrt(max(n0.w - n0.x * n0.x, 1e-6));
    float sc = clamp(share, 1e-3, 1.0 - 1e-3);
    float t = n0.x - s0 * log(sc / (1.0 - sc)) / 1.702;
    vec4 nf = cloudNoise(pb, q.footprint / BROKEN_TILE);
    float sf = sqrt(max(nf.w - nf.x * nf.x, 0.0) + 1e-4);
    float rafts = share <= 1e-3 ? 0.0 : (share >= 1.0 - 1e-3 ? 1.0 : 1.0 / (1.0 + exp(-1.702 * (nf.x - t) / sf)));
    // From afar: the share of the air the rafts fill (a slab cut nearly
    // square, its top a little ragged on the mean), under 0 below and over
    // them, by how far.
    float slabFar = rafts * min(min((z - zb) / 500.0, (zt - z) / 600.0), 1.0);
    float far = slabFar * (1.0 - wHeap);
    float fn = smoothstep(0.15 * HEAP_CELL, 0.6 * HEAP_CELL, q.footprint);
    if (fn >= 1.0) return far;
    // Near: the shapes. The slab's top heaves in lumps a few kilometres
    // across and over a kilometre high (the engine's noise sixteen edges a
    // tile, 0.8 edges high: so the engine lights an overcast's top seen
    // from afar as it is shaped, clouds.frag's clTopShade), its base less;
    // where the system is broken it parts into its rafts (the noise over
    // the threshold, by BROKEN_RISE metres a unit of it: no faster than the
    // contract's fifth across).
    vec4 relief = cloudNoise(p / (16.0 * CLOUD_EDGE), q.footprint / (16.0 * CLOUD_EDGE));
    float st = zt - 0.8 * CLOUD_EDGE * relief.x - 250.0 * relief.z;
    float sb = zb + 150.0 * relief.y;
    // (The rafts' shape without the noise's octaves finer than BROKEN_LEAST:
    // the engine's billows and detail are a raft's finer shape, and the
    // edge rises slowly enough for the march to step by.)
    float nx = cloudNoise(pb, max(q.footprint, BROKEN_LEAST) / BROKEN_TILE).x;
    float across = share >= 1.0 - 1e-3 ? 3000.0 : (share <= 1e-3 ? -3000.0 : (nx - t) * BROKEN_RISE);
    float slab = min(min((z - sb) * BASE_SHARP, st - z), across);
    float sd = slab - 3000.0 * wHeap;
    // (Under 0 in the clear air, by how far the nearest cloud is, which the
    // engine's march steps by.)
    return mix(min(0.5 + sd / CLOUD_EDGE, 1.0), far, fn);
}
`;
// (The clouds drift east, and a little north, at some 10 m/s.)
export const WIND = [9, 0, -3];
const setDeck = (air) => scene.setClouds({
    module: CLOUDS, bottom: CLOUD_BOTTOM, top: CLOUD_TOP, data: LOWS.concat([air.length, 0, 0, 0], ...air.map((d) => [d[0], d[1], d[2], 0])), land,
    forms: { extinction: 0.06, billowScale: 2400, detailScale: 1200, edge: CLOUD_EDGE },
    heaps: { cell: HEAP_CELL },
    wind: WIND,
    enabled: !((bro.app && bro.app.argv) || []).includes('noclouds') });
setDeck([]);

// A scene that needs room: no plants within PAD_OPEN m of each of `pads`
// (body directions), thinning back in by PAD_OPEN + PAD_EDGE; no heap
// within AIR_CLEAR of each of `air` (body points, each with the wind
// clock's time `t` it is to be clear at: [x, y, z, t]), at most AIR_MOST
// of them. The flight's lift-off and landing, and the air it climbs and
// comes down through, made so rather than searched for.
const PAD_OPEN = 120, PAD_EDGE = 120;
export function keepClear({ pads = [], air = [] }) {
    let open = null;
    for (const d of pads) {
        // (The plants' fields are read at their point on the datum.)
        const dist = N('DistanceToPoint', { 'Distance Function': 'Euclidean', 'Point X': d[0] * R, 'Point Y': d[1] * R, 'Point Z': d[2] * R });
        const k = clamp01(affine(dist, 1 / PAD_EDGE, -PAD_OPEN / PAD_EDGE));
        open = open ? N('Min', { LHS: open, RHS: k }) : k;
    }
    plants.setPlants({ rules: plantRules(open) });
    if (air.length > AIR_MOST) throw new RangeError(`keepClear: ${air.length} points of air, at most ${AIR_MOST}`);
    // (Each where its air will have drifted from by its time: the heaps'
    // cells are the drifted frame's.)
    setDeck(air.map(([x, y, z, t]) => {
        const p = [x - WIND[0] * t, y - WIND[1] * t, z - WIND[2] * t], l = Math.hypot(p[0], p[1], p[2]);
        return p.map((v) => v / l);
    }));
}

// --- views ---------------------------------------------------------------------------

// A place point `up` over the ground at place (x, z).
const over = (x, z, up) => [x, land.landHeight(x, z) + up, z];
// The body's centre in the place frame.
const centre = () => scene.toPlace([0, 0, 0]);
// The way to the highest ground within 60 km of the place's origin (unit, xz).
function towardRange() {
    let best = -Infinity, way = [0, -1];
    for (let k = 0; k < 48; k++) {
        const a = k / 48 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        for (const r of [20000, 40000, 60000]) {
            const x = r * c, z = r * s;
            // (The ground's height over the datum: the place's y less the curve's drop.)
            const h = land.landHeight(x, z) + (x * x + z * z) / (2 * R);
            if (h > best) { best = h; way = [c, s]; }
        }
    }
    return way;
}
const along = (w, d, up) => over(w[0] * d, w[1] * d, up);
export const SHOTS = {
    orbit:  { label: 'Orbit', near: 1e5, far: 6e7, eye: () => [0, 1.8e7, 0], look: centre, up: [0, 0, -1] },
    limb:   { label: 'Limb', near: 1e3, far: 2e7, eye: () => [0, 1.2e6, 0], look: () => [0, -2.4e5, -1.6e6] },
    region: { label: 'Region', near: 50, far: 4e6, eye: () => [0, 9e4, 0], look: () => [0, 0, -2.4e5] },
    low:    { label: 'Low', near: 1, far: 1e6, eye: () => over(0, 0, 1500), look: () => along(towardRange(), 30000, 0) },
    ground: { label: 'Ground', near: 0.1, far: 4e5, eye: () => over(0, 0, 1.8), look: () => along(towardRange(), 2000, 60) },
    sky:    { label: 'Sky', near: 0.1, far: 4e5, eye: () => over(0, 0, 1.8), look: () => along(towardRange(), 2000, 900) },
};

// (`shot`: the shot the held view is, while it is one; `ground`: whether
// the ground under the eye was in when it was placed.)
export const still = { view: null, shot: null, ground: false };
export function holdView(eye, look, near, far, up = [0, 1, 0]) {
    still.view = { eye, look, near, far, up };
    still.shot = null;
}
// A shot is the place at START's: back there first, wherever a drag took
// the place since.
export function setShot(name) {
    const s = SHOTS[name];
    if (!s) return;
    ctl.setMode('orbit');
    scene.reanchorAt(START);
    holdView(s.eye(), s.look(), s.near, s.far, s.up);
    still.shot = name;
    still.ground = !!land.landStats()?.groundReady;
}
// A shot stands on the ground's heights as they were when it was placed,
// and the land's regional levels blend into them as they come in about the
// eye (landHeight's answer moves): a held shot is placed again each time
// the ground under the eye comes in, so it settles standing on the ground
// as drawn, however early it was asked for.
vp.onFrame(() => {
    if (!still.view || !still.shot) return;
    const ready = !!land.landStats()?.groundReady;
    if (ready && !still.ground) setShot(still.shot);
    else still.ground = ready;
});
// Let go of a held shot: the orbit camera takes over where it is, turning
// about what it looked at.
export function letGo() {
    const v = still.view;
    if (!v) return;
    still.view = null;
    Camera.orbitFromView(vp.cam, { position: v.eye, target: v.look, up: v.up, near: v.near, far: v.far });
}
// The orbit camera and a held view move with the place when it re-anchors
// (the view is pushed again every frame, a re-anchor's frame included).
scene.addEventListener('reanchor', (e) => {
    Camera.orbitMove(vp.cam, e);
    const v = still.view;
    if (v) v.eye = e.apply(v.eye), v.look = e.apply(v.look), v.up = e.turn(v.up);
});
// The ground's height over the datum under a place point (under 0: the sea).
const groundUnder = (pos) => land.landHeight(pos[0], pos[2]) + (pos[0] ** 2 + pos[2] ** 2) / (2 * R);
// The eye's height over the ground (or the sea) under it.
function eyeHeight(pos) {
    const ground = Math.max(groundUnder(pos), 0);
    const b = scene.toBody(pos);
    return Math.hypot(b[0], b[1], b[2]) - R - ground;
}

// Walking and flying (lib/kit/planetcam.js), beside the orbit camera: F
// cycles walk, fly and orbit; a view button holds its shot in orbit again.
export const ctl = planetController(vp.canvas, scene, {
    altitude: eyeHeight,
    water: (pos) => groundUnder(pos) < 0,
    // (Leaving orbit: from the held shot, or where the orbit camera is.)
    fromOrbit: () => {
        const v = still.view;
        still.view = null;
        return v ? { position: v.eye, target: v.look } : Camera.orbitViewOpts(vp.cam);
    },
    toOrbit: (view) => Camera.orbitFromView(vp.cam, view),
    onMode: (mode) => { for (const fn of modeHooks) fn(mode); },
});
const modeHooks = [];
/** fn(mode) after each change of mode ('walk', 'fly', 'orbit'). */
export const onMode = (fn) => modeHooks.push(fn);
export const setMode = (mode) => ctl.setMode(mode);
export const MODE_HELP = {
    orbit: 'Drag orbits · right-drag pans · wheel zooms · F walks.',
    walk: 'Click to look (Esc frees the mouse) · WASD walk · Shift runs · Space jumps · F flies.',
    fly: 'Click to look · WASD fly · Space / C rise and sink · Shift boosts · wheel sets the speed · land to walk · F orbits.',
};
vp.onFrame((dt) => ctl.update(dt));

// The wheel zooms by the eye's height, a notch a quarter of it: from orbit
// to the grass at one pace, in some 60 notches.
vp.canvas.addEventListener('wheel', (e) => {
    if (ctl.mode !== 'orbit') return;
    e.preventDefault();
    if (still.view) letGo();
    const cam = vp.cam, h = Math.max(eyeHeight(cam.pos), 2);
    cam.dist = Math.min(Math.max(cam.dist - h * (1 - Math.exp(e.deltaY * 0.006)), 2), 6e7);
});
vp.onView((view) => {
    if (ctl.mode !== 'orbit') {
        // Walking or flying: the controller's view, the planes from its height.
        Object.assign(view, ctl.view());
        const h = Math.max(eyeHeight(view.position), 2);
        view.near = Math.min(Math.max(0.05 * h, 0.1), 1e5);
        view.far = Math.max(4e5, 3 * h + 2 * Math.sqrt(2 * R * h));
        exposeFor(view.position);
        return;
    }
    if (!still.view) {
        // Free: never under the ground, and the near and far planes from the
        // eye's height (a planet from 20,000 km and a meadow from 2 m).
        const cam = vp.cam;
        const alt = eyeHeight(cam.pos);
        if (alt < 2) {
            const up = scene.upAt(cam.pos);
            for (let i = 0; i < 3; i++) {
                cam.pos[i] += up[i] * (2 - alt);
                view.target[i] += up[i] * (2 - alt);
            }
            view.position = cam.pos.slice();
        }
        const h = Math.max(alt, 2);
        view.near = Math.min(Math.max(0.05 * h, 0.1), 1e5);
        view.far = Math.max(4e5, 3 * h + 2 * Math.sqrt(2 * R * h));
        exposeFor(cam.pos);
        return;
    }
    exposeFor(still.view.eye);
    view.position = still.view.eye;
    view.target = still.view.look;
    view.up = still.view.up;
    view.near = still.view.near;
    view.far = still.view.far;
});
setShot('orbit');
