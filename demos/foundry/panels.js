// demos/foundry/panels.js — Engineering Spec Sheet, Live Dyno Curve Plot,
// Parameter Inspector, Immediate Out-of-Spec Ticker, and Repair Autopsy.

import { h, clear } from "/lib/kit/dom.js";
import { fitCanvas } from "/lib/kit/gauges.js";
import { MATERIALS, MATERIAL_IDS } from "/lib/foundry/materials.js";
import { PRIMITIVES } from "/lib/foundry/primitives.js";

const GRADE_CLS = { SAFE: 'ok', NOMINAL: 'ok', WEAR_RISK: 'warn', UNPROTECTED: 'err', INVALID: 'err' };

export function fmtSize(sz) {
    const m = Math.max(...sz);
    if (m < 1.0) return sz.map((v) => (v * 100).toFixed(0)).join('×') + ' cm';
    return sz.map((v) => v.toFixed(2)).join('×') + ' m';
}

export function fmtTorque(nm) {
    return nm >= 1000 ? (nm / 1000).toFixed(1) + ' kN·m' : nm.toFixed(0) + ' N·m';
}

/** Render the Certified Spec Sheet card (including live Motion Interaction Audit findings). */
export function renderSpecSheet(el, compiled, onSelectTopNode = null) {
    clear(el);
    if (!compiled) return;
    const sp = compiled.spec;
    const badge = h('span.k-badge.' + (GRADE_CLS[sp.grade] || ''), null, sp.grade.replace('_', ' '));
    const head = h('div.f-spec-head', null,
        h('div', null, h('b', null, compiled.name), h('span.dim', null, ` · ${compiled.scale}`)),
        badge);

    const kv = h('div.k-kv', null,
        row('Bounding box', fmtSize(sp.boundingBox)),
        row('Mass / Cost', `${sp.massKg.toFixed(1)} kg · $${sp.cost.toFixed(0)}`),
        row('Parts', `${sp.partCount} (${sp.subAssemblyCount} modules)`),
        row('Compile time', `${sp.compileMs.toFixed(2)} ms`),
    );
    if (compiled.primaryChain) {
        kv.append(
            row('Ratio / Eff', `${sp.primaryRatio.toFixed(2)}:1 · ${(sp.primaryEfficiency * 100).toFixed(0)}%`),
            row('No-load RPM', `${sp.primaryNoLoadRpm.toFixed(0)} rpm`),
            row('Torque (cont/peak)', `${fmtTorque(sp.primaryContTorqueNm)} / ${fmtTorque(sp.primaryPeakTorqueNm)}`),
            row('Rated power', sp.primaryPowerW >= 1000 ? `${(sp.primaryPowerW / 1000).toFixed(1)} kW` : `${sp.primaryPowerW.toFixed(0)} W`),
        );
    }
    if (sp.topSpeedMs > 0) kv.append(row('Drive speed', `${sp.topSpeedMs.toFixed(1)} m/s (${(sp.topSpeedMs * 3.6).toFixed(0)} km/h)`));
    if (sp.weaponEnergyJ > 0) kv.append(row('Weapon KE', `${(sp.weaponEnergyJ / 1000).toFixed(2)} kJ`));

    const verdicts = h('div.f-verdicts');
    // Live Motion Interaction Audit summary + clickable findings
    const ma = compiled.motionAudit;
    if (ma) {
        if (ma.counts.errors === 0 && ma.counts.warnings === 0) {
            verdicts.append(h('div.f-verdict.ok', null,
                h('span.f-tag', null, 'MOTION AUDIT'), ' CLEAN — 0 swept clashes, 0 frame clips, 0 shaft obstructions'));
        } else {
            for (const f of ma.findings.slice(0, 6)) {
                const cls = f.severity === 'error' ? 'err' : 'warn';
                const item = h('div.f-verdict.' + cls, {
                    style: onSelectTopNode && f.topNodeA ? { cursor: 'pointer' } : null,
                    onclick: () => { if (onSelectTopNode && f.topNodeA) onSelectTopNode(f.topNodeA); },
                }, h('span.f-tag', null, f.kind.replace('_', ' ')), ' ', f.text);
                verdicts.append(item);
            }
        }
    }

    for (const v of sp.failSafeVerdicts) {
        verdicts.append(h('div.f-verdict.' + (v.safe ? 'ok' : 'err'), null,
            h('span.f-tag', null, v.chainLabel), ' ', v.text));
    }
    for (const w of sp.warnings.slice(0, 4)) {
        verdicts.append(h('div.f-verdict.warn', null, w.text));
    }

    el.append(head, kv, verdicts);
}

