// train.js — AI training visualizer + worker orchestration for Stompworld.
// Extracted from the pre-arcade app so the shell plugin can host it as a mode.

'use strict';

import { Level } from "/app/level.js";
import { SwSim } from "/app/sim.js";

/**
 * @param {object} deps
 * @param {number} deps.VIEW_W
 * @param {number} deps.VIEW_H
 * @param {number} deps.TILE
 * @param {object} deps.Art
 * @param {object} deps.Camera2D
 * @param {object} deps.beamCfg  { BEAM_TTL_MS, BEAM_THICKNESS }
 * @param {object} deps.audio   cue functions: land, jump, stomp, die, win, flyer
 */
export function createTraining(deps) {
    const VIEW_W = deps.VIEW_W;
    const VIEW_H = deps.VIEW_H;
    const TILE = deps.TILE;
    const Art = deps.Art;
    const Camera2D = deps.Camera2D;
    const beamCfg = deps.beamCfg;
    const Audio = deps.audio || {};

    const Training = {
        trainer: null,
        mctsWorkers: [],
        pool: null,
        cam: null,
        sim: null,
        fast: false,
        FAST_MULT: 8,
        running: false,

        lvlTilemap: null,
        lvlFlag: null,
        lvlPickup: null,

        NUM_MCTS_WORKERS: 5,
        MCTS_DEPTHS:  [40, 80, 100, 100, 100],
        MCTS_ROLLOUT: [4, 4, 4, 6, 10],

        TRAJ_RING_SIZE: 10,
        trajRing: [],
        primary: null,
        actionIdx: 0,
        tickInDecision: 0,
        tickAcc: 0,
        primaryDone: false,
        primaryStartTick: 0,
        episodesPlayed: 0,
        ghostTracks: [],

        prevPlayer: null,
        prevStomperAlive: null,
        flyerCooldown: 0,

        workerStats: {
            ingested: 0, bufSize: 0, trainSteps: 0,
            lossValue: 0, lossPolicy: 0,
            netVersion: 0n, bestMean: 0, meanReturn: 0, resumed: 0,
        },
        trainingBeams: [],
        mctsStats: [],
        warmupInfo: null,
        poolTopReturn: 0,
        poolCapacity: 32,
        poolAccepted: 0,
        pickupAnimT: 0,

        start() {
            const lvl = Level.buildLevel({ tileSize: TILE, destructible: true });
            this.lvlTilemap = lvl.tilemap;
            this.lvlFlag    = lvl.flag;
            this.lvlPickup  = lvl.pickup;
            this.pickupAnimT = 0;

            this.sim = SwSim.create({
                tilemap: lvl.tilemap, spawn: lvl.spawn,
                stompers: lvl.stompers, flyers: lvl.flyers,
                flag: lvl.flag, pickup: lvl.pickup,
                timeLimit: 600,
            });

            this.cam = Camera2D.create({
                viewW: VIEW_W, viewH: VIEW_H,
                levelW: lvl.tilemap.widthPx,
                levelH: lvl.tilemap.heightPx,
                deadzoneW: 120, deadzoneH: 1024,
            });
            this.cam.snapTo(VIEW_W / 2, VIEW_H / 2);

            this.trajRing = [];
            this.primary = null;
            this.actionIdx = 0;
            this.tickInDecision = 0;
            this.tickAcc = 0;
            this.primaryDone = false;
            this.primaryStartTick = 0;
            this.episodesPlayed = 0;
            this.ghostTracks = [];

            this.prevPlayer = null;
            this.prevStomperAlive = null;
            this.flyerCooldown = 0;

            this.pool = bro.ai.game.grid.createBestCrop({
                capacity: this.poolCapacity,
                depthBonus: 0.001, ageDecay: 0.0001,
                seedTopK: 8, seed: 0xC0DE5EEDn,
            });
            this.poolTopReturn = 0;
            this.poolAccepted = 0;
            this.fast = false;
            this.warmupInfo = null;
            this.trainingBeams = [];
            this.mctsStats = [];
            for (let i = 0; i < this.NUM_MCTS_WORKERS; i++) this.mctsStats.push({});

            this.lastWeightsBytes   = null;
            this.lastWeightsVersion = 0n;
            this.trainerReady       = false;
            this.droppedTuples      = 0;
            this.trainer = new Worker('trainer_worker.js');
            this.trainer.onmessage = (e) => this.onTrainerMessage(e && e.data);

            this.mctsWorkers = [];
            for (let i = 0; i < this.NUM_MCTS_WORKERS; i++) {
                const w = new Worker('mcts_worker.js');
                const idx = i;
                w.onmessage = (e) => this.onMctsMessage(e && e.data, idx);
                w.postMessage({
                    type: 'init',
                    workerId:     idx + 1,
                    iterations:   this.MCTS_DEPTHS[i]  || 100,
                    rolloutDepth: this.MCTS_ROLLOUT[i] || 8,
                });
                this.mctsWorkers.push(w);
            }
            this.running = true;
        },

        stop() {
            this.running = false;
            const all = [this.trainer, ...(this.mctsWorkers || [])].filter(Boolean);
            for (const w of all) {
                try { w.postMessage({ type: 'stop' }); } catch (_) {}
                try { w.terminate(); } catch (_) {}
            }
            this.trainer = null;
            this.mctsWorkers = [];
        },

        sendWeightsTo(worker, bytes, version) {
            const copy = new Uint8Array(bytes.length);
            copy.set(bytes);
            try {
                worker.postMessage({
                    type: 'weights', bytes: copy, version,
                }, [copy.buffer]);
            } catch (_) {}
        },
        broadcastWeights(bytes, version) {
            for (const r of this.mctsWorkers) {
                if (r) this.sendWeightsTo(r, bytes, version);
            }
        },

        onTrainerMessage(m) {
            if (!m) return;
            if (m.type === 'weights') {
                this.lastWeightsBytes   = m.bytes;
                this.lastWeightsVersion = m.version;
                this.broadcastWeights(m.bytes, m.version);
                if (m.stats) Object.assign(this.workerStats, m.stats);
            } else if (m.type === 'stats') {
                if (m.stats) Object.assign(this.workerStats, m.stats);
            } else if (m.type === 'warmup') {
                this.warmupInfo = m.stats || {};
                this.trainerReady = true;
            }
        },

        onMctsMessage(m, idx) {
            if (!m) return;
            if (m.type === 'tuples') {
                this.routeTuples(m);
            } else if (m.type === 'trajectory') {
                this.ingestTrajectory(m);
            } else if (m.type === 'tape_record') {
                for (let i = 0; i < this.mctsWorkers.length; i++) {
                    if (i === idx) continue;
                    const w = this.mctsWorkers[i];
                    if (!w) continue;
                    try {
                        w.postMessage({ type: 'tape_apply', trace: m.trace });
                    } catch (_) {}
                }
            } else if (m.type === 'stats') {
                this.mctsStats[idx] = m;
            } else if (m.type === 'ready') {
                if (this.mctsWorkers[idx]) {
                    try {
                        this.mctsWorkers[idx].postMessage({ type: 'tick' });
                    } catch (_) {}
                }
            }
        },

        routeTuples(m) {
            if (!this.trainer) return;
            if (!this.trainerReady) {
                this.droppedTuples += (m.tuples ? m.tuples.length : 0);
                return;
            }
            try {
                this.trainer.postMessage({
                    type: 'tuples',
                    tuples: m.tuples,
                    reason: m.reason,
                    weight: m.weight | 0,
                });
            } catch (_) {}
        },

        ingestTrajectory(m) {
            this.pool.push({
                snapshot: m.startSnap,
                prefix:   m.actions,
                score:    m.totalReturn,
                depth:    m.searchDepth,
            });
            this.poolAccepted++;
            if (m.totalReturn > this.poolTopReturn) this.poolTopReturn = m.totalReturn;
            if (this.trainer && this.trainerReady) {
                try {
                    this.trainer.postMessage({
                        type: 'trajectory_end',
                        totalReturn: m.totalReturn,
                        reason: m.reason,
                    });
                } catch (_) {}
            }
            this.trajRing.push({
                startSnap:   m.startSnap,
                actions:     m.actions,
                totalReturn: m.totalReturn,
                reason:      m.reason,
                decisions:   m.decisions,
                bestX:       m.bestX,
                workerId:    m.workerId,
                searchDepth: m.searchDepth,
            });
            while (this.trajRing.length > this.TRAJ_RING_SIZE) this.trajRing.shift();
        },

        selectPrimaryAndGhosts() {
            const ring = this.trajRing;
            if (ring.length === 0) return null;
            let window;
            if (ring.length >= 10)     window = ring.slice(-10);
            else if (ring.length >= 5) window = ring.slice(-5);
            else                       window = ring.slice(-1);
            let bestIdx = 0;
            for (let i = 1; i < window.length; i++) {
                if (window[i].totalReturn > window[bestIdx].totalReturn) bestIdx = i;
            }
            const ghosts = [];
            for (let i = 0; i < window.length; i++) {
                if (i !== bestIdx) ghosts.push(window[i]);
            }
            return { primary: window[bestIdx], ghosts };
        },

        extractGhostTrack(traj) {
            const lvl = Level.buildLevel({
                tileSize: TILE, destructible: true, trackDamagedTiles: false,
            });
            const tmp = SwSim.create({
                tilemap: lvl.tilemap, spawn: lvl.spawn,
                stompers: lvl.stompers, flyers: lvl.flyers,
                flag: lvl.flag, pickup: lvl.pickup,
                timeLimit: 600,
            });
            tmp.restore(traj.startSnap);
            const frames = [];
            const FS = SwSim.FRAME_SKIP;
            outer: for (let i = 0; i < traj.actions.length; i++) {
                tmp.beginDecision();
                for (let t = 0; t < FS; t++) {
                    const ended = tmp.tickPhysics(traj.actions[i], t);
                    const p = tmp.player;
                    frames.push({
                        tick: i * FS + t,
                        x: p.x, y: p.y, facing: p.facing,
                        frame: heroFrame(p, i * FS + t),
                    });
                    if (ended) { tmp.endDecision(); break outer; }
                }
                const out = tmp.endDecision();
                if (out.done) break;
            }
            return { frames };
        },

        startPrimaryPlayback() {
            const sel = this.selectPrimaryAndGhosts();
            if (!sel) return false;
            this.primary = sel.primary;
            this.ghostTracks = sel.ghosts.map((t) => this.extractGhostTrack(t));
            this.actionIdx = 0;
            this.tickInDecision = 0;
            this.tickAcc = 0;
            this.primaryDone = false;
            this.sim.reset();
            this.sim.restore(this.primary.startSnap);
            this.primaryStartTick = this.sim.tick;
            this.sim.beginDecision();
            this.episodesPlayed++;
            this.prevPlayer = null;
            this.prevStomperAlive = this.sim.stompers.map((s) => s.alive);
            this.trainingBeams.length = 0;
            return true;
        },

        update(dt) {
            if (!this.running) return;
            this.pickupAnimT += dt;
            if (this.flyerCooldown > 0) this.flyerCooldown -= dt;

            if (!this.primary || this.primaryDone) {
                if (!this.startPrimaryPlayback()) {
                    return;
                }
            }

            const FIXED_DT_MS = SwSim.FIXED_DT_MS;
            const FRAME_SKIP  = SwSim.FRAME_SKIP;
            this.tickAcc += dt * (this.fast ? this.FAST_MULT : 1);
            if (this.tickAcc > 200) this.tickAcc = 200;
            while (this.tickAcc >= FIXED_DT_MS && !this.primaryDone) {
                const action = this.primary.actions[this.actionIdx];
                const ended = this.sim.tickPhysics(action, this.tickInDecision);
                this.tickInDecision++;
                this.tickAcc -= FIXED_DT_MS;
                if (this.tickInDecision >= FRAME_SKIP || ended) {
                    const out = this.sim.endDecision();
                    if (this.lvlTilemap.commitOverlays) {
                        this.lvlTilemap.commitOverlays();
                    }
                    for (const b of this.sim.recentBeams) {
                        this.trainingBeams.push({
                            x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1,
                            ttl: beamCfg.BEAM_TTL_MS, ttlMax: beamCfg.BEAM_TTL_MS,
                        });
                    }
                    this.diffSimAudio();
                    this.tickInDecision = 0;
                    this.actionIdx++;
                    if (out.done || this.actionIdx >= this.primary.actions.length) {
                        this.primaryDone = true;
                        if (!this.fast) {
                            if (this.primary.reason === 'flag') {
                                if (Audio.win) Audio.win();
                            } else if (this.primary.reason === 'death') {
                                if (Audio.die) Audio.die();
                            }
                        }
                        break;
                    }
                    this.sim.beginDecision();
                }
            }

            const p = this.sim.player;
            this.cam.follow(p.x + p.w / 2, VIEW_H / 2);

            if (this.trainingBeams.length) {
                for (const b of this.trainingBeams) b.ttl -= dt;
                this.trainingBeams = this.trainingBeams.filter((b) => b.ttl > 0);
            }
        },

        diffSimAudio() {
            if (this.fast) { this.prevPlayer = null; return; }
            const p = this.sim.player;
            const prev = this.prevPlayer;
            if (prev) {
                if (!prev.onGround && p.onGround) { if (Audio.land) Audio.land(); }
                else if (prev.onGround && !p.onGround && p.vy < -200) {
                    if (Audio.jump) Audio.jump();
                }

                const stomps = this.sim.stompers;
                const prevAlive = this.prevStomperAlive;
                const n = Math.min(stomps.length, prevAlive ? prevAlive.length : 0);
                for (let i = 0; i < n; i++) {
                    if (prevAlive[i] && !stomps[i].alive) {
                        if (Audio.stomp) Audio.stomp();
                        break;
                    }
                }

                if (this.flyerCooldown <= 0) {
                    for (const f of this.sim.flyers) {
                        if (!f.alive) continue;
                        const dx = (f.x + f.w / 2) - (p.x + p.w / 2);
                        const dy = (f.y + f.h / 2) - (p.y + p.h / 2);
                        if (dx * dx + dy * dy < 80 * 80) {
                            if (Audio.flyer) Audio.flyer();
                            this.flyerCooldown = 350;
                            break;
                        }
                    }
                }
            }
            this.prevPlayer = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, onGround: p.onGround };
            this.prevStomperAlive = this.sim.stompers.map((s) => s.alive);
        },

        draw(ctx) {
            if (!this.lvlTilemap) return;
            this.lvlTilemap.draw(ctx, this.cam.x, this.cam.y, VIEW_W, VIEW_H);
            if (this.lvlFlag) {
                const f = this.lvlFlag;
                Art.drawFlag(ctx, f.x - this.cam.x, f.y - this.cam.y);
            }
            if (this.lvlPickup && this.sim && !this.sim.pickupCollected) {
                const pk = this.lvlPickup;
                Art.drawPickup(ctx,
                    pk.x - this.cam.x, pk.y - this.cam.y,
                    this.pickupAnimT);
            }
            if (!this.primary) {
                this.drawLoading(ctx);
                this.drawHud(ctx);
                return;
            }

            for (const s of this.sim.stompers) {
                if (!this.cam.visible(s.x, s.y, s.w, s.h)) continue;
                const fr = !s.alive ? 2 : (Math.floor((s.animT || 0) / 200) % 2);
                Art.drawStomper(ctx,
                    s.x - this.cam.x, s.y - this.cam.y, fr);
            }
            for (const fl of this.sim.flyers) {
                if (!fl.alive) continue;
                if (!this.cam.visible(fl.x, fl.y, fl.w, fl.h)) continue;
                const fr = (Math.floor((fl.animT || 0) / 150) % 2);
                Art.drawFlyer(ctx,
                    fl.x - this.cam.x, fl.y - this.cam.y, fr, (fl.vx || 0) > 0);
            }

            for (const b of this.trainingBeams) {
                const a = Math.max(0, b.ttl / b.ttlMax);
                ctx.save();
                ctx.lineCap = 'round';
                ctx.strokeStyle = 'rgba(255, 220, 80, ' + (a * 0.85).toFixed(3) + ')';
                ctx.lineWidth = beamCfg.BEAM_THICKNESS + 6;
                ctx.beginPath();
                ctx.moveTo(b.x0 - this.cam.x, b.y0 - this.cam.y);
                ctx.lineTo(b.x1 - this.cam.x, b.y1 - this.cam.y);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(255, 255, 240, ' + a.toFixed(3) + ')';
                ctx.lineWidth = Math.max(1, beamCfg.BEAM_THICKNESS - 4);
                ctx.beginPath();
                ctx.moveTo(b.x0 - this.cam.x, b.y0 - this.cam.y);
                ctx.lineTo(b.x1 - this.cam.x, b.y1 - this.cam.y);
                ctx.stroke();
                ctx.restore();
            }

            const curTick = this.sim.tick - this.primaryStartTick;
            ctx.save();
            ctx.globalAlpha = 0.30;
            for (const g of this.ghostTracks) {
                const f = lookupGhostFrame(g.frames, curTick);
                if (!f) continue;
                Art.drawHero(ctx,
                    f.x - this.cam.x, f.y - this.cam.y - 2,
                    f.frame, f.facing < 0);
            }
            ctx.restore();

            const p = this.sim.player;
            Art.drawHero(ctx,
                p.x - this.cam.x, p.y - this.cam.y - 2,
                heroFrame(p, this.sim.tick), p.facing < 0);

            this.drawHud(ctx);
        },

        drawLoading(ctx) {
            const dots = '.'.repeat(1 + ((Date.now() / 400) | 0) % 3);
            const title = this.warmupInfo
                ? 'Waiting for first run' + dots
                : 'Pretraining the agent' + dots;
            const sub = this.warmupInfo
                ? 'Workers warming up after weights publish'
                : 'Behavior cloning + 5000-step pretrain in progress';
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            const boxW = 520, boxH = 110;
            const bx = Math.floor((VIEW_W - boxW) / 2);
            const by = Math.floor((VIEW_H - boxH) / 2);
            ctx.fillRect(bx, by, boxW, boxH);
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 1;
            ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 22px monospace';
            ctx.fillText(title, VIEW_W / 2, by + 36);
            ctx.font = '14px monospace';
            ctx.fillStyle = '#cde';
            ctx.fillText(sub + '…', VIEW_W / 2, by + 72);
            ctx.restore();
        },

        drawHud(ctx) {
            const w = this.workerStats;
            const pr = this.primary;
            let tapeSize = 0, tapeCapacity = 0;
            for (const ms of this.mctsStats) {
                if (ms && ms.tapeSize != null) {
                    tapeSize = ms.tapeSize;
                    tapeCapacity = ms.tapeCapacity || 0;
                    break;
                }
            }
            const lines = [
                'TRAINING — F = fast' + (this.fast ? ' [ON]' : '')
                    + '   C = clear tape   Esc = quit',
                'replay: ep ' + this.episodesPlayed
                    + '   ring ' + this.trajRing.length + '/' + this.TRAJ_RING_SIZE
                    + '   ghosts ' + this.ghostTracks.length
                    + (pr
                        ? ('   primary: ' + pr.reason + ' R=' + pr.totalReturn.toFixed(2)
                           + ' bestX=' + (pr.bestX | 0))
                        : '   [waiting for first trajectory]'),
                'history tape: ' + tapeSize + '/' + tapeCapacity + ' (shared across workers)',
                'pool: ' + this.pool.size + '/' + this.poolCapacity
                    + '   top return ' + this.poolTopReturn.toFixed(2)
                    + '   accepted ' + this.poolAccepted,
            ];
            for (let i = 0; i < this.mctsWorkers.length; i++) {
                const ms = this.mctsStats[i] || {};
                lines.push('mcts#' + (i + 1) + ' (it=' + (this.MCTS_DEPTHS[i] | 0) + '):'
                    + '   ep ' + (ms.episodes | 0)
                    + '   last: ' + (ms.lastReason || 'fresh'));
            }
            if (!this.warmupInfo) {
                const dots = '.'.repeat(1 + ((Date.now() / 400) | 0) % 3);
                lines.push('trainer: warming up (BC + pretrain)' + dots
                    + '   tuples dropped during warmup: ' + (this.droppedTuples | 0));
            } else {
                lines.push('trainer: ingested ' + (w.ingested || 0)
                    + '   buf ' + (w.bufSize || 0)
                    + '   train ' + (w.trainSteps || 0)
                    + '   net v' + (w.netVersion ? w.netVersion.toString() : '0'));
            }
            lines.push('loss  v=' + (+(w.lossValue) || 0).toFixed(4)
                + '   p=' + (+(w.lossPolicy) || 0).toFixed(4)
                + '   mean(20)=' + (+(w.meanReturn) || 0).toFixed(3)
                + '   best=' + (+(w.bestMean) || 0).toFixed(3)
                + (w.resumed ? '   [resumed]' : ''));
            if (this.warmupInfo) {
                const wu = this.warmupInfo;
                if (wu.resumed) {
                    lines.push('warmup: resumed @ mean '
                        + (+wu.meanReturn || 0).toFixed(3));
                } else {
                    lines.push('warmup: kept ' + (wu.kept | 0) + '/' + (wu.attempts | 0)
                        + ' (flag ' + (wu.flags | 0) + ')'
                        + '   tuples ' + (wu.tuplesPushed | 0)
                        + '   pretrain ' + (wu.pretrainSteps | 0)
                        + ' p=' + (+wu.pretrainLossPolicy || 0).toFixed(3));
                }
            }
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(8, 8, 460, 14 * lines.length + 10);
            ctx.fillStyle = '#fff';
            ctx.font = '12px monospace';
            ctx.textBaseline = 'top';
            for (let i = 0; i < lines.length; i++) {
                ctx.fillText(lines[i], 14, 12 + i * 14);
            }
            ctx.restore();
        },

        toggleFast() {
            this.fast = !this.fast;
        },

        clearTape() {
            for (const w of this.mctsWorkers || []) {
                try { w.postMessage({ type: 'clear_tape' }); } catch (_) {}
            }
        },
    };

    function heroFrame(p, tick) {
        if (!p.onGround) return 3;
        if (Math.abs(p.vx) > 8) return 1 + (((tick / 8) | 0) % 2);
        return 0;
    }

    function lookupGhostFrame(frames, tick) {
        if (frames.length === 0 || tick < 0) return null;
        const last = frames[frames.length - 1];
        if (tick > last.tick) return null;
        if (tick <= frames[0].tick) return frames[0];
        let lo = 0, hi = frames.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (frames[mid].tick <= tick) lo = mid; else hi = mid;
        }
        return frames[lo];
    }

    return Training;
}
