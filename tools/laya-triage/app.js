// app.js — Laya System 1 Decision Triage Application

// --- Preset Scenarios ---
const PRESETS = {
    duplicate_charge: {
        name: "Duplicate Charge (Billing/Churn)",
        payload: {
            from: "accounting@northwind-traders.com",
            subject: "Duplicate charge on invoice #INV-44119",
            body: "Hi, we were billed twice for March ($1,850 each). Please refund the duplicate transaction today or we will cancel our plan immediately."
        },
        simulated: {
            usage: { input_tokens: 142, output_tokens: 0 },
            answers: {
                department: {
                    type: "choice", choice: "billing", confidence: 0.984,
                    probabilities: { billing: 0.984, technical: 0.008, sales: 0.005, other: 0.003 },
                    rl_agent: { act_probability: 0.965 }
                },
                urgency: {
                    type: "score", score: 1.45, confidence: 0.88,
                    legend: { "0": "not urgent", "1": "soon", "2": "critical deadline" },
                    probabilities: { "0": 0.03, "1": 0.49, "2": 0.48 },
                    rl_agent: { act_probability: 0.942 }
                },
                churn_threat: { type: "noul", noul: 0.892, rl_agent: { act_probability: 0.931 } },
                refund_requested: { type: "noul", noul: 0.978, rl_agent: { act_probability: 0.985 } },
                escalation: { type: "noul", noul: 0.125, rl_agent: { act_probability: 0.954 } }
            }
        }
    },
    db_outage: {
        name: "Database Outage (Technical/Critical)",
        payload: {
            from: "sre-pager@cloudplatform.io",
            subject: "CRITICAL: Primary database replica degraded - connection pool exhausted",
            body: "All customer-facing API nodes are throwing 503 errors. The primary PostgreSQL replica in us-east-1 is rejecting new connections with connection pool exhausted. Production traffic is failing across US-East. Urgent assistance needed immediately."
        },
        simulated: {
            usage: { input_tokens: 188, output_tokens: 0 },
            answers: {
                department: {
                    type: "choice", choice: "technical", confidence: 0.992,
                    probabilities: { billing: 0.002, technical: 0.992, sales: 0.002, other: 0.004 },
                    rl_agent: { act_probability: 0.978 }
                },
                urgency: {
                    type: "score", score: 1.98, confidence: 0.985,
                    legend: { "0": "not urgent", "1": "soon", "2": "critical deadline" },
                    probabilities: { "0": 0.002, "1": 0.018, "2": 0.980 },
                    rl_agent: { act_probability: 0.960 }
                },
                churn_threat: { type: "noul", noul: 0.245, rl_agent: { act_probability: 0.912 } },
                refund_requested: { type: "noul", noul: 0.021, rl_agent: { act_probability: 0.990 } },
                escalation: { type: "noul", noul: 0.965, rl_agent: { act_probability: 0.972 } }
            }
        }
    },
    enterprise_sales: {
        name: "Enterprise Sales (Pricing/Contracts)",
        payload: {
            from: "procurement@globalretail.com",
            subject: "Inquiry regarding Enterprise Tier pricing and custom MSA terms",
            body: "Hello sales team, our company is expanding to 600 seats next quarter. We would like to schedule a call to review custom volume pricing tiers, SOC2 Type II compliance guarantees, and receive a redlined copy of your Master Services Agreement."
        },
        simulated: {
            usage: { input_tokens: 165, output_tokens: 0 },
            answers: {
                department: {
                    type: "choice", choice: "sales", confidence: 0.975,
                    probabilities: { billing: 0.015, technical: 0.005, sales: 0.975, other: 0.005 },
                    rl_agent: { act_probability: 0.952 }
                },
                urgency: {
                    type: "score", score: 0.65, confidence: 0.82,
                    legend: { "0": "not urgent", "1": "soon", "2": "critical deadline" },
                    probabilities: { "0": 0.45, "1": 0.45, "2": 0.10 },
                    rl_agent: { act_probability: 0.925 }
                },
                churn_threat: { type: "noul", noul: 0.012, rl_agent: { act_probability: 0.995 } },
                refund_requested: { type: "noul", noul: 0.008, rl_agent: { act_probability: 0.997 } },
                escalation: { type: "noul", noul: 0.045, rl_agent: { act_probability: 0.965 } }
            }
        }
    },
    hindi_billing: {
        name: "Hindi Billing (Multilingual)",
        payload: {
            from: "vikram.sharma@delhienterprise.in",
            subject: "बिलिंग में समस्या - खाते से दोबारा पैसे कट गए हैं",
            body: "नमस्ते, हमारे खाते से इस महीने दो बार ₹12,500 काट लिए गए हैं। कृपया हमारे बिल नंबर #IND-40992 की जांच करें और अतिरिक्त शुल्क तुरंत वापस (रिफंड) करें। यदि यह हल नहीं हुआ तो हम खाता बंद कर देंगे।"
        },
        simulated: {
            usage: { input_tokens: 176, output_tokens: 0 },
            answers: {
                department: {
                    type: "choice", choice: "billing", confidence: 0.962,
                    probabilities: { billing: 0.962, technical: 0.015, sales: 0.010, other: 0.013 },
                    rl_agent: { act_probability: 0.941 }
                },
                urgency: {
                    type: "score", score: 1.52, confidence: 0.85,
                    legend: { "0": "not urgent", "1": "soon", "2": "critical deadline" },
                    probabilities: { "0": 0.04, "1": 0.40, "2": 0.56 },
                    rl_agent: { act_probability: 0.932 }
                },
                churn_threat: { type: "noul", noul: 0.865, rl_agent: { act_probability: 0.915 } },
                refund_requested: { type: "noul", noul: 0.942, rl_agent: { act_probability: 0.955 } },
                escalation: { type: "noul", noul: 0.180, rl_agent: { act_probability: 0.938 } }
            }
        }
    },
    credential_stuffing: {
        name: "Credential Stuffing (Security/Escalate)",
        payload: {
            from: "security-alert@internal-guard.com",
            subject: "SECURITY INCIDENT: Distributed credential stuffing attack on SSO endpoints",
            body: "Over 45,000 automated login attempts originating from compromised residential proxies detected in the past 12 minutes against /auth/login. High failure rate (98.4%) with several dormant accounts compromised. Need immediate SecOps escalation to rotate secrets and engage Cloudflare under-attack mode."
        },
        simulated: {
            usage: { input_tokens: 215, output_tokens: 0 },
            answers: {
                department: {
                    type: "choice", choice: "technical", confidence: 0.725,
                    probabilities: { billing: 0.005, technical: 0.725, sales: 0.010, other: 0.260 },
                    rl_agent: { act_probability: 0.785 }
                },
                urgency: {
                    type: "score", score: 1.99, confidence: 0.99,
                    legend: { "0": "not urgent", "1": "soon", "2": "critical deadline" },
                    probabilities: { "0": 0.001, "1": 0.009, "2": 0.990 },
                    rl_agent: { act_probability: 0.710 }
                },
                churn_threat: { type: "noul", noul: 0.085, rl_agent: { act_probability: 0.880 } },
                refund_requested: { type: "noul", noul: 0.010, rl_agent: { act_probability: 0.990 } },
                escalation: { type: "noul", noul: 0.988, rl_agent: { act_probability: 0.650 } }
            }
        }
    }
};

