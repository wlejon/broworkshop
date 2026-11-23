// Relational Market Microstructure dataset builder & Worker analytics batch specs.
// Builds 4 linked mutable bro.table Tables:
//   - instruments (16 rows, HashIndex sym_id)
//   - venues      (16 rows, HashIndex venue_id)
//   - agents      (4,096 rows, HashIndex agent_id, RangeIndex leverage)
//   - orders      (131,072 rows across 32 instrument/side-coherent 4096-row chunks,
//                  HashIndex order_id, RangeIndex notional, SpatialIndex 'book3d' cellSize=0.25,
//                  nullable venue_id on ~25% OTC dark-pool orders)

export const ORDER_COUNT = 131072; // 32 * 4096 rows
export const AGENT_COUNT = 4096;
export const INSTRUMENT_COUNT = 16;
export const VENUE_COUNT = 16;

export const SECTORS = ['AI_TECH', 'CRYPTO', 'MACRO_ETF', 'COMMODITY', 'FX'];
export const SECTOR_HEX = ['#38d8ff', '#c96bff', '#36e896', '#ffbe3b', '#ff6e7f'];

export const STRATEGIES = ['MM', 'ARB', 'MOMENTUM', 'HEDGE', 'RETAIL'];
export const DESK_TYPES = ['HFT_MM', 'QUANT_ARB', 'PENSION_LO', 'MACRO_HF', 'RETAIL_AGG'];

export const FLAG_TOXIC = 1;
export const FLAG_MARGIN_RISK = 2;
export const FLAG_ICEBERG = 4;

export const INSTRUMENT_DEFS = [
    { sym_id: 0,  symbol: 'NVDA', sector: 'AI_TECH',   sectorIdx: 0, mid_price: 142.50,  volatility: 0.56, spread_bps: 2.1, beta: 1.72,  imbalance:  0.14 },
    { sym_id: 1,  symbol: 'BTC',  sector: 'CRYPTO',    sectorIdx: 1, mid_price: 94200.0, volatility: 0.72, spread_bps: 3.4, beta: 1.95,  imbalance:  0.22 },
    { sym_id: 2,  symbol: 'ETH',  sector: 'CRYPTO',    sectorIdx: 1, mid_price: 3380.0,  volatility: 0.76, spread_bps: 4.2, beta: 2.05,  imbalance:  0.09 },
    { sym_id: 3,  symbol: 'SPY',  sector: 'MACRO_ETF', sectorIdx: 2, mid_price: 598.40,  volatility: 0.16, spread_bps: 0.8, beta: 1.00,  imbalance: -0.05 },
    { sym_id: 4,  symbol: 'QQQ',  sector: 'MACRO_ETF', sectorIdx: 2, mid_price: 514.20,  volatility: 0.22, spread_bps: 1.1, beta: 1.24,  imbalance:  0.07 },
    { sym_id: 5,  symbol: 'AAPL', sector: 'AI_TECH',   sectorIdx: 0, mid_price: 234.80,  volatility: 0.28, spread_bps: 1.4, beta: 1.18,  imbalance:  0.04 },
    { sym_id: 6,  symbol: 'TSLA', sector: 'AI_TECH',   sectorIdx: 0, mid_price: 348.60,  volatility: 0.64, spread_bps: 2.8, beta: 1.88,  imbalance: -0.18 },
    { sym_id: 7,  symbol: 'AMZN', sector: 'AI_TECH',   sectorIdx: 0, mid_price: 212.30,  volatility: 0.34, spread_bps: 1.6, beta: 1.32,  imbalance:  0.06 },
    { sym_id: 8,  symbol: 'MSFT', sector: 'AI_TECH',   sectorIdx: 0, mid_price: 428.90,  volatility: 0.24, spread_bps: 1.3, beta: 1.12,  imbalance:  0.11 },
    { sym_id: 9,  symbol: 'GLD',  sector: 'COMMODITY', sectorIdx: 3, mid_price: 246.50,  volatility: 0.18, spread_bps: 1.5, beta: 0.15,  imbalance:  0.16 },
    { sym_id: 10, symbol: 'TLT',  sector: 'MACRO_ETF', sectorIdx: 2, mid_price: 91.40,   volatility: 0.21, spread_bps: 1.7, beta: -0.32, imbalance: -0.12 },
    { sym_id: 11, symbol: 'OIL',  sector: 'COMMODITY', sectorIdx: 3, mid_price: 70.80,   volatility: 0.42, spread_bps: 3.1, beta: 0.58,  imbalance: -0.09 },
    { sym_id: 12, symbol: 'EUR',  sector: 'FX',        sectorIdx: 4, mid_price: 1.062,   volatility: 0.11, spread_bps: 0.9, beta: 0.12,  imbalance:  0.02 },
    { sym_id: 13, symbol: 'JPY',  sector: 'FX',        sectorIdx: 4, mid_price: 153.40,  volatility: 0.14, spread_bps: 1.2, beta: -0.18, imbalance: -0.14 },
    { sym_id: 14, symbol: 'VIX',  sector: 'MACRO_ETF', sectorIdx: 2, mid_price: 16.80,   volatility: 0.85, spread_bps: 8.5, beta: -2.40, imbalance:  0.26 },
    { sym_id: 15, symbol: 'SOL',  sector: 'CRYPTO',    sectorIdx: 1, mid_price: 218.50,  volatility: 0.82, spread_bps: 5.4, beta: 2.25,  imbalance:  0.19 },
];

