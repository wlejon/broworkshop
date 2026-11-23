// Relational Urban Mobility Twin dataset builder for bro.table.
// Generates 4 linked mutable Tables:
//   - vehicles (131,072 rows = 32 chunks, nullable order_id, Hash/Range/SpatialIndex)
//   - roads    (256 segments across 4 districts, HashIndex road_id)
//   - orders   (32,768 live fares/deliveries, HashIndex order_id)
//   - hubs     (24 transit/charging stations & eVTOL vertiports, HashIndex hub_id)

export const VEHICLE_COUNT = 131072;
export const ROAD_COUNT = 256;
export const ORDER_COUNT = 32768;
export const HUB_COUNT = 24;

export const MODES = ['sedan', 'bus', 'cargo', 'evtol'];
export const MODE_HEX = ['#36e896', '#3fb8ff', '#ffbe3b', '#c678ff'];
export const DISTRICTS = ['Downtown', 'Midtown', 'Harbor', 'TechPark'];
export const DISTRICT_CENTERS = [
    { name: 'Downtown', pos: [-0.62, 0.08, -0.62] },
    { name: 'Midtown',  pos: [ 0.62, 0.08, -0.62] },
    { name: 'Harbor',   pos: [-0.62, 0.12,  0.62] },
    { name: 'TechPark', pos: [ 0.62, 0.10,  0.62] },
];
export const LANE_CLASSES = ['Avenue', 'Expressway', 'Bridge', 'SkyCorridor'];
export const TIERS = ['Economy', 'Express', 'Freight', 'SkyVIP'];

export const BRUSH_PRESETS = {
    incident: [ 0.50, 0.04, -0.50],
    corridor: [ 0.50, 0.04, -0.50],
    cullMin:  [-0.95, -0.25,  0.20],
    cullMax:  [-0.25,  0.80,  0.95],
};

function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return (s >>> 0) / 4294967296;
    };
}

function quadrantOf(x, z) {
    if (x < 0 && z < 0) return 0; // Downtown
    if (x >= 0 && z < 0) return 1; // Midtown
    if (x < 0 && z >= 0) return 2; // Harbor
    return 3; // TechPark
}

function buildHubRecords() {
    const hubs = [];
    const offsets = [
        [-0.86, 0.03, -0.86, 64], [-0.34, 0.03, -0.82, 48], [-0.82, 0.03, -0.34, 52],
        [-0.36, 0.03, -0.36, 96], [-0.64, 0.34, -0.64, 32], [-0.96, 0.36, -0.50, 24],
        [ 0.86, 0.03, -0.86, 56], [ 0.34, 0.03, -0.82, 72], [ 0.82, 0.03, -0.34, 60],
        [ 0.36, 0.03, -0.36, 88], [ 0.64, 0.34, -0.64, 36], [ 0.96, 0.36, -0.50, 28],
        [-0.86, 0.03,  0.86, 44], [-0.34, 0.05,  0.82, 64], [-0.82, 0.05,  0.34, 52],
        [-0.36, 0.04,  0.36, 76], [-0.64, 0.36,  0.64, 24], [-0.50, 0.34,  0.96, 20],
        [ 0.86, 0.03,  0.86, 68], [ 0.34, 0.03,  0.82, 56], [ 0.82, 0.03,  0.34, 64],
        [ 0.36, 0.03,  0.36, 92], [ 0.64, 0.36,  0.64, 40], [ 0.50, 0.38,  0.96, 28],
    ];
    for (let i = 0; i < HUB_COUNT; i++) {
        const [x, y, z, chargers] = offsets[i];
        const qIdx = quadrantOf(x, z);
        const sky = y > 0.2 ? 'Skyport' : 'Hub';
        hubs.push({
            hub_id: i,
            name: `${DISTRICTS[qIdx]}-${sky}-${(i % 6) + 1}`,
            x,
            y,
            z,
            chargers,
        });
    }
    return hubs;
}