// --- Question Specifications matching Laya Engine ---
const QUESTIONS = {
    department: {
        type: "choice",
        instructions: "Which department should handle this request?",
        criteria: {
            billing: "invoices, payments, refunds", technical: "bugs, outages, system errors",
            sales: "pricing, new contracts", other: "everything else"
        }
    },
    urgency: {
        type: "score",
        instructions: "How urgent is this request?",
        criteria: ["not urgent", "soon", "critical deadline or blocking issue"]
    },
    churn_threat: {
        type: "noul",
        instructions: "Does the customer threaten cancellation or churn?",
        criteria: ["no churn threat", "threatens cancellation or churn"]
    },
    refund_requested: {
        type: "noul",
        instructions: "Is a refund or financial credit requested?",
        criteria: ["no refund requested", "refund requested"]
    },
    escalation: {
        type: "noul",
        instructions: "Does this require immediate human escalation?",
        criteria: ["standard automated workflow", "requires human escalation"]
    }
};

// --- Application State ---
let activeModel = null;
let currentPresetKey = "duplicate_charge";

// --- DOM Elements ---
const elStateInput = document.getElementById("stateInput");
const elCheckpointPath = document.getElementById("checkpointPath");
const elBtnReload = document.getElementById("btnReloadModel");
const elBackendBadge = document.getElementById("backendBadge");
const elBtnRun = document.getElementById("btnRun");
const elBtnFormatJson = document.getElementById("btnFormatJson");
const elBtnClearState = document.getElementById("btnClearState");
const elPresetButtons = document.querySelectorAll(".btn-preset");

