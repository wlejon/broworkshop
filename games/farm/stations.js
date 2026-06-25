// stations.js — station ownership + the work each station needs.
//
// A STATION is a named patch of the farm (a pen, or the garden) that ONE worker
// is assigned to and fully services. Instead of the Foreman dispatching every
// individual chore, he assigns a worker to a station; the worker then pulls
// whatever that station needs right now (stationChores) and works it
// autonomously. This is the "each npc operates a station" shape the larger
// vision builds on — and it scales: adding detail to a station (cleanliness,
// weeds, …) just adds chores its owner picks up, no new dispatch logic.
//
// Two seams:
//   assignStations(world)        — give every worker a station (stable, affine)
//   stationChores(world, o, id)  — the prioritized work a station needs now

import {
    buildServiceWaterTrough, buildServiceFeedTrough, buildCollectProduce,
    buildTend, buildMuckOut, buildHarvest, buildWaterCrop, buildPlant, buildWeed,
} from './tasks.js';
import { STATIONS, PENS, PEN_CARE, CROP_CARE, statLevel } from './defs.js';

export function stationById(id) { return STATIONS.find((s) => s.id === id) || null; }

// Light, readable subject for a pen ("cows", "chickens", "sheep").
function penSubject(penId) {
    if (penId === 'pasture') return 'cows';
    if (penId === 'coop') return 'chickens';
    if (penId === 'meadow') return 'sheep';
    const p = PENS[penId];
    return ((p && p.label) || penId).toLowerCase();
}

function troughFill(o, penId, kind) {
    const t = o.troughs.find((x) => x.penId === penId && x.kind === kind);
    return t ? t.fill : 100;
}

// Chores an ANIMAL station needs now, highest priority first. Mirrors the herd's
// survival pressure (water/feed/tend dominate), then upkeep (collect, muck out).
function animalChores(world, o, st) {
    const penId = st.penId;
    const out = [];
    const herd = o.animals.filter((a) => a.alive && a.penId === penId);
    if (herd.length) {
        const maxThirst = Math.max(...herd.map((a) => a.thirst));
        const maxHunger = Math.max(...herd.map((a) => a.hunger));
        const waterFill = troughFill(o, penId, 'water');
        const feedFill  = troughFill(o, penId, 'feed');
        const subject = penSubject(penId);
        if (maxThirst >= 60 || waterFill < 35) {
            out.push({ goal: 'service-water:' + penId, target: 'water:' + penId,
                role: 'rancher', kind: 'water', subject,
                priority: maxThirst + (waterFill < 12 ? 50 : 0) + 20,
                build: () => buildServiceWaterTrough(world, penId) });
        }
        if (maxHunger >= 60 || feedFill < 35) {
            out.push({ goal: 'service-feed:' + penId, target: 'feed:' + penId,
                role: 'rancher', kind: 'feed', subject,
                priority: maxHunger + (feedFill < 12 ? 50 : 0) + 15,
                build: () => buildServiceFeedTrough(world, penId) });
        }
    }
    for (const a of o.animals) {
        if (a.penId === penId && a.alive && a.sick) {
            out.push({ goal: 'tend:' + a.id, target: 'tend:' + a.id,
                role: 'rancher', kind: 'tend', subject: a.id,
                priority: 88 + (a.health < 35 ? 25 : 0),
                build: () => buildTend(world, a.id) });
        }
    }
    const pending = (o.pens && o.pens[penId]) ? o.pens[penId].pending : (o.pending[penId] || 0);
    if (pending >= 2) {
        out.push({ goal: 'collect:' + penId, target: 'collect:' + penId,
            role: 'rancher', kind: 'collect',
            subject: (PENS[penId] && PENS[penId].goodLabel) || 'produce',
            priority: 40 + Math.min(30, pending * 4),
            build: () => buildCollectProduce(world, penId) });
    }
    const clean = (o.pens && o.pens[penId]) ? o.pens[penId].cleanliness : 100;
    if (clean < PEN_CARE.dirty) {
        out.push({ goal: 'muck:' + penId, target: 'muck:' + penId,
            role: 'rancher', kind: 'muck', subject: penSubject(penId),
            priority: 30 + (clean < PEN_CARE.filthy ? 30 : 0),
            build: () => buildMuckOut(world, penId) });
    }
    return out.sort((a, b) => b.priority - a.priority);
}