export const VENUE_DEFS = [
    { venue_id: 1,  venue_name: 'NASDAQ',       fee_bps: 0.30, latency_us: 16.0 },
    { venue_id: 2,  venue_name: 'NYSE_ARCA',    fee_bps: 0.28, latency_us: 19.0 },
    { venue_id: 3,  venue_name: 'BATS_BZX',     fee_bps: 0.22, latency_us: 18.0 },
    { venue_id: 4,  venue_name: 'EDGX',         fee_bps: 0.24, latency_us: 21.0 },
    { venue_id: 5,  venue_name: 'IEX_LIT',      fee_bps: 0.09, latency_us: 350.0 },
    { venue_id: 6,  venue_name: 'MEMX',         fee_bps: 0.15, latency_us: 14.0 },
    { venue_id: 7,  venue_name: 'CME_GLOBEX',   fee_bps: 0.42, latency_us: 28.0 },
    { venue_id: 8,  venue_name: 'BINANCE_PERP', fee_bps: 1.80, latency_us: 64.0 },
    { venue_id: 9,  venue_name: 'COINBASE_PRO', fee_bps: 2.50, latency_us: 85.0 },
    { venue_id: 10, venue_name: 'DERIBIT',      fee_bps: 2.10, latency_us: 72.0 },
    { venue_id: 11, venue_name: 'EUREX',        fee_bps: 0.38, latency_us: 34.0 },
    { venue_id: 12, venue_name: 'CBOE_VIX',     fee_bps: 0.55, latency_us: 31.0 },
    { venue_id: 13, venue_name: 'ICE_FUTURES',  fee_bps: 0.48, latency_us: 42.0 },
    { venue_id: 14, venue_name: 'EBS_FX',       fee_bps: 0.18, latency_us: 29.0 },
    { venue_id: 15, venue_name: 'MIAX_PEARL',   fee_bps: 0.26, latency_us: 22.0 },
    { venue_id: 16, venue_name: 'LSE_LIT',      fee_bps: 0.34, latency_us: 48.0 },
];

export const BRUSH_PRESETS = {
    probe: [-0.975, 0.05, -0.22],
    crash: [-0.975, 0.05, -0.22], // Hits NVDA/BTC BID wall + neighboring canyons
    sweepMin: [-0.30, -0.60,  0.04],
    sweepMax: [ 0.45,  0.90,  0.85], // Cancels central ASK liquidity box
};