/** Render the parameter editor + 3D spatial placement controls for the selected Blueprint node. */
export function renderInspector(el, node, library, compiled, onMutate, onDrillDown, onDelete, runtime = null) {
    clear(el);
    if (!node) {
        el.append(h('div.dim', null, 'Click any component or module in the Blueprint to tune its physical specs & 3D position. Double-click a Compiled Module to drill inside.'));
        return;
    }

    const addPlacementControls = (parent) => {
        if (!node.pos3d) node.pos3d = [0, 0.12, 0];
        const span = Math.max(0.8, compiled?.bounds?.size ? Math.max(...compiled.bounds.size) * 1.4 : 1.0);
        const stepM = span > 2.5 ? 0.05 : 0.01;
        const unit = span > 2.5 ? 'm' : 'cm';
        const scale = unit === 'cm' ? 100 : 1;
        const form3d = h('div.f-form');
        ['X', 'Y', 'Z'].forEach((ax, idx) => {
            const val = node.pos3d[idx] || 0;
            const out = h('span.k-val', null, (val * scale).toFixed(unit === 'cm' ? 0 : 2) + ' ' + unit);
            const rng = h('input', { type: 'range', min: (-span).toFixed(2), max: span.toFixed(2), step: stepM, value: val });
            rng.addEventListener('input', () => {
                const nv = +rng.value;
                node.pos3d[idx] = nv;
                out.textContent = (nv * scale).toFixed(unit === 'cm' ? 0 : 2) + ' ' + unit;
                onMutate(`Move ${node.label} ${ax}`);
            });
            form3d.append(h('label.k-field', null, h('span', null, `Pos ${ax}`), rng, out));
        });
        const yawDeg = Math.round(((node.yaw3d || 0) * 180) / Math.PI);
        const yawOut = h('span.k-val', null, yawDeg + '°');
        const yawRng = h('input', { type: 'range', min: -180, max: 180, step: 15, value: yawDeg });
        yawRng.addEventListener('input', () => {
            const deg = +yawRng.value;
            node.yaw3d = (deg * Math.PI) / 180;
            yawOut.textContent = deg + '°';
            onMutate(`Rotate ${node.label}`);
        });
        form3d.append(h('label.k-field', null, h('span', null, 'Yaw'), yawRng, yawOut));
        parent.append(h('div.k-cap', null, '3D Placement'), form3d);
    };

    if (node.type === 'assembly') {
        const sub = library[node.ref];
        el.append(
            h('div.f-insp-title', null, h('b', null, node.label), h('span.k-badge', null, 'COMPILED MODULE')),
            h('div.k-note', null, sub?.description || 'Nested compiled sub-assembly.'),
        );
        addPlacementControls(el);
        el.append(
            h('div.k-row.f-gap', null,
                h('button.primary.small', { onclick: () => onDrillDown(node.ref, node) }, 'Open Sub-Assembly ›'),
                h('button.danger.small', { onclick: () => onDelete(node.id) }, 'Remove')),
        );
        return;
    }

    const def = PRIMITIVES[node.type];
    if (!def) return;
    const part = compiled?.parts.find((p) => p.path === node.id);
    const ps = runtime?.partState?.get(node.id) || null;

    el.append(
        h('div.f-insp-title', null, h('b', null, node.label), h('span.dim', null, def.cat)),
        h('div.k-note', null, def.note),
    );

    const form = h('div.f-form');
    for (const [key, sc] of Object.entries(def.schema || {})) {
        const val = node.params[key] ?? def.defaults[key];
        if (sc.kind === 'material') {
            const sel = h('select', null, MATERIAL_IDS.map((mid) => h('option', { value: mid }, MATERIALS[mid].label)));
            sel.value = val;
            sel.addEventListener('change', () => { node.params[key] = sel.value; onMutate(`Set ${node.label} material`); });
            form.append(h('label.k-field', null, h('span', null, sc.label), sel));
        } else if (sc.options) {
            const sel = h('select', null, Object.entries(sc.options).map(([k, lbl]) => h('option', { value: k }, lbl)));
            sel.value = val;
            sel.addEventListener('change', () => { node.params[key] = sel.value; onMutate(`Set ${node.label} ${sc.label}`); });
            form.append(h('label.k-field', null, h('span', null, sc.label), sel));
        } else {
            const out = h('span.k-val', null, formatNum(val, sc));
            const rng = h('input', { type: 'range', min: sc.min, max: sc.max, step: sc.step, value: val });
            rng.addEventListener('input', () => {
                const nv = +rng.value;
                node.params[key] = nv;
                out.textContent = formatNum(nv, sc);
                onMutate(`Tune ${node.label} ${sc.label}`);
            });
            form.append(h('label.k-field', null, h('span', null, sc.label), rng, out));
        }
    }
    el.append(form);
    addPlacementControls(el);

    if (part) {
        const a = part.analysis;
        el.append(
            h('div.k-cap', null, 'Computed Spec'),
            h('div.k-kv', null,
                row('Mass / Cost', `${a.massKg.toFixed(2)} kg · $${a.cost.toFixed(1)}`),
                row('Dimensions', fmtSize(a.size)),
                ...(a.rated.torqueContNm ? [row('Torque cont/peak', `${fmtTorque(a.rated.torqueContNm)} / ${fmtTorque(a.rated.torquePeakNm)}`)] : []),
                ...(a.rated.radialContN ? [row('Radial cont/peak', `${(a.rated.radialContN / 1000).toFixed(1)} / ${(a.rated.radialPeakN / 1000).toFixed(1)} kN`)] : []),
                ...(ps ? [row('Live State', `${ps.rpm.toFixed(0)} rpm · ${ps.tempC.toFixed(0)}°C · W:${(ps.wear * 100).toFixed(0)}%`)] : []),
                row('Failure mode', a.failureMode + (a.isSacrificial ? ' (SACRIFICIAL FUSE)' : a.isLimiter ? ' (TORQUE LIMITER)' : '')),
            ),
        );
    }

    el.append(h('div.k-row.f-gap', null, h('button.danger.small', { onclick: () => onDelete(node.id) }, 'Remove Component')));
}