function buildRoadSegments() {
    const raw = [];
    const aveCoords = [-1.05, -0.75, -0.45, -0.15, 0.15, 0.45, 0.75, 1.05];

    // 128 orthogonal avenues: 64 N-S + 64 E-W (each segment length = 0.30)
    for (let ai = 0; ai < 8; ai++) {
        const ax = aveCoords[ai];
        const dirZ = (ai % 2 === 0) ? 1 : -1;
        for (let si = 0; si < 8; si++) {
            const cz = -1.05 + si * 0.30;
            raw.push({
                cx: ax, cy: 0.01, cz,
                dx: 0, dz: dirZ,
                halfLen: 0.15, width: 0.045,
                laneClass: 'Avenue', speedLimit: 55.0, tollUsd: 0.0,
            });
        }
    }
    for (let ai = 0; ai < 8; ai++) {
        const az = aveCoords[ai];
        const dirX = (ai % 2 === 0) ? 1 : -1;
        for (let si = 0; si < 8; si++) {
            const cx = -1.05 + si * 0.30;
            raw.push({
                cx, cy: 0.015, cz: az,
                dx: dirX, dz: 0,
                halfLen: 0.15, width: 0.045,
                laneClass: 'Avenue', speedLimit: 55.0, tollUsd: 0.0,
            });
        }
    }

    // 64 Ring Expressway segments: 32 outer viaduct (r=1.32) + 32 inner beltway (r=0.68)
    for (let k = 0; k < 32; k++) {
        const ang = ((k + 0.5) / 32) * Math.PI * 2;
        const rOut = 1.32;
        raw.push({
            cx: Math.cos(ang) * rOut, cy: 0.055, cz: Math.sin(ang) * rOut,
            dx: -Math.sin(ang), dz: Math.cos(ang),
            halfLen: 0.13, width: 0.055,
            laneClass: 'Expressway', speedLimit: 88.0, tollUsd: 3.5,
        });
    }
    for (let k = 0; k < 32; k++) {
        const ang = ((k + 0.5) / 32) * Math.PI * 2;
        const rIn = 0.68;
        raw.push({
            cx: Math.cos(ang) * rIn, cy: 0.04, cz: Math.sin(ang) * rIn,
            dx: Math.sin(ang), dz: -Math.cos(ang),
            halfLen: 0.11, width: 0.048,
            laneClass: 'Expressway', speedLimit: 82.0, tollUsd: 2.5,
        });
    }

    // 32 River/Harbor Bridges & Diagonal Cross-Arterials
    for (let k = 0; k < 16; k++) {
        const t = (k + 0.5) / 16;
        const x = -1.2 + t * 2.4;
        const arch = 0.075 + 0.065 * Math.sin(t * Math.PI);
        raw.push({
            cx: x, cy: arch, cz: x * 0.85,
            dx: 0.76, dz: 0.65,
            halfLen: 0.14, width: 0.042,
            laneClass: 'Bridge', speedLimit: 72.0, tollUsd: 4.0,
        });
    }
    for (let k = 0; k < 16; k++) {
        const t = (k + 0.5) / 16;
        const x = -1.2 + t * 2.4;
        const arch = 0.075 + 0.065 * Math.sin(t * Math.PI);
        raw.push({
            cx: x, cy: arch, cz: -x * 0.85,
            dx: 0.76, dz: -0.65,
            halfLen: 0.14, width: 0.042,
            laneClass: 'Bridge', speedLimit: 72.0, tollUsd: 4.0,
        });
    }

    // 32 Elevated eVTOL Air-Taxi Corridors (y > 0.2)
    for (let k = 0; k < 32; k++) {
        const ang = ((k + 0.5) / 32) * Math.PI * 2;
        const rAir = 0.52 + (k % 3) * 0.34;
        const alt = 0.28 + (k % 4) * 0.055;
        raw.push({
            cx: Math.cos(ang) * rAir, cy: alt, cz: Math.sin(ang) * rAir,
            dx: -Math.sin(ang), dz: Math.cos(ang),
            halfLen: 0.14, width: 0.045,
            laneClass: 'SkyCorridor', speedLimit: 115.0, tollUsd: 7.5,
        });
    }

    // Sort by quadrant then angle/position so 4096-row chunks stay spatially coherent!
    raw.sort((a, b) => {
        const qa = quadrantOf(a.cx, a.cz);
        const qb = quadrantOf(b.cx, b.cz);
        if (qa !== qb) return qa - qb;
        if (a.cx !== b.cx) return a.cx - b.cx;
        return a.cz - b.cz;
    });

    return raw.map((seg, id) => {
        const qIdx = quadrantOf(seg.cx, seg.cz);
        return {
            road_id: id,
            district: DISTRICTS[qIdx],
            districtIdx: qIdx,
            lane_class: seg.laneClass,
            speed_limit: seg.speedLimit,
            toll_usd: seg.tollUsd,
            cx: seg.cx,
            cy: seg.cy,
            cz: seg.cz,
            dx: seg.dx,
            dz: seg.dz,
            halfLen: seg.halfLen,
            width: seg.width,
        };
    });
}