export function canyonCenterX(symId) {
    return -1.125 + symId * 0.15;
}

function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return (s >>> 0) / 4294967296;
    };
}

function sampleOrderPosition(symId, side, distMid, notional, rng) {
    const cx = canyonCenterX(symId);
    const px = cx + (rng() - 0.5) * 0.105;
    const distNorm = Math.min(1.0, distMid / 65.0);
    const zMag = 0.065 + Math.pow(distNorm, 0.72) * 0.96 + (rng() - 0.5) * 0.03;
    const pz = side === 0 ? -zMag : zMag;
    const logNot = Math.max(0.0, Math.min(1.0, (Math.log10(Math.max(1000, notional)) - 3.6) / 3.1));
    const py = -0.46 + logNot * 1.12 + (rng() - 0.5) * 0.08;
    return [px, py, pz];
}

function pickQtyAndNotional(midPrice, isWhale, rng) {
    const targetUsd = isWhale
        ? (450000 + rng() * 2400000)
        : (6500 + Math.pow(rng(), 1.8) * 195000);
    const qty = Math.max(0.01, targetUsd / Math.max(0.5, midPrice));
    return { qty, targetUsd };
}

export function makeWhaleWallBatch(startOrderId, count, agentLevs, seed = 424242) {
    const rng = makeRng(seed + startOrderId);
    const order_id = new Uint32Array(count);
    const agent_id = new Uint32Array(count);
    const sym_id = new Uint32Array(count);
    const side = new Uint32Array(count);
    const price = new Float32Array(count);
    const qty = new Float32Array(count);
    const notional = new Float32Array(count);
    const dist_mid = new Float32Array(count);
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    const z = new Float32Array(count);
    const strategy = new Array(count);
    const venue_id = new Array(count);
    const age_ms = new Float32Array(count);
    const fill_ratio = new Float32Array(count);
    const flags = new Uint32Array(count);

    for (let i = 0; i < count; i++) {
        const sId = i % INSTRUMENT_COUNT;
        const inst = INSTRUMENT_DEFS[sId];
        const aId = 1 + ((i * 37 + ((rng() * 64) | 0)) % AGENT_COUNT);
        const sd = (i & 1);
        const dm = 2.0 + rng() * 14.0;
        const p = inst.mid_price * (1.0 + (sd === 0 ? -1 : 1) * dm * 0.0001);
        const usd = 550000 + rng() * 2650000;
        const qVal = Math.max(0.05, usd / Math.max(0.5, p));
        const not = p * qVal;
        const [px, py, pz] = sampleOrderPosition(sId, sd, dm, not, rng);

        order_id[i] = startOrderId + i;
        agent_id[i] = aId;
        sym_id[i] = sId;
        side[i] = sd;
        price[i] = p;
        qty[i] = qVal;
        notional[i] = not;
        dist_mid[i] = dm;
        x[i] = px;
        y[i] = py;
        z[i] = pz;
        strategy[i] = rng() < 0.55 ? 'HEDGE' : 'ARB';
        venue_id[i] = rng() < 0.25 ? null : (1 + ((sId + i) % VENUE_COUNT));
        age_ms[i] = 20 + rng() * 800;
        fill_ratio[i] = 0.08 + rng() * 0.35;
        flags[i] = FLAG_ICEBERG | (agentLevs[aId - 1] > 4.0 ? FLAG_MARGIN_RISK : 0);
    }

    return {
        order_id, agent_id, sym_id, side, price, qty, notional, dist_mid,
        x, y, z, strategy, venue_id, age_ms, fill_ratio, flags,
    };
}

