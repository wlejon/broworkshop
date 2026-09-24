// pets.js — the active pet: swims to its next chore and does it on a
// cooldown. bubbler feeds, coinkeeper collects, pufferguard fights,
// alchem upgrades coins, sprout drops free pellets.

import { petById, coinValue } from "/app/economy.js";
import { dot, poly } from "/app/paint.js";

const COOLDOWN = {             // [base, random extra] ms between chores
    bubbler: [5000, 3000],
    coinkeeper: [4000, 2000],
    pufferguard: [1400, 1200],
    alchem: [10000, 6000],
    sprout: [9000, 6000],
};
const SWIM_SPEED = 80;

function cooldown(id) {
    const c = COOLDOWN[id];
    return c ? c[0] + Math.random() * c[1] : 5000;
}

export function makePet(petId) {
    const def = petById(petId);
    if (!def) return null;
    return { id: petId, def, x: 600, y: 500, tx: 600, ty: 500, actCooldown: cooldown(petId), wag: 0 };
}

const CHORES = {
    bubbler(p, w) {                                  // pellet over the hungriest fish
        let hungry = null;
        for (const f of w.fish) if (!f.dead && f.hunger < 60 && (!hungry || f.hunger < hungry.hunger)) hungry = f;
        if (hungry) {
            w.addPellet(hungry.x, w.tankTop + 20);
            p.tx = hungry.x; p.ty = hungry.y - 30;
        }
        return cooldown(p.id);
    },
    coinkeeper(p, w) {                               // fetch the oldest coin
        let oldest = null;
        for (const c of w.coins) if (c.alive && !c._consumed && (!oldest || c.age > oldest.age)) oldest = c;
        if (!oldest || oldest.age <= 3) return cooldown(p.id);
        p.tx = oldest.x; p.ty = oldest.y;
        if (Math.hypot(p.x - oldest.x, p.y - oldest.y) >= 20) return 100;   // still swimming
        w.collectCoin(oldest);
        return cooldown(p.id);
    },
    pufferguard(p, w) {                              // bite the nearest intruder
        let nearest = null, nd = Infinity;
        for (const iu of w.intruders) {
            if (iu.dead) continue;
            const d = Math.hypot(iu.x - p.x, iu.y - p.y);
            if (d < nd) { nd = d; nearest = iu; }
        }
        if (!nearest) {                              // patrol
            p.tx = w.tankLeft + Math.random() * (w.tankRight - w.tankLeft);
            p.ty = w.tankTop + Math.random() * (w.tankBottom - w.tankTop);
            return cooldown(p.id);
        }
        p.tx = nearest.x; p.ty = nearest.y;
        if (nd >= 40) return 200;
        w.damageIntruder(nearest, 1);
        return cooldown(p.id);
    },
    alchem(p, w) {                                   // transmute a small coin up a tier
        const cands = w.coins.filter((c) => c.alive && !c._consumed && c.tier < 5);
        if (cands.length) {
            const pick = cands[Math.floor(Math.random() * cands.length)];
            p.tx = pick.x; p.ty = pick.y;
            pick.tier = Math.min(6, pick.tier + 1);
            pick.value = coinValue(pick.tier);
            w.onAlchemUpgrade(pick);
        }
        return cooldown(p.id);
    },
    sprout(p, w) {                                   // free pellet somewhere
        const px = w.tankLeft + 30 + Math.random() * (w.tankRight - w.tankLeft - 60);
        w.addPellet(px, w.tankTop + 20);
        p.tx = px; p.ty = w.tankTop + 40;
        return cooldown(p.id);
    },
};

export function stepPet(p, ms, w) {
    p.wag += ms / 120;
    p.actCooldown -= ms;
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 2) {
        p.x += dx / d * SWIM_SPEED * (ms / 1000);
        p.y += dy / d * SWIM_SPEED * (ms / 1000);
    } else {
        p.x += Math.sin(p.wag) * 0.2;                // idle wobble
    }
    if (p.actCooldown <= 0) p.actCooldown = CHORES[p.id](p, w);
}

const LOOKS = {
    bubbler(ctx) {                                   // pale blue blob
        dot(ctx, 0, 0, 14, "#9fe0ff");
        dot(ctx, -4, -4, 3, "#ffffff");
        eyes(ctx, 5);
    },
    coinkeeper(ctx) {                                // gold pouch
        dot(ctx, 0, 0, 14, "#f2c95b");
        ctx.fillStyle = "#a6751a";
        ctx.fillRect(-8, 4, 16, 4);
        eyes(ctx, 4);
    },
    pufferguard(ctx) {                               // spiky green puffer
        dot(ctx, 0, 0, 16, "#6ad14a");
        for (let s = 0; s < 10; s++) {
            const a = s / 10 * Math.PI * 2;
            poly(ctx, "#4a9a36", [
                [Math.cos(a) * 14, Math.sin(a) * 14],
                [Math.cos(a) * 22, Math.sin(a) * 22],
                [Math.cos(a + 0.2) * 14, Math.sin(a + 0.2) * 14],
            ]);
        }
        eyes(ctx, 5);
    },
    alchem(ctx) {                                    // purple, wizard hat
        dot(ctx, 0, 0, 14, "#b06acb");
        poly(ctx, "#702a90", [[-10, -8], [0, -20], [10, -8]]);
        eyes(ctx, 4);
    },
    sprout(ctx) {                                    // green with a leaf
        dot(ctx, 0, 0, 13, "#a8f06c");
        ctx.fillStyle = "#60a830";
        ctx.beginPath();
        ctx.ellipse(0, -16, 5, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        eyes(ctx, 4);
    },
};

function eyes(ctx, r) {
    dot(ctx, -r, -2, 3, "#ffffff");
    dot(ctx, r, -2, 3, "#ffffff");
    dot(ctx, -r + 1, -2, 1.5, "#000000");
    dot(ctx, r + 1, -2, 1.5, "#000000");
}

export function drawPet(ctx, p) {
    ctx.save();
    ctx.translate(p.x, p.y + Math.sin(p.wag) * 2);
    (LOOKS[p.id] || ((c) => dot(c, 0, 0, 14, "#cccccc")))(ctx);
    ctx.restore();
}