/** Draw the live Torque-Speed & Power Dyno Curve with real-time operating point! */
export function drawDynoPlot(canvas, compiled, runtime) {
    const { ctx, w, h } = fitCanvas(canvas);
    if (!(w > 10 && h > 10)) return;
    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(0, 0, w, h);

    const ch = compiled?.primaryChain;
    if (!ch || !ch.curve.length) {
        ctx.fillStyle = '#64748b';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText('No rotational powertrain in this assembly', 12, h * 0.5);
        return;
    }

    const pad = { l: 38, r: 12, t: 16, b: 22 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const maxRpm = Math.max(10, ch.noLoadRpmOut * 1.08);
    const maxTau = Math.max(10, ch.stallTorqueOut * 1.15, ch.peakTorqueOut * 1.1);
    const maxP = Math.max(10, ...ch.curve.map((c) => c.powerW)) * 1.15;

    const X = (rpm) => pad.l + (rpm / maxRpm) * pw;
    const Yt = (tau) => pad.t + ph - Math.min(1, tau / maxTau) * ph;
    const Yp = (pwr) => pad.t + ph - Math.min(1, pwr / maxP) * ph;

    // Grid
    ctx.strokeStyle = 'rgba(148,163,184,0.12)';
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
        const y = pad.t + (ph * k) / 4;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    }

    // Continuous safe ceiling line (amber dashed)
    if (isFinite(ch.contTorqueOut) && ch.contTorqueOut < maxTau) {
        const y = Yt(ch.contTorqueOut);
        ctx.strokeStyle = 'rgba(234, 179, 8, 0.7)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillStyle = '#eab308';
        ctx.font = '9px monospace';
        ctx.fillText(`CONT ${fmtTorque(ch.contTorqueOut)}`, pad.l + 4, y - 3);
    }

    // Peak failure ceiling line (red dashed)
    if (isFinite(ch.peakTorqueOut) && ch.peakTorqueOut < maxTau) {
        const y = Yt(ch.peakTorqueOut);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.font = '9px monospace';
        ctx.fillText(`LIMIT ${fmtTorque(ch.peakTorqueOut)}`, w - pad.r - 86, y - 3);
    }
    ctx.setLineDash([]);

    // Power curve (cyan)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ch.curve.forEach((pt, i) => {
        const x = X(pt.rpm), y = Yp(pt.powerW);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Torque curve (amber)
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ch.curve.forEach((pt, i) => {
        const x = X(pt.rpm), y = Yt(pt.torque);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Live operating dot from runtime!
    if (runtime) {
        const cs = runtime.chainState.get(ch.id);
        if (cs) {
            const rpm = Math.abs(cs.omegaOut * 60 / (2 * Math.PI));
            const tau = Math.abs(cs.torqueOut);
            const dx = X(Math.min(maxRpm, rpm)), dy = Yt(Math.min(maxTau, tau));
            ctx.fillStyle = cs.broken ? '#ef4444' : cs.slipping ? '#e879f9' : '#4ade80';
            ctx.beginPath(); ctx.arc(dx, dy, 5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        }
    }

    // Axis labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9.5px monospace';
    ctx.fillText(fmtTorque(maxTau), 3, pad.t + 8);
    ctx.fillText('0', 24, pad.t + ph);
    ctx.fillText(`0 rpm`, pad.l, h - 6);
    ctx.fillText(`${maxRpm.toFixed(0)} rpm`, w - pad.r - 48, h - 6);
}

/** Render live Immediate Out-Of-Spec Alert Feed & Per-Part Wear/Repair Autopsy. */
export function renderLiveTelemetry(eventsEl, partsEl, autopsyEl, runtimes) {
    // 1. Immediate Out-of-Spec Events (newest first!)
    const allEv = [];
    for (const rt of runtimes) {
        for (const ev of rt.events) allEv.push(ev);
    }
    allEv.sort((a, b) => b.t - a.t);
    clear(eventsEl);
    if (!allEv.length) {
        eventsEl.append(h('div.dim', null, 'All parts within spec. Run Dyno or Combat Arena to stress-test bounds.'));
    } else {
        for (const ev of allEv.slice(0, 18)) {
            eventsEl.append(h('div.f-ev.' + ev.severity, null,
                h('span.f-ev-t', null, `${ev.t.toFixed(2)}s`),
                h('b', null, `${ev.machine ? ev.machine.split(' ')[0] + ' · ' : ''}${ev.partName}`),
                ' ',
                h('span', null, ev.reason),
                ev.cascade ? h('div.f-ev-cas', null, ev.cascade + (ev.repairCost > 0 ? ` · $${ev.repairCost.toFixed(0)}` : '')) : null,
            ));
        }
    }

    // 2. Per-Part Live Health / Stress / Wear Table (worst parts sorted to top!)
    clear(partsEl);
    const primaryRt = runtimes[0];
    if (primaryRt) {
        const list = [...primaryRt.partState.values()].sort((a, b) =>
            (b.failed ? 10 : b.stressRatio + b.wear) - (a.failed ? 10 : a.stressRatio + a.wear));
        for (const ps of list.slice(0, 14)) {
            const cls = ps.failed ? 'err' : ps.status === 'slipping' ? 'slip' : ps.status === 'overstress' ? 'err' : ps.status === 'warn' ? 'warn' : 'ok';
            partsEl.append(h('div.f-part-row.' + cls, null,
                h('span.f-part-nm', { title: ps.path }, ps.label),
                h('span.f-part-stat', null, ps.failed ? ps.failReason : `${Math.round(ps.stressRatio * 100)}% · W:${Math.round(ps.wear * 100)}% · ${ps.tempC.toFixed(0)}°C`),
            ));
        }
    }

    // 3. Post-Run Autopsy & Repair Bill
    clear(autopsyEl);
    for (const rt of runtimes) {
        const aut = rt.getAutopsy();
        const box = h('div.f-autopsy', null,
            h('div.f-aut-head', null,
                h('b', null, rt.label),
                h('span.' + (aut.repairCost > 25 ? 'err' : aut.repairCost > 0 ? 'warn' : 'ok'), null, `Repair: $${aut.repairCost.toFixed(0)}`)),
            aut.savedCost > 0 ? h('div.ok', null, `Fail-safe fuse saved ~$${aut.savedCost.toFixed(0)} of upstream machinery!`) : null,
            ...aut.failed.map((f) => h('div.err', null, `✗ ${f.label}: ${f.reason} ($${f.cost.toFixed(0)})`)),
            ...aut.worn.slice(0, 3).map((w) => h('div.warn', null, `⚠ ${w.label}: ${(w.wear * 100).toFixed(0)}% worn ($${w.cost.toFixed(0)})`)),
        );
        autopsyEl.append(box);
    }
}

function row(k, v) {
    return h('div', null, h('span', null, k), h('b', null, String(v)));
}
function formatNum(v, sc) {
    const d = sc.step < 1 ? (sc.step < 0.1 ? 2 : 1) : 0;
    return (+v).toFixed(d) + (sc.unit ? ' ' + sc.unit : '');
}
