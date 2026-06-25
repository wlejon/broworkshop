// env.js — the environmental substrate: seasons, weather, and day/night.
//
// Pure and serializable like world.js. world.js owns ONE env state object
// (world.env) and calls stepEnv() each tick; everything here mutates only that
// object plus the passive crop/pool effects it's explicitly handed. The sim
// stays reproducible: weather rolls use the world's deterministic RNG, never
// Math.random.
//
// stepEnv() recomputes, every tick:
//   - season   (spring/summer/fall/winter) from world.clock.day
//   - dayPhase (dawn/day/dusk/night)        from world.clock.hour
//   - weather  (clear/rain/drought/frost/storm), a season-biased state machine
//   - temperature (a number, season + weather + phase)
//   - mods     {growthMult, moistureDecayMult, thirstMult, hungerMult,
//               produceMult, rainMoisture, poolWater} — the knobs world.js
//               folds into its animal/crop integration.
// It also applies the passive weather effects directly (rain raising crop
// moisture and refilling the water pool).

export const SEASONS = ['spring', 'summer', 'fall', 'winter'];

// Each season lasts this many in-game days. DAY_LENGTH_MS is 120 s, so a season
// is ~4 min and a full year ~16 min of real-time sim — but under headless
// advanceTime the whole cycle is observable in seconds.
export const SEASON_DAYS = 2;

// Weather episode length re-rolls within this window (ms of sim time).
const WEATHER_MIN_MS = 18000;
const WEATHER_MAX_MS = 40000;

// Season -> base crop growth multiplier.
const SEASON_GROWTH = { spring: 1.2, summer: 1.3, fall: 0.9, winter: 0.45 };
// Season -> baseline temperature (number, °C-ish).
const SEASON_TEMP = { spring: 14, summer: 27, fall: 11, winter: -1 };
// Season -> which crop kinds may be planted. Winter sprouts nothing.
const PLANTABLE = {
    spring: ['wheat', 'carrot', 'tomato'],
    summer: ['corn', 'tomato', 'pumpkin'],
    fall:   ['wheat', 'pumpkin', 'carrot'],
    winter: [],
};

// Season-biased weather weights (rain commoner in spring, drought in summer,
// frost in winter, etc.). Used by the deterministic weighted roll below.
const WEATHER_WEIGHTS = {
    spring: { clear: 4.0, rain: 4.0, storm: 1.2, drought: 0.4, frost: 0.6 },
    summer: { clear: 4.0, drought: 3.2, storm: 1.2, rain: 1.5, frost: 0.0 },
    fall:   { clear: 4.0, rain: 3.0, frost: 1.2, storm: 1.0, drought: 0.6 },
    winter: { clear: 3.0, frost: 4.0, storm: 1.0, rain: 0.6, drought: 0.0 },
};

// Weather/phase temperature deltas.
const WEATHER_TEMP = { clear: 0, rain: -3, drought: 8, frost: -9, storm: -4 };
const PHASE_TEMP   = { dawn: -2, day: 1, dusk: -1, night: -4 };

// Passive rain rates (per second): moisture added to growing crops, and water
// added to the well/water pool.
const RAIN_MOISTURE = 4.0;
const RAIN_POOL     = 1.5;

export function createEnv() {
    return {
        season: 'spring', seasonDay: 0, year: 1,
        weather: 'clear', weatherTimer: 12000,
        temperature: SEASON_TEMP.spring,
        dayPhase: 'day',
        plantable: PLANTABLE.spring.slice(),
        mods: {
            growthMult: 1, moistureDecayMult: 1, thirstMult: 1, hungerMult: 1,
            produceMult: 1, needMult: 1, rainMoisture: 0, poolWater: 0,
        },
    };
}

function phaseFromHour(h) {
    if (h >= 5 && h < 8)  return 'dawn';
    if (h >= 8 && h < 18) return 'day';
    if (h >= 18 && h < 21) return 'dusk';
    return 'night';
}

function rollWeather(season, rng) {
    const w = WEATHER_WEIGHTS[season];
    let total = 0;
    for (const k in w) total += w[k];
    let r = rng() * total;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return 'clear';
}