function nearestHubId(x, y, z, hubs) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < hubs.length; i++) {
        const h = hubs[i];
        const dx = x - h.x;
        const dy = y - h.y;
        const dz = z - h.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

export function makeRushHourBatch(startVid, count, roadMeta, hubRows, seed = 918273) {
    const rng = makeRng(seed + startVid);
    const vid = new Uint32Array(count);
    const road_id = new Int32Array(count);
    const hub_id = new Int32Array(count);
    const order_id = new Array(count);
    const mode = new Array(count);
    const plate = new Array(count);
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    const z = new Float32Array(count);
    const vx = new Float32Array(count);
    const vz = new Float32Array(count);
    const speed = new Float32Array(count);
    const delay_min = new Float32Array(count);
    const battery = new Float32Array(count);
    const flags = new Uint32Array(count);
    const active = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
        const rid = (i * 7 + ((rng() * 16) | 0)) % ROAD_COUNT;
        const seg = roadMeta[rid];
        const along = (rng() * 2 - 1) * seg.halfLen * 0.92;
        const laneSign = (i & 1) === 0 ? 1 : -1;
        const lat = (0.25 + rng() * 0.7) * seg.width * laneSign;
        const px = seg.cx + seg.dx * along - seg.dz * lat;
        const pz = seg.cz + seg.dz * along + seg.dx * lat;
        const py = seg.cy + (seg.lane_class === 'SkyCorridor' ? (rng() - 0.5) * 0.06 : 0.0);

        let mStr = 'sedan';
        const mr = rng();
        if (seg.lane_class === 'SkyCorridor') mStr = mr < 0.82 ? 'evtol' : 'cargo';
        else if (mr > 0.84) mStr = 'cargo';
        else if (mr > 0.66) mStr = 'bus';

        const congested = rng() < 0.34;
        const spd = congested ? (10 + rng() * 14) : (seg.speed_limit * (0.62 + rng() * 0.36));
        const dly = congested ? (14 + rng() * 16) : (rng() < 0.25 ? 2 + rng() * 7 : rng() * 0.8);

        vid[i] = startVid + i;
        road_id[i] = rid;
        hub_id[i] = nearestHubId(px, py, pz, hubRows);
        order_id[i] = rng() < 0.35 ? null : 1 + ((rng() * ORDER_COUNT) | 0);
        mode[i] = mStr;
        plate[i] = `UM-${String((startVid + i) % 9000 + 1000)}-${String.fromCharCode(65 + (i % 26))}`;
        x[i] = px;
        y[i] = py;
        z[i] = pz;
        vx[i] = seg.dx * (seg.lane_class === 'Avenue' ? 1 : laneSign);
        vz[i] = seg.dz * (seg.lane_class === 'Avenue' ? 1 : laneSign);
        speed[i] = spd;
        delay_min[i] = dly;
        battery[i] = 0.14 + rng() * 0.82;
        flags[i] = (rid & 255) | (seg.lane_class === 'SkyCorridor' ? 256 : 0);
        active[i] = 1;
    }

    return {
        vid, road_id, hub_id, order_id, mode, plate,
        x, y, z, vx, vz, speed, delay_min, battery, flags, active,
    };
}

