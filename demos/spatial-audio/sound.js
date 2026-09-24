// sound.js — the zone buses and every synth voice in the world.
//
// Each zone owns a bus with its own effect chain (cave: big reverb + lowpass;
// forest: short slap delay + darkened EQ; metal hall: bright reverb + chorus).
// lab.js crossfades the three bus gains by where the listener stands, so
// walking across a bridge morphs one room's acoustics into the next.
//
// Every voice here is positioned once, by hand (setVoiceSpatialPosition):
// nothing in this world moves. demos/scene-audio is the other half, where
// scene nodes carry attached emitters and the engine positions them.

import { EMITTERS } from "/app/world.js";

/** A persistent voice with an envelope, a bus and (optionally) a place. */
function voice(ctx, o) {
    const v = ctx.createVoice();
    ctx.setVoiceWaveform(v, o.wave);
    if (o.freq) ctx.setVoiceFrequency(v, o.freq);
    ctx.setVoiceGain(v, o.gain);
    ctx.setVoiceAttack(v, o.adsr[0]);
    ctx.setVoiceDecay(v, o.adsr[1]);
    ctx.setVoiceSustain(v, o.adsr[2]);
    ctx.setVoiceRelease(v, o.adsr[3]);
    if (o.filter) {
        ctx.setVoiceFilterEnabled(v, true);
        ctx.setVoiceFilterType(v, o.filter[0]);
        ctx.setVoiceFilterFrequency(v, o.filter[1]);
        if (o.filter[2]) ctx.setVoiceFilterQ(v, o.filter[2]);
    }
    if (o.persistent) ctx.setVoicePersistent(v, true);
    if (o.bus != null) ctx.setVoiceBus(v, o.bus);
    if (o.at) {
        ctx.setVoiceSpatialEnabled(v, true);
        ctx.setVoiceSpatialPosition(v, o.at[0], o.at[1], o.at[2]);
        ctx.setVoiceSpatialRefDistance(v, o.ref);
        ctx.setVoiceSpatialMaxDistance(v, o.max);
        if (o.rolloff) ctx.setVoiceSpatialRolloff(v, o.rolloff);
    }
    if (o.start) ctx.startVoice(v, ctx.currentTime);
    return v;
}

/**
 * Build the buses and voices. Returns
 *   { buses: {cave, forest, metal}, sources: [{key, voice, pos, baseGain}],
 *     footstep, drip, wind, bubble }
 * `sources` is every positioned voice, in the form lab.js's occlusion pass
 * reads (baseGain is the unoccluded gain it scales).
 */