function computeMods(env) {
    let growthMult = SEASON_GROWTH[env.season] || 1;
    let moistureDecayMult = 1, thirstMult = 1, hungerMult = 1, produceMult = 1;
    let rainMoisture = 0, poolWater = 0;

    switch (env.weather) {
        case 'rain':
            moistureDecayMult = 0; rainMoisture = RAIN_MOISTURE; poolWater = RAIN_POOL;
            thirstMult = 0.9; growthMult *= 1.05; break;
        case 'storm':
            moistureDecayMult = 0; rainMoisture = RAIN_MOISTURE * 1.6; poolWater = RAIN_POOL * 1.8;
            growthMult *= 0.5; break;
        case 'drought':
            moistureDecayMult = 2.2; thirstMult = 1.6; growthMult *= 0.8; break;
        case 'frost':
            hungerMult = 1.5; growthMult *= 0.2; thirstMult = 0.85; break;
        case 'clear':
        default: break;
    }

    // Day/night: production halts overnight, crops barely grow; shoulders are
    // partial. needMult slows animal hunger/thirst at night so a small night
    // crew can cope — the compensation that keeps the farm alive once workers
    // sleep (Pass D).
    let needMult = 1.0;
    if (env.dayPhase === 'night') { produceMult = 0; growthMult *= 0.3; needMult = 0.4; }
    else if (env.dayPhase === 'dawn' || env.dayPhase === 'dusk') { produceMult = 0.5; growthMult *= 0.7; needMult = 0.75; }

    return { growthMult, moistureDecayMult, thirstMult, hungerMult, produceMult, needMult, rainMoisture, poolWater };
}

function computeTemp(env) {
    let t = SEASON_TEMP[env.season] || 0;
    t += WEATHER_TEMP[env.weather] || 0;
    t += PHASE_TEMP[env.dayPhase] || 0;
    return Math.round(t);
}

// Advance the env one tick and apply its passive effects to the world.
export function stepEnv(world, dt, rng) {
    const env = world.env;
    const s = dt / 1000;
    const clock = world.clock;

    // Season from the absolute day index.
    const dayIdx = clock.day - 1;
    env.year = Math.floor(dayIdx / (SEASON_DAYS * 4)) + 1;
    env.season = SEASONS[Math.floor(dayIdx / SEASON_DAYS) % 4];
    env.seasonDay = dayIdx % SEASON_DAYS;
    env.plantable = PLANTABLE[env.season];

    env.dayPhase = phaseFromHour(clock.hour);

    // Weather state machine: count down, then re-roll a season-biased episode.
    env.weatherTimer -= dt;
    if (env.weatherTimer <= 0) {
        env.weather = rollWeather(env.season, rng);
        env.weatherTimer = WEATHER_MIN_MS + rng() * (WEATHER_MAX_MS - WEATHER_MIN_MS);
    }

    env.mods = computeMods(env);
    env.temperature = computeTemp(env);

    // Passive effects: rain/storm water the crops and top the pool back up.
    const m = env.mods;
    if (m.rainMoisture > 0) {
        for (const c of world.crops) {
            if (c.stage !== 'empty') c.moisture = Math.min(100, c.moisture + m.rainMoisture * s);
        }
    }
    // Rain refills the renewable WELL (the natural source) when present, else
    // the working water pool directly.
    if (m.poolWater > 0) {
        if (world.well) world.well.level = Math.min(world.well.cap, world.well.level + m.poolWater * s);
        else world.resources.water += m.poolWater * s;
    }
}

// Serializable env subset for observe(). plantable is what a future orchestrator
// reads to avoid issuing out-of-season plant orders.
export function envObserve(env) {
    return {
        season: env.season, seasonDay: env.seasonDay, year: env.year,
        weather: env.weather, temperature: env.temperature,
        dayPhase: env.dayPhase, plantable: env.plantable.slice(),
    };
}

// Weather/season-derived alerts, merged into observe().alerts.
export function envAlerts(env) {
    const a = [];
    if (env.weather === 'drought') a.push({ level: 'warning', who: 'weather', msg: 'drought — crops drying fast' });
    else if (env.weather === 'frost') a.push({ level: 'warning', who: 'weather', msg: 'frost — animals need extra feed' });
    else if (env.weather === 'storm') a.push({ level: 'warning', who: 'weather', msg: 'storm — growth stalled' });
    else if (env.weather === 'rain')  a.push({ level: 'info', who: 'weather', msg: 'rain — crops watering themselves' });
    if (env.season === 'winter' && env.plantable.length === 0) {
        a.push({ level: 'info', who: 'season', msg: 'winter — nothing will sprout' });
    }
    return a;
}