// Chores the GARDEN station needs now. One chore per plot (the most pressing):
// harvest ripe, plant empty, else water-if-dry, else weed-if-weedy.
function gardenChores(world, o, st) {
    const out = [];
    const sow = (o.env && o.env.plantable.length) ? o.env.plantable[0] : null;
    for (const c of o.crops) {
        if (c.stage === 'ripe') {
            const urgent = c.spoilIn != null && c.spoilIn < 10000;
            const very   = c.spoilIn != null && c.spoilIn < 5000;
            out.push({ goal: 'harvest:' + c.id, target: 'crop:' + c.id,
                role: 'gardener', kind: 'harvest', subject: c.kind + ' (' + c.id + ')',
                priority: 58 + (very ? 45 : urgent ? 22 : 0),
                build: () => buildHarvest(world, c.id) });
        } else if (c.stage === 'empty' && sow) {
            out.push({ goal: 'plant:' + c.plotIndex, target: 'plot:' + c.plotIndex,
                role: 'gardener', kind: 'plant', subject: sow,
                priority: 22, build: () => buildPlant(world, c.plotIndex, sow) });
        } else if (c.stage !== 'empty') {
            // One chore per plot, most pressing first. A badly OVERGROWN plot
            // (weeds choking growth) is pulled ahead of routine watering so weeds
            // actually get cleared; a merely-weedy-but-dry plot is watered first.
            const weeds = c.weeds || 0;
            if (weeds > 80) {
                out.push({ goal: 'weed:' + c.id, target: 'crop:' + c.id,
                    role: 'gardener', kind: 'weed', subject: c.kind + ' (' + c.id + ')',
                    priority: 56, build: () => buildWeed(world, c.id) });
            } else if (c.moisture < 25) {
                out.push({ goal: 'water-crop:' + c.id, target: 'crop:' + c.id,
                    role: 'gardener', kind: 'waterCrop', subject: c.kind + ' (' + c.id + ')',
                    priority: 46 + (c.moisture < 10 ? 20 : 0),
                    build: () => buildWaterCrop(world, c.id) });
            } else if (weeds > CROP_CARE.weedy) {
                out.push({ goal: 'weed:' + c.id, target: 'crop:' + c.id,
                    role: 'gardener', kind: 'weed', subject: c.kind + ' (' + c.id + ')',
                    priority: 30, build: () => buildWeed(world, c.id) });
            }
        }
    }
    return out.sort((a, b) => b.priority - a.priority);
}

// The prioritized chore list for one station (empty if it needs nothing now).
export function stationChores(world, o, stationId) {
    const st = stationById(stationId);
    if (!st) return [];
    return st.kind === 'animal' ? animalChores(world, o, st) : gardenChores(world, o, st);
}

// How well a worker fits a station: role match dominates, the station's domain
// skill breaks ties (a higher-Husbandry rancher takes the busier pen, etc.).
function stationFit(n, st) {
    let s = 0;
    if (n.role === st.role) s += 10;
    if (n.role === 'farmhand') s += 3;     // generalist fits anywhere
    s += statLevel(n, st.domain);
    return s;
}

// Give every worker a station, covering all stations once. STABLE: only fills
// stations that are currently unmanned with workers that have none, so a
// standing assignment never thrashes. Marks each freshly-assigned worker so the
// orchestrator briefs them in (n._justAssigned).
export function assignStations(world) {
    const manned = new Set(world.npcs.filter((n) => n.station).map((n) => n.station));
    const free = world.npcs.filter((n) => !n.station);
    if (!free.length) return;
    for (const st of STATIONS) {
        if (manned.has(st.id)) continue;
        if (!free.length) break;
        free.sort((a, b) => stationFit(b, st) - stationFit(a, st));
        const n = free.shift();
        n.station = st.id;
        n._justAssigned = true;
        manned.add(st.id);
    }
}