export function createUrbanMobilityData() {
    const t0 = performance.now();
    const q = bro.table;
    const rng = makeRng(20261123);

    // 1. hubs (24)
    const hubRows = buildHubRecords();
    const hubs = q.create({
        hub_id: 'i32',
        name: 'dict',
        x: 'f32',
        y: 'f32',
        z: 'f32',
        chargers: 'i32',
    });
    hubs.insertMany(hubRows);
    hubs.createIndex('hub_id');

    // 2. roads (256)
    const roadMeta = buildRoadSegments();
    const roads = q.create({
        road_id: 'i32',
        district: 'dict',
        lane_class: 'dict',
        speed_limit: 'f32',
        toll_usd: 'f32',
    });
    roads.insertMany(roadMeta.map((r) => ({
        road_id: r.road_id,
        district: r.district,
        lane_class: r.lane_class,
        speed_limit: r.speed_limit,
        toll_usd: r.toll_usd,
    })));
    roads.createIndex('road_id');

    // 3. orders (32,768)
    const orders = q.create({
        order_id: 'i32',
        tier: 'dict',
        fare_usd: 'f32',
        sla_min: 'f32',
        priority: 'i32',
    });
    const ordId = new Int32Array(ORDER_COUNT);
    const ordTier = new Array(ORDER_COUNT);
    const ordFare = new Float32Array(ORDER_COUNT);
    const ordSla = new Float32Array(ORDER_COUNT);
    const ordPri = new Int32Array(ORDER_COUNT);
    for (let i = 0; i < ORDER_COUNT; i++) {
        const ti = (rng() < 0.45) ? 0 : (rng() < 0.72 ? 1 : (rng() < 0.90 ? 2 : 3));
        ordId[i] = i + 1;
        ordTier[i] = TIERS[ti];
        ordFare[i] = 9.0 + ti * 24.0 + rng() * (14.0 + ti * 16.0);
        ordSla[i] = 12.0 + (3 - ti) * 6.0 + rng() * 12.0;
        ordPri[i] = 1 + ((ti + (rng() * 2)) | 0);
    }
    orders.insertMany({
        order_id: ordId,
        tier: ordTier,
        fare_usd: ordFare,
        sla_min: ordSla,
        priority: ordPri,
    });
    orders.createIndex('order_id');

    // 4. vehicles (131,072 = 32 chunks * 4096 rows, spatially ordered by road_id)
    const vehicles = q.create({
        vid: 'u32',
        road_id: 'i32',
        hub_id: 'i32',
        order_id: 'i32',
        mode: 'dict',
        plate: 'string',
        x: 'f32',
        y: 'f32',
        z: 'f32',
        vx: 'f32',
        vz: 'f32',
        speed: 'f32',
        delay_min: 'f32',
        battery: 'f32',
        flags: 'u32',
        active: 'bool',
    });

    const N = VEHICLE_COUNT;
    const vid = new Uint32Array(N);
    const road_id = new Int32Array(N);
    const hub_id = new Int32Array(N);
    const order_id = new Array(N);
    const mode = new Array(N);
    const plate = new Array(N);
    const x = new Float32Array(N);
    const y = new Float32Array(N);
    const z = new Float32Array(N);
    const vx = new Float32Array(N);
    const vz = new Float32Array(N);
    const speed = new Float32Array(N);
    const delay_min = new Float32Array(N);
    const battery = new Float32Array(N);
    const flags = new Uint32Array(N);
    const active = new Uint8Array(N);

    const perRoad = N / ROAD_COUNT; // 512 vehicles per road segment -> 8 roads per 4096-row chunk
    for (let i = 0; i < N; i++) {
        const rid = (i / perRoad) | 0;
        const seg = roadMeta[rid];
        const along = (rng() * 2 - 1) * seg.halfLen * 0.94;
        const laneSign = (i & 1) === 0 ? 1 : -1;
        const dirSign = seg.lane_class === 'Avenue' ? 1 : laneSign;
        const lat = (0.18 + rng() * 0.72) * seg.width * laneSign;

        const px = seg.cx + seg.dx * along - seg.dz * lat;
        const pz = seg.cz + seg.dz * along + seg.dx * lat;
        let py = seg.cy + (seg.lane_class === 'SkyCorridor' ? (rng() - 0.5) * 0.06 : 0.0);

        let mStr = 'sedan';
        if (i < 4) {
            mStr = MODES[i]; // Guarantee dict IDs: 0=sedan, 1=bus, 2=cargo, 3=evtol
            if (i === 3) py = 0.30;
        } else if (seg.lane_class === 'SkyCorridor') {
            mStr = rng() < 0.84 ? 'evtol' : 'cargo';
        } else {
            const mr = rng();
            if (mr > 0.86) mStr = 'cargo';
            else if (mr > 0.68) mStr = 'bus';
        }

        // Seed realistic traffic bottlenecks in Midtown & Harbor bridge corridors
        const dMid = Math.hypot(px - 0.52, pz + 0.52);
        const dHarb = Math.hypot(px + 0.48, pz - 0.50);
        const hotSpot = dMid < 0.28 || dHarb < 0.24;
        const slowChance = hotSpot ? 0.52 : 0.14;
        const isSlow = rng() < slowChance;
        const isJam = isSlow && rng() < (hotSpot ? 0.55 : 0.22);

        const spd = isJam
            ? (7.0 + rng() * 10.0)
            : (isSlow ? seg.speed_limit * (0.34 + rng() * 0.20) : seg.speed_limit * (0.76 + rng() * 0.28));
        const dly = isJam
            ? (18.0 + rng() * 14.0)
            : (isSlow ? (3.0 + rng() * 9.0) : rng() * 0.75);

        vid[i] = i + 1;
        road_id[i] = rid;
        hub_id[i] = nearestHubId(px, py, pz, hubRows);
        order_id[i] = rng() < 0.35 ? null : 1 + ((rng() * ORDER_COUNT) | 0);
        mode[i] = mStr;
        plate[i] = `${DISTRICTS[seg.districtIdx].slice(0, 2).toUpperCase()}-${String(1000 + (i % 9000))}-${String.fromCharCode(65 + (i % 26))}`;
        x[i] = px;
        y[i] = py;
        z[i] = pz;
        vx[i] = seg.dx * dirSign;
        vz[i] = seg.dz * dirSign;
        speed[i] = spd;
        delay_min[i] = dly;
        battery[i] = rng() < 0.055 ? (0.07 + rng() * 0.07) : (0.19 + rng() * 0.80);
        flags[i] = (rid & 255) | (seg.lane_class === 'SkyCorridor' ? 256 : 0) | (isJam ? 512 : 0);
        active[i] = 1;
    }

    vehicles.insertMany({
        vid, road_id, hub_id, order_id, mode, plate,
        x, y, z, vx, vz, speed, delay_min, battery, flags, active,
    });
    vehicles.createIndex('vid');
    vehicles.createRangeIndex('delay_min');
    vehicles.createSpatialIndex('city3d', ['x', 'y', 'z'], 0.25);

    const loadMs = performance.now() - t0;
    return {
        vehicles,
        roads,
        orders,
        hubs,
        roadMeta,
        hubRows,
        loadMs,
        nextVid: N + 1,
    };
}

