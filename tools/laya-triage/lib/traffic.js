// Open-loop traffic: requests arrive at a Poisson rate regardless of how fast
// answers come back (the way real users arrive), plus one-shot bursts. Every
// request is a real predictAsync call on the loaded model.
//
// Arrivals are issued from the frame loop, so at 60 fps a request can land up
// to one frame (~16 ms) after its ideal arrival time; the latency reported is
// the engine's (timing.totalMs: submit -> result ready), plus the extra wait
// until the page's next frame picked it up (seenMs).

import { QUESTIONS, nextTrafficState } from '/app/lib/presets.js';

export const traffic = {
  running: false,
  rate: 100,            // requests / second while running
  deadlineMs: 30,
  inFlight: 0,
  submitted: 0,
  completed: 0,
  failed: 0,
  lastError: '',
  records: [],          // recent completions, oldest first
};

const MAX_RECORDS = 1500;
let nextArrival = 0;

function submit(model, now) {
  traffic.inFlight++;
  traffic.submitted++;
  const t0 = now;
  model.predictAsync(nextTrafficState(), QUESTIONS, { priority: 0, deadlineMs: traffic.deadlineMs })
    .then((res) => {
      traffic.inFlight--;
      traffic.completed++;
      const t = res.timing;
      traffic.records.push({
        at: Date.now(), totalMs: t.totalMs, queueMs: t.queueMs, forwardMs: t.forwardMs,
        seenMs: Date.now() - t0, device: t.device, batchRequests: t.batchRequests,
        batchTokens: t.batchTokens, missed: t.deadlineMissed,
        department: res.answers.department.choice,
      });
      if (traffic.records.length > MAX_RECORDS) traffic.records.splice(0, traffic.records.length - MAX_RECORDS);
    }, (e) => {
      traffic.inFlight--;
      traffic.failed++;
      traffic.lastError = String(e && e.message || e);
    });
}

export function setRunning(on) {
  traffic.running = !!on;
  nextArrival = Date.now();
}

export function burst(model, n) {
  const now = Date.now();
  for (let i = 0; i < n; i++) submit(model, now);
}

// Call once per frame.
export function tickTraffic(model) {
  if (!model || !traffic.running || traffic.rate <= 0) return;
  const now = Date.now();
  if (now - nextArrival > 500) nextArrival = now;       // after a stall, do not flood
  while (nextArrival <= now) {
    submit(model, now);
    nextArrival += -Math.log(1 - Math.random()) * 1000 / traffic.rate;
  }
}

export function resetTraffic() {
  traffic.submitted = traffic.completed = traffic.failed = 0;
  traffic.records.length = 0;
  traffic.lastError = '';
}

// Percentiles over completions in the last `windowMs`.
export function windowSummary(windowMs) {
  const cut = Date.now() - windowMs;
  const lat = [];
  let missed = 0;
  let seen = 0;
  for (let i = traffic.records.length - 1; i >= 0; i--) {
    const r = traffic.records[i];
    if (r.at < cut) break;
    lat.push(r.totalMs);
    seen += r.seenMs;
    if (r.missed) missed++;
  }
  lat.sort((a, b) => a - b);
  const pct = (p) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : 0;
  return {
    n: lat.length, rps: lat.length / (windowMs / 1000),
    p50: pct(0.5), p99: pct(0.99), max: lat.length ? lat[lat.length - 1] : 0,
    missed, seenMean: lat.length ? seen / lat.length : 0,
  };
}