// Telemetry
const elLatency = document.getElementById("telemetryLatency");
const elTokens = document.getElementById("telemetryTokens");
const elModel = document.getElementById("telemetryModel");
const elGate = document.getElementById("telemetryGate");

// Action Decision Elements
const elActBadge = document.getElementById("actBadge");
const elActionBanner = document.getElementById("actionBanner");
const elActionIcon = document.getElementById("actionIcon");
const elActionHeadline = document.getElementById("actionHeadline");
const elActionSubtext = document.getElementById("actionSubtext");
const elActProbValue = document.getElementById("actProbValue");
const elActProbBar = document.getElementById("actProbBar");

// Department Elements
const elDeptWinner = document.getElementById("deptWinner");
const elDeptConfidence = document.getElementById("deptConfidence");
const elDeptDistribution = document.getElementById("deptDistribution");

// Urgency Elements
const elUrgencyPill = document.getElementById("urgencyPill");
const elUrgencyScore = document.getElementById("urgencyScore");
const elUrgencyConfidence = document.getElementById("urgencyConfidence");
const elUrgencyDesc = document.getElementById("urgencyDesc");
const elUrgencyDistribution = document.getElementById("urgencyDistribution");

// Noul Gauges
const elChurnBadge = document.getElementById("churnBadge");
const elChurnGaugeFill = document.getElementById("churnGaugeFill");
const elChurnPercent = document.getElementById("churnPercent");
const elChurnAssessment = document.getElementById("churnAssessment");

const elRefundBadge = document.getElementById("refundBadge");
const elRefundGaugeFill = document.getElementById("refundGaugeFill");
const elRefundPercent = document.getElementById("refundPercent");
const elRefundAssessment = document.getElementById("refundAssessment");

// --- Model Initialization ---
function initModel(path) {
    const cleanPath = (path || "D:/projects/laya").trim();
    if (typeof bro !== "undefined" && bro.lm && typeof bro.lm.loadLaya === "function") {
        try {
            activeModel = bro.lm.loadLaya(cleanPath);
            elBackendBadge.textContent = "NATIVE C++ (bro.lm)";
            elBackendBadge.style.color = "#00ffaa";
            elBackendBadge.style.borderColor = "rgba(0,255,170,0.3)";
            return;
        } catch (err) {
            console.warn("bro.lm.loadLaya failed, falling back to simulator:", err);
        }
    }

    elBackendBadge.textContent = "SIMULATION ENGINE";
    elBackendBadge.style.color = "#38bdf8";
    elBackendBadge.style.borderColor = "rgba(56,189,248,0.3)";
    activeModel = {
        predict(state, questions) {
            const currentPreset = PRESETS[currentPresetKey];
            if (currentPreset && typeof state === "object") {
                const sSub = (state.subject || "").toLowerCase();
                const pSub = (currentPreset.payload.subject || "").toLowerCase();
                if (sSub === pSub) return { model: "rl-agent-modernbert", ...currentPreset.simulated };
            }
            return simulateCustomInput(state);
        }
    };
}

function simulateCustomInput(state) {
    const text = (typeof state === "string" ? state : JSON.stringify(state)).toLowerCase();
    const isTech = /error|503|bug|outage|crash|sql|exception|stack|cluster|sre|api/i.test(text);
    const isSales = /pricing|quote|enterprise|contract|demo|seats|procurement|msa/i.test(text);
    const isBill = /bill|invoice|charge|refund|payment|credit card|receipt|fee/i.test(text);
    const isChurn = /cancel|leave|competitor|close account|switch|dispute/i.test(text);
    const isRefund = /refund|reimburse|credit|duplicate/i.test(text);
    const isUrgent = /urgent|critical|immediately|asap|p1|production|down|broken/i.test(text);

    let winner = "other";
    let probs = { billing: 0.05, technical: 0.05, sales: 0.05, other: 0.85 };
    if (isTech) { winner = "technical"; probs = { billing: 0.03, technical: 0.91, sales: 0.02, other: 0.04 }; }
    else if (isBill) { winner = "billing"; probs = { billing: 0.93, technical: 0.02, sales: 0.02, other: 0.03 }; }
    else if (isSales) { winner = "sales"; probs = { billing: 0.04, technical: 0.01, sales: 0.92, other: 0.03 }; }

    const urgencyScore = isUrgent ? 1.85 : 0.45;
    const churnProb = isChurn ? 0.84 : 0.08;
    const refundProb = isRefund ? 0.92 : 0.04;
    const actProb = (isTech && isUrgent) ? 0.72 : 0.94;

    return {
        model: "rl-agent-modernbert",
        usage: { input_tokens: Math.min(512, Math.max(48, Math.floor(text.length / 3))), output_tokens: 0 },
        answers: {
            department: {
                type: "choice", choice: winner, confidence: probs[winner],
                probabilities: probs, rl_agent: { act_probability: actProb }
            },
            urgency: {
                type: "score", score: urgencyScore, confidence: 0.85,
                legend: { "0": "not urgent", "1": "soon", "2": "critical deadline" },
                probabilities: isUrgent ? { "0": 0.02, "1": 0.11, "2": 0.87 } : { "0": 0.65, "1": 0.30, "2": 0.05 },
                rl_agent: { act_probability: actProb }
            },
            churn_threat: { type: "noul", noul: churnProb, rl_agent: { act_probability: actProb } },
            refund_requested: { type: "noul", noul: refundProb, rl_agent: { act_probability: actProb } },
            escalation: { type: "noul", noul: actProb < 0.9 ? 0.88 : 0.12, rl_agent: { act_probability: actProb } }
        }
    };
}