export function createMarketMicrostructureData() {
    const t0 = performance.now();
    const q = bro.table;
    const rng = makeRng(0x20261123);

    // 1. instruments (16 rows)
    const instruments = q.create({
        sym_id: 'u32',
        symbol: 'dict',
        sector: 'dict',
        mid_price: 'f32',
        volatility: 'f32',
        spread_bps: 'f32',
        beta: 'f32',
        imbalance: 'f32',
    });
    // Ensure sector dict order matches SECTORS[0..4] cleanly
    instruments.insertMany(INSTRUMENT_DEFS.map((d) => ({
        sym_id: d.sym_id,
        symbol: d.symbol,
        sector: d.sector,
        mid_price: d.mid_price,
        volatility: d.volatility,
        spread_bps: d.spread_bps,
        beta: d.beta,
        imbalance: d.imbalance,
    })));
    instruments.createIndex('sym_id');

    // 2. venues (16 rows)
    const venues = q.create({
        venue_id: 'u32',
        venue_name: 'dict',
        fee_bps: 'f32',
        latency_us: 'f32',
    });
    venues.insertMany(VENUE_DEFS);
    venues.createIndex('venue_id');

    // 3. agents (4,096 rows)
    const agents = q.create({
        agent_id: 'u32',
        desk_type: 'dict',
        leverage: 'f32',
        equity: 'f32',
        pnl: 'f32',
        margin_ratio: 'f32',
        risk_tier: 'u32',
        active_orders: 'u32',
    });

    const agId = new Uint32Array(AGENT_COUNT);
    const agDesk = new Array(AGENT_COUNT);
    const agLev = new Float32Array(AGENT_COUNT);
    const agEq = new Float32Array(AGENT_COUNT);
    const agPnl = new Float32Array(AGENT_COUNT);
    const agMargin = new Float32Array(AGENT_COUNT);
    const agRisk = new Uint32Array(AGENT_COUNT);
    const agOrders = new Uint32Array(AGENT_COUNT);

    for (let i = 0; i < AGENT_COUNT; i++) {
        let deskIdx;
        if (i < DESK_TYPES.length) {
            deskIdx = i;
        } else {
            const dr = rng();
            if (dr < 0.24) deskIdx = 0;      // HFT_MM
            else if (dr < 0.46) deskIdx = 1; // QUANT_ARB
            else if (dr < 0.64) deskIdx = 2; // PENSION_LO
            else if (dr < 0.84) deskIdx = 3; // MACRO_HF
            else deskIdx = 4;                // RETAIL_AGG
        }

        let lev = 1.2;
        let eq = 1.0e6;
        if (deskIdx === 0) {
            lev = 2.0 + rng() * 2.5;
            eq = 8.0e6 + rng() * 32.0e6;
        } else if (deskIdx === 1) {
            lev = 2.6 + rng() * 3.1;
            eq = 12.0e6 + rng() * 48.0e6;
        } else if (deskIdx === 2) {
            lev = 1.0 + rng() * 0.65;
            eq = 25.0e6 + rng() * 65.0e6;
        } else if (deskIdx === 3) {
            lev = 2.4 + rng() * 3.85;
            eq = 15.0e6 + rng() * 55.0e6;
        } else {
            lev = 1.0 + rng() * 3.55;
            eq = 65000 + rng() * 750000;
        }

        const margin = Math.min(0.98, Math.max(0.10, (lev / 6.3) * 0.72 + (rng() - 0.35) * 0.32));
        const stressPnl = margin > 0.74 ? (-0.24 - rng() * 0.28) : (-0.12 + rng() * 0.38);
        const pnl = eq * stressPnl * 0.22;
        const tier = margin > 0.78 ? 3 : (margin > 0.62 ? 2 : (lev > 3.2 ? 1 : 0));

        agId[i] = i + 1;
        agDesk[i] = DESK_TYPES[deskIdx];
        agLev[i] = lev;
        agEq[i] = eq;
        agPnl[i] = pnl;
        agMargin[i] = margin;
        agRisk[i] = tier;
        agOrders[i] = ORDER_COUNT / AGENT_COUNT; // 32 orders per agent
    }

    agents.insertMany({
        agent_id: agId,
        desk_type: agDesk,
        leverage: agLev,
        equity: agEq,
        pnl: agPnl,
        margin_ratio: agMargin,
        risk_tier: agRisk,
        active_orders: agOrders,
    });
    agents.createIndex('agent_id');
    agents.createRangeIndex('leverage');

    // 4. orders (131,072 rows across 32 chunks: 2 chunks per instrument [BID chunk, ASK chunk])
    const orders = q.create({
        order_id: 'u32',
        agent_id: 'u32',
        sym_id: 'u32',
        side: 'u32',
        price: 'f32',
        qty: 'f32',
        notional: 'f32',
        dist_mid: 'f32',
        x: 'f32',
        y: 'f32',
        z: 'f32',
        strategy: 'dict',
        venue_id: 'u32',
        age_ms: 'f32',
        fill_ratio: 'f32',
        flags: 'u32',
    });

    const N = ORDER_COUNT;
    const order_id = new Uint32Array(N);
    const agent_id = new Uint32Array(N);
    const sym_id = new Uint32Array(N);
    const side = new Uint32Array(N);
    const price = new Float32Array(N);
    const qty = new Float32Array(N);
    const notional = new Float32Array(N);
    const dist_mid = new Float32Array(N);
    const x = new Float32Array(N);
    const y = new Float32Array(N);
    const z = new Float32Array(N);
    const strategy = new Array(N);
    const venue_id = new Array(N);
    const age_ms = new Float32Array(N);
    const fill_ratio = new Float32Array(N);
    const flags = new Uint32Array(N);

    for (let i = 0; i < N; i++) {
        const sId = (i >> 13) & 15;       // 8,192 rows per instrument
        const sd = (i >> 12) & 1;         // chunk 2*sId = BID (0), chunk 2*sId+1 = ASK (1)
        const inst = INSTRUMENT_DEFS[sId];
        const aIdx = (i * 257 + (i >> 12) * 19) % AGENT_COUNT;
        const aId = aIdx + 1;

        let stratIdx;
        if (i < STRATEGIES.length) {
            stratIdx = i; // guarantee dict order MM=0, ARB=1, MOMENTUM=2, HEDGE=3, RETAIL=4
        } else {
            const desk = agDesk[aIdx];
            if (desk === 'HFT_MM') stratIdx = rng() < 0.78 ? 0 : 1;
            else if (desk === 'QUANT_ARB') stratIdx = rng() < 0.72 ? 1 : 2;
            else if (desk === 'PENSION_LO') stratIdx = rng() < 0.70 ? 3 : 0;
            else if (desk === 'MACRO_HF') stratIdx = rng() < 0.55 ? 2 : 3;
            else stratIdx = rng() < 0.80 ? 4 : 2;
        }

        const isWhale = (i % 41 === 0) || (stratIdx === 3 && rng() < 0.075);
        const distBps = stratIdx === 0
            ? (0.4 + Math.pow(rng(), 1.4) * 18.0)
            : (1.5 + Math.pow(rng(), 1.15) * 56.0);
        const p = inst.mid_price * (1.0 + (sd === 0 ? -1 : 1) * distBps * 0.0001);
        const { qty: qVal, targetUsd } = pickQtyAndNotional(p, isWhale, rng);
        const not = p * qVal;
        const [px, py, pz] = sampleOrderPosition(sId, sd, distBps, not, rng);

        const isDark = rng() < 0.25;
        const vId = isDark ? null : (1 + ((sId * 3 + stratIdx * 2 + (i % 7)) % VENUE_COUNT));

        let fl = 0;
        const isToxic = (stratIdx === 2 && distBps < 9.0 && rng() < 0.14) || rng() < 0.015;
        const isMarginRisk = agLev[aIdx] > 4.0 && agMargin[aIdx] > 0.74 && rng() < 0.42;
        if (isToxic) fl |= FLAG_TOXIC;
        if (isMarginRisk) fl |= FLAG_MARGIN_RISK;
        if (isWhale && targetUsd > 480000) fl |= FLAG_ICEBERG;

        const fill = distBps < 7.0
            ? (0.25 + rng() * 0.72)
            : (rng() * 0.45);

        order_id[i] = i + 1;
        agent_id[i] = aId;
        sym_id[i] = sId;
        side[i] = sd;
        price[i] = p;
        qty[i] = qVal;
        notional[i] = not;
        dist_mid[i] = distBps;
        x[i] = px;
        y[i] = py;
        z[i] = pz;
        strategy[i] = STRATEGIES[stratIdx];
        venue_id[i] = vId;
        age_ms[i] = 10.0 + Math.pow(rng(), 1.6) * 16500.0;
        fill_ratio[i] = Math.min(0.99, Math.max(0.01, fill));
        flags[i] = fl;
    }

    const BATCH = 16384;
    for (let off = 0; off < N; off += BATCH) {
        const end = Math.min(N, off + BATCH);
        orders.insertMany({
            order_id: order_id.subarray(off, end),
            agent_id: agent_id.subarray(off, end),
            sym_id: sym_id.subarray(off, end),
            side: side.subarray(off, end),
            price: price.subarray(off, end),
            qty: qty.subarray(off, end),
            notional: notional.subarray(off, end),
            dist_mid: dist_mid.subarray(off, end),
            x: x.subarray(off, end),
            y: y.subarray(off, end),
            z: z.subarray(off, end),
            strategy: strategy.slice(off, end),
            venue_id: venue_id.slice(off, end),
            age_ms: age_ms.subarray(off, end),
            fill_ratio: fill_ratio.subarray(off, end),
            flags: flags.subarray(off, end),
        });
    }

    orders.createIndex('order_id');
    orders.createRangeIndex('notional');
    orders.createSpatialIndex('book3d', ['x', 'y', 'z'], 0.25);

    return {
        orders,
        agents,
        instruments,
        venues,
        agentLevs: agLev,
        loadMs: performance.now() - t0,
        nextOrderId: N + 1,
    };
}