export const ANALYTICS_QUERIES = {
    congestionByMode: {
        table: 'vehicles',
        join: { table: 'roads', kind: 'inner', leftKeys: 'road_id', rightKeys: 'road_id' },
        groupBy: 'mode',
        agg: {
            cnt: { fn: 'count' },
            avgSpeed: { fn: 'avg', expr: { col: 'left.speed', side: 0 } },
            avgRatio: {
                fn: 'avg',
                expr: { op: 'div', a: { col: 'left.speed', side: 0 }, b: { col: 'right.speed_limit', side: 1 } },
            },
            avgDelay: { fn: 'avg', expr: { col: 'left.delay_min', side: 0 } },
        },
    },
    congestionByDistrict: {
        table: 'vehicles',
        join: { table: 'roads', kind: 'inner', leftKeys: 'road_id', rightKeys: 'road_id' },
        groupBy: 'right.district',
        agg: {
            cnt: { fn: 'count' },
            avgRatio: {
                fn: 'avg',
                expr: { op: 'div', a: { col: 'left.speed', side: 0 }, b: { col: 'right.speed_limit', side: 1 } },
            },
            avgSpeed: { fn: 'avg', expr: { col: 'left.speed', side: 0 } },
            avgDelay: { fn: 'avg', expr: { col: 'left.delay_min', side: 0 } },
        },
    },
    revenueWithIdle: {
        table: 'vehicles',
        join: { table: 'orders', kind: 'left', leftKeys: 'order_id', rightKeys: 'order_id' },
        groupBy: 'mode',
        agg: {
            fleetCnt: { fn: 'count' },
            paidCnt: {
                fn: 'sum',
                expr: {
                    op: 'cond',
                    c: { op: 'isNull', a: { col: 'left.order_id', side: 0 } },
                    t: { lit: 0.0 },
                    e: { lit: 1.0 },
                },
            },
            idleCnt: {
                fn: 'sum',
                expr: {
                    op: 'cond',
                    c: { op: 'isNull', a: { col: 'left.order_id', side: 0 } },
                    t: { lit: 1.0 },
                    e: { lit: 0.0 },
                },
            },
            activeRevenue: {
                fn: 'sum',
                expr: { op: 'coalesce', a: { col: 'right.fare_usd', side: 1 }, b: { lit: 0.0 } },
            },
        },
    },
    topDelayed: {
        table: 'vehicles',
        where: { op: 'gt', a: { col: 'delay_min', side: 0 }, b: { lit: 1.0 } },
        select: {
            vid: 'vid',
            plate: 'plate',
            mode: 'mode',
            road_id: 'road_id',
            speed: 'speed',
            delay_min: 'delay_min',
            battery: 'battery',
        },
        orderBy: { expr: 'delay_min', desc: true },
        limit: 8,
    },
};