// --- Preset Loader ---
function loadPreset(key) {
    currentPresetKey = key;
    const preset = PRESETS[key];
    if (!preset) return;
    elPresetButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.preset === key));
    elStateInput.value = JSON.stringify(preset.payload, null, 2);
    runTriage();
}

// --- Run Decision Triage ---
function runTriage() {
    if (!activeModel) initModel(elCheckpointPath.value);

    let state;
    const raw = elStateInput.value.trim();
    try { state = JSON.parse(raw); } catch { state = raw; }

    const t0 = performance.now();
    let res;
    try {
        res = activeModel.predict(state, QUESTIONS);
    } catch (e) {
        console.error("Predict threw:", e);
        alert("Inference Error: " + e.message);
        return;
    }
    const latency = performance.now() - t0;
    renderResults(res, latency);
}

// --- Results Rendering ---
function renderResults(res, latencyMs) {
    elLatency.textContent = latencyMs.toFixed(1);
    elTokens.textContent = res.usage?.input_tokens ?? "--";
    elModel.textContent = res.model || "ModernBERT";

    const answers = res.answers || {};

    let actProb = 0.95;
    const actVals = Object.values(answers)
        .map(a => a?.rl_agent?.act_probability)
        .filter(v => typeof v === "number");
    if (actVals.length > 0) actProb = Math.min(...actVals);

    const isAuto = actProb >= 0.90;
    elGate.textContent = isAuto ? "PASS (>90%)" : "HOLD (<90%)";
    elGate.style.color = isAuto ? "#10b981" : "#f43f5e";

    // 2. Action vs Escalate Card
    elActProbValue.textContent = (actProb * 100).toFixed(1) + "%";
    elActProbBar.style.width = Math.min(100, Math.max(0, actProb * 100)) + "%";
    elActProbBar.className = "progress-bar-fill " + (isAuto ? "safe" : "danger");

    if (isAuto) {
        elActBadge.textContent = "AUTONOMOUS (>90%)";
        elActBadge.style.color = "#34d399";
        elActionBanner.className = "action-decision-banner banner-auto";
        elActionIcon.textContent = "🛡️";
        elActionHeadline.textContent = `AUTONOMOUS ACTION AUTHORIZED (${(actProb * 100).toFixed(1)}%)`;
        elActionSubtext.textContent = "System 1 confidence exceeds 90% safety envelope. Automated execution active.";
    } else {
        elActBadge.textContent = "ESCALATE (<90%)";
        elActBadge.style.color = "#fb7185";
        elActionBanner.className = "action-decision-banner banner-escalate";
        elActionIcon.textContent = "⚠️";
        elActionHeadline.textContent = `ESCALATE TO HUMAN SUPERVISOR (${(actProb * 100).toFixed(1)}%)`;
        elActionSubtext.textContent = "Model uncertainty detected below 90% threshold. Queued for human verification.";
    }

    // 3. Department (Choice)
    const dept = answers.department || {};
    const deptWinner = dept.choice || "other";
    elDeptWinner.textContent = deptWinner.toUpperCase();
    elDeptConfidence.textContent = ((dept.confidence || 0) * 100).toFixed(1) + "%";

    const probs = dept.probabilities || {};
    ["billing", "technical", "sales", "other"].forEach(cat => {
        const row = elDeptDistribution.querySelector(`[data-cat="${cat}"]`);
        if (row) {
            const p = probs[cat] || 0;
            const bar = row.querySelector(".dist-bar");
            const val = row.querySelector(".dist-val");
            if (bar) bar.style.width = (p * 100).toFixed(1) + "%";
            if (val) val.textContent = (p * 100).toFixed(1) + "%";
        }
    });

    // 4. Urgency (Score)
    const urg = answers.urgency || {};
    const score = urg.score ?? 0;
    elUrgencyScore.textContent = score.toFixed(2);
    elUrgencyConfidence.textContent = ((urg.confidence || 0) * 100).toFixed(1) + "%";

    if (score < 0.7) {
        elUrgencyPill.textContent = "LOW / NORMAL";
        elUrgencyPill.style.color = "#60a5fa";
        elUrgencyDesc.textContent = "Low priority. Standard response queue.";
    } else if (score < 1.4) {
        elUrgencyPill.textContent = "MEDIUM / SOON";
        elUrgencyPill.style.color = "#f59e0b";
        elUrgencyDesc.textContent = "Needs prompt attention within SLA window.";
    } else {
        elUrgencyPill.textContent = "CRITICAL / BLOCKER";
        elUrgencyPill.style.color = "#ef4444";
        elUrgencyDesc.textContent = "High urgency incident or hard deadline.";
    }

    const urgProbs = urg.probabilities || {};
    [0, 1, 2].forEach(tier => {
        const row = elUrgencyDistribution.querySelector(`[data-tier="${tier}"]`);
        if (row) {
            const p = urgProbs[String(tier)] || 0;
            const bar = row.querySelector(".dist-bar");
            const val = row.querySelector(".dist-val");
            if (bar) bar.style.width = (p * 100).toFixed(1) + "%";
            if (val) val.textContent = (p * 100).toFixed(1) + "%";
        }
    });

    // 5. Churn Threat (Noul)
    const churn = answers.churn_threat?.noul ?? 0;
    setGauge(elChurnGaugeFill, elChurnPercent, churn);
    if (churn >= 0.5) {
        elChurnBadge.textContent = "SEVERE CHURN RISK";
        elChurnBadge.style.color = "#f43f5e";
        elChurnAssessment.textContent = "Customer explicitly signals cancellation or departure.";
    } else {
        elChurnBadge.textContent = "LOW RETENTION RISK";
        elChurnBadge.style.color = "#10b981";
        elChurnAssessment.textContent = "No immediate account cancellation threat detected.";
    }

    // 6. Refund Requested (Noul)
    const refund = answers.refund_requested?.noul ?? 0;
    setGauge(elRefundGaugeFill, elRefundPercent, refund);
    if (refund >= 0.5) {
        elRefundBadge.textContent = "REFUND DETECTED";
        elRefundBadge.style.color = "#00e5ff";
        elRefundAssessment.textContent = "Explicit financial credit or payment refund demanded.";
    } else {
        elRefundBadge.textContent = "NO REFUND";
        elRefundBadge.style.color = "#94a3b8";
        elRefundAssessment.textContent = "Ticket does not request financial reimbursement.";
    }
}

function setGauge(fillElement, textElement, probability) {
    const p = Math.max(0, Math.min(1, probability));
    const arcLength = 141.37; // PI * radius (45)
    const offset = arcLength * (1 - p);
    fillElement.style.strokeDashoffset = offset.toFixed(2);
    textElement.textContent = Math.round(p * 100) + "%";
}

// --- Event Listeners ---
elPresetButtons.forEach(btn => {
    btn.addEventListener("click", () => loadPreset(btn.dataset.preset));
});

elBtnRun.addEventListener("click", runTriage);

elBtnReload.addEventListener("click", () => {
    initModel(elCheckpointPath.value);
    runTriage();
});

elCheckpointPath.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        initModel(elCheckpointPath.value);
        runTriage();
    }
});

elBtnFormatJson.addEventListener("click", () => {
    try {
        const parsed = JSON.parse(elStateInput.value);
        elStateInput.value = JSON.stringify(parsed, null, 2);
    } catch {}
});

elBtnClearState.addEventListener("click", () => {
    elStateInput.value = "";
    elStateInput.focus();
});

// --- Boot Application ---
initModel(elCheckpointPath.value);
loadPreset("duplicate_charge");