export const ANALYTICS_QUERIES = {
    sectorDepth: {
        table: 'orders',
        join: { table: 'instruments', kind: 'inner', leftKeys: 'sym_id', rightKeys: 'sym_id' },
        groupBy: 'right.sector',
        agg: {
            cnt: { fn: 'count' },
            totalNotional: { fn: 'sum', expr: { col: 'left.notional', side: 0 } },
            netSignedQty: {
                fn: 'sum',
                expr: {
                    op: 'cond',
                    c: { op: 'eq', a: { col: 'left.side', side: 0 }, b: { lit: 0 } },
                    t: { col: 'left.qty', side: 0 },
                    e: { op: 'neg', a: { col: 'left.qty', side: 0 } },
                },
            },
            netNotionalImbalance: {
                fn: 'sum',
                expr: {
                    op: 'cond',
                    c: { op: 'eq', a: { col: 'left.side', side: 0 }, b: { lit: 0 } },
                    t: { col: 'left.notional', side: 0 },
                    e: { op: 'neg', a: { col: 'left.notional', side: 0 } },
                },
            },
            avgMidImpact: {
                fn: 'avg',
                expr: {
                    op: 'sqrt',
                    a: {
                        op: 'add',
                        a: {
                            op: 'mul',
                            a: {
                                op: 'abs',
                                a: { op: 'sub', a: { col: 'left.price', side: 0 }, b: { col: 'right.mid_price', side: 1 } },
                            },
                            b: { col: 'left.qty', side: 0 },
                        },
                        b: { lit: 1.0 },
                    },
                },
            },
            toxicOrMarginCnt: {
                fn: 'sum',
                expr: {
                    op: 'cond',
                    c: {
                        op: 'ne',
                        a: { op: 'bitAnd', a: { col: 'left.flags', side: 0 }, b: { lit: 3 } },
                        b: { lit: 0 },
                    },
                    t: { lit: 1.0 },
                    e: { lit: 0.0 },
                },
            },
        },
    },

    symbolDepth: {
        table: 'orders',
        join: { table: 'instruments', kind: 'inner', leftKeys: 'sym_id', rightKeys: 'sym_id' },
        groupBy: 'right.symbol',
        agg: {
            cnt: { fn: 'count' },
            totalNotional: { fn: 'sum', expr: { col: 'left.notional', side: 0 } },
            avgDistMid: { fn: 'avg', expr: { col: 'left.dist_mid', side: 0 } },
            netSignedQty: {
                fn: 'sum',
                expr: {
                    op: 'cond',
                    c: { op: 'eq', a: { col: 'left.side', side: 0 }, b: { lit: 0 } },
                    t: { col: 'left.qty', side: 0 },
                    e: { op: 'neg', a: { col: 'left.qty', side: 0 } },
                },
            },
        },
        orderBy: { expr: 'totalNotional', desc: true },
    },

    deskStress: {
        table: 'orders',
        join: { table: 'agents', kind: 'inner', leftKeys: 'agent_id', rightKeys: 'agent_id' },
        groupBy: 'right.desk_type',
        agg: {
            cnt: { fn: 'count' },
            totalNotional: { fn: 'sum', expr: { col: 'left.notional', side: 0 } },
            avgLeverage: { fn: 'avg', expr: { col: 'right.leverage', side: 1 } },
            avgMarginRatio: { fn: 'avg', expr: { col: 'right.margin_ratio', side: 1 } },
            avgPnl: { fn: 'avg', expr: { col: 'right.pnl', side: 1 } },
            stressedCnt: {
                fn: 'sum',
                expr: {
                    op: 'cond',
                    c: { op: 'gt', a: { col: 'right.margin_ratio', side: 1 }, b: { lit: 0.72 } },
                    t: { lit: 1.0 },
                    e: { lit: 0.0 },
                },
            },
        },
    },

    venueFeeAttribution: {
        table: 'orders',
        join: { table: 'venues', kind: 'left', leftKeys: 'venue_id', rightKeys: 'venue_id' },
        groupBy: 'strategy',
        agg: {
            orderCnt: { fn: 'count' },
            litCnt: { fn: 'count', expr: { col: 'right.fee_bps', side: 1 } },
            darkCnt: {
                fn: 'sum',
                expr: {
                    op: 'cond',
                    c: { op: 'isNull', a: { col: 'left.venue_id', side: 0 } },
                    t: { lit: 1.0 },
                    e: { lit: 0.0 },
                },
            },
            avgFeeBps: {
                fn: 'avg',
                expr: { op: 'coalesce', a: { col: 'right.fee_bps', side: 1 }, b: { lit: 0.25 } },
            },
            totalFeeUsd: {
                fn: 'sum',
                expr: {
                    op: 'mul',
                    a: { op: 'mul', a: { col: 'left.notional', side: 0 }, b: { lit: 0.0001 } },
                    b: { op: 'coalesce', a: { col: 'right.fee_bps', side: 1 }, b: { lit: 0.25 } },
                },
            },
        },
    },

    topWhales: {
        table: 'orders',
        select: {
            order_id: 'order_id',
            sym_id: 'sym_id',
            side: 'side',
            notional: 'notional',
            dist_mid: 'dist_mid',
            venue_id: 'venue_id',
        },
        orderBy: { expr: 'notional', desc: true },
        limit: 5,
    },

    topLeveragedAgents: {
        table: 'agents',
        select: {
            agent_id: 'agent_id',
            desk_type: 'desk_type',
            leverage: 'leverage',
            margin_ratio: 'margin_ratio',
            pnl: 'pnl',
        },
        orderBy: { expr: 'leverage', desc: true },
        limit: 5,
    },
};