export function buildSound(ctx) {
    ctx.masterGain = 1.0;
    const cave = ctx.createBus(), forest = ctx.createBus(), metal = ctx.createBus();

    // Cave: heavy reverb + lowpass.
    ctx.setBusReverbEnabled(cave, true);
    ctx.setBusReverbRoomSize(cave, 0.95);
    ctx.setBusReverbDamping(cave, 0.3);
    ctx.setBusReverbMix(cave, 0.6);
    const slot = ctx.allocateBusFilterSlot(cave);
    ctx.setBusFilterEnabled(cave, slot, true);
    ctx.setBusFilterType(cave, slot, 'lowpass');
    ctx.setBusFilterFrequency(cave, slot, 1200);
    ctx.setBusFilterQ(cave, slot, 0.7);

    // Forest: short delay + EQ with the highs rolled off.
    ctx.setBusDelayEnabled(forest, true);
    ctx.setBusDelayTime(forest, 0.08);
    ctx.setBusDelayFeedback(forest, 0.15);
    ctx.setBusDelayMix(forest, 0.25);
    ctx.setBusEqEnabled(forest, true);
    ctx.setBusEqBandGain(forest, 0, 1.0);    // low: slight boost
    ctx.setBusEqBandGain(forest, 1, 0.0);    // mid: flat
    ctx.setBusEqBandGain(forest, 2, -4.0);   // high: cut

    // Metal hall: bright reverb + subtle chorus.
    ctx.setBusReverbEnabled(metal, true);
    ctx.setBusReverbRoomSize(metal, 0.4);
    ctx.setBusReverbDamping(metal, 0.1);
    ctx.setBusReverbMix(metal, 0.45);
    ctx.setBusChorusEnabled(metal, true);
    ctx.setBusChorusRate(metal, 0.8);
    ctx.setBusChorusDepth(metal, 0.003);
    ctx.setBusChorusMix(metal, 0.2);
    ctx.setBusChorusFeedback(metal, 0.1);
    ctx.setBusChorusBaseDelay(metal, 0.007);

    const E = EMITTERS;
    const sources = [];
    const place = (key, o) => {
        const v = voice(ctx, o);
        sources.push({ key, voice: v, pos: o.at, baseGain: o.gain });
        return v;
    };
    const drone = (key, freq, at, bus, gain) => place(key, {
        wave: 'sine', freq, gain, adsr: [0.5, 0.1, 1.0, 1.0], persistent: true, bus,
        at, ref: 3.0, max: 40.0, rolloff: 1.0, start: true,
    });

    // Ambient drones: a deep cave rumble, layered forest tones, and a
    // slightly detuned metal pair that beats.
    drone('caveDrone', 60, E.caveDrone, cave, 1.5);
    drone('forest1', 180, E.forest1, forest, 0.6);
    drone('forest2', 220, E.forest2, forest, 0.5);
    drone('metal1', 150, E.metal1, metal, 0.8);
    drone('metal2', 150.8, E.metal2, metal, 0.8);

    // Water drip in the cave: a bandpassed noise tick, retriggered at random.
    const drip = place('drip', {
        wave: 'whitenoise', gain: 2.0, adsr: [0.002, 0.04, 0.0, 0.08], filter: ['bandpass', 3000, 5],
        bus: cave, at: E.drip, ref: 1.0, max: 25.0, rolloff: 1.5,
    });
    // Wind in the forest: pink noise whose lowpass lab.js sweeps.
    const wind = place('wind', {
        wave: 'pinknoise', gain: 1.0, adsr: [1.0, 0.5, 1.0, 2.0], filter: ['lowpass', 800],
        persistent: true, bus: forest, at: E.wind, ref: 2.0, max: 30.0, start: true,
    });
    // Resonant hum in the metal hall.
    place('hum', {
        wave: 'sawtooth', freq: 100, gain: 0.8, adsr: [0.3, 0.2, 1.0, 1.0], filter: ['lowpass', 400, 4],
        persistent: true, bus: metal, at: E.hum, ref: 2.0, max: 30.0, start: true,
    });
    // Sky crystal: two detuned sines above the platform.
    place('crystal', {
        wave: 'sine', freq: 880, gain: 0.6, adsr: [0.5, 0.3, 1.0, 1.0], filter: ['bandpass', 900, 3],
        persistent: true, bus: forest, at: E.crystal, ref: 2.0, max: 35.0, start: true,
    });
    place('crystal2', {
        wave: 'sine', freq: 882.5, gain: 0.5, adsr: [0.5, 0.3, 1.0, 1.0],
        persistent: true, bus: forest, at: E.crystal, ref: 2.0, max: 35.0, start: true,
    });
    // Underground pool: a deep drone plus bubbles.
    place('pool', {
        wave: 'sine', freq: 45, gain: 1.2, adsr: [1.0, 0.5, 1.0, 2.0],
        persistent: true, bus: cave, at: E.pool, ref: 2.0, max: 30.0, start: true,
    });
    const bubble = place('bubble', {
        wave: 'whitenoise', gain: 1.5, adsr: [0.003, 0.05, 0.0, 0.1], filter: ['bandpass', 1800, 6],
        bus: cave, at: E.pool, ref: 1.5, max: 25.0,
    });

    // Footsteps: an unpositioned noise burst whose filter and bus follow the
    // floor material under the listener.
    const footstep = voice(ctx, {
        wave: 'whitenoise', gain: 3.0, adsr: [0.005, 0.06, 0.0, 0.04], filter: ['bandpass', 1200],
    });

    return { buses: { cave, forest, metal }, sources, footstep, drip, wind, bubble };
}

/** Floor material for a zone key (see lab.js zoneAt). */
const STEP = {
    cave:   ['lowpass', 800, 'cave'],
    metal:  ['highpass', 2000, 'metal'],
    forest: ['bandpass', 1200, 'forest'],
};

/**
 * Timed one-shots. Each trigger is rate-limited on ctx.currentTime and
 * returns true when it fired, which is what the test counts.
 */
export function oneShots(ctx, snd, random) {
    const rnd = random || Math.random;
    const t = { step: -1e9, drip: -1e9, dripGap: 0.8, bubble: -1e9, bubbleGap: 0.5 };
    const counts = { footsteps: 0, drips: 0, bubbles: 0 };
    const hit = (v, now, len) => { ctx.startVoice(v, now); ctx.stopVoice(v, now + len); };
    return {
        counts,
        /** material: 'cave' | 'forest' | 'metal' (bridges pass their nearer side). */
        footstep(material) {
            const now = ctx.currentTime;
            if (now - t.step < 0.35) return false;
            t.step = now;
            const [type, freq, bus] = STEP[material] || STEP.forest;
            ctx.setVoiceFilterType(snd.footstep, type);
            ctx.setVoiceFilterFrequency(snd.footstep, freq);
            ctx.setVoiceBus(snd.footstep, snd.buses[bus]);
            hit(snd.footstep, now, 0.12);
            counts.footsteps++;
            return true;
        },
        drip() {
            const now = ctx.currentTime;
            if (now - t.drip < t.dripGap) return false;
            t.drip = now;
            t.dripGap = 0.6 + rnd() * 1.2;
            ctx.setVoiceFilterFrequency(snd.drip, 2500 + rnd() * 1500);
            hit(snd.drip, now, 0.1);
            counts.drips++;
            return true;
        },
        bubble() {
            const now = ctx.currentTime;
            if (now - t.bubble < t.bubbleGap) return false;
            t.bubble = now;
            t.bubbleGap = 0.3 + rnd() * 0.8;
            ctx.setVoiceFilterFrequency(snd.bubble, 1200 + rnd() * 2000);
            hit(snd.bubble, now, 0.08);
            counts.bubbles++;
            return true;
        },
    };
}
