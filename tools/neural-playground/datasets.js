// datasets.js — 2D classification dataset generators for Neural Playground

export function generateDataset(type, count = 250, noise = 0.1, trainRatio = 0.7) {
    let rawPoints = [];

    switch (type) {
        case 'spiral':
            rawPoints = generateSpiral(count, noise);
            break;
        case 'circles':
            rawPoints = generateCircles(count, noise);
            break;
        case 'xor':
            rawPoints = generateXOR(count, noise);
            break;
        case 'clusters':
        default:
            rawPoints = generateClusters(count, noise);
            break;
    }

    // Shuffle points
    for (let i = rawPoints.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rawPoints[i], rawPoints[j]] = [rawPoints[j], rawPoints[i]];
    }

    // Split train and test
    const trainCount = Math.floor(rawPoints.length * trainRatio);
    const trainData = { X: [], y: [] };
    const testData = { X: [], y: [] };

    for (let i = 0; i < rawPoints.length; i++) {
        const target = i < trainCount ? trainData : testData;
        target.X.push([rawPoints[i].x1, rawPoints[i].x2]);
        target.y.push(rawPoints[i].label);
    }

    return { train: trainData, test: testData, all: rawPoints };
}

function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// 1. Two Intertwined Spirals
function generateSpiral(count, noise) {
    const points = [];
    const n = Math.floor(count / 2);

    for (let i = 0; i < n; i++) {
        const r = (i / n) * 4.6 + 0.3;
        const theta = (i / n) * 1.75 * Math.PI * 2;

        // Class 0
        const x1 = r * Math.sin(theta) + randn() * noise * 1.2;
        const y1 = r * Math.cos(theta) + randn() * noise * 1.2;
        points.push({ x1, x2: y1, label: 0 });

        // Class 1 (offset by PI)
        const x2 = -r * Math.sin(theta) + randn() * noise * 1.2;
        const y2 = -r * Math.cos(theta) + randn() * noise * 1.2;
        points.push({ x1: x2, x2: y2, label: 1 });
    }

    return points;
}

// 2. Concentric Circles
function generateCircles(count, noise) {
    const points = [];
    const n = Math.floor(count / 2);

    // Inner Circle (Class 1)
    for (let i = 0; i < n; i++) {
        const r = (Math.random() * 0.45 + 0.05) * 4.8;
        const theta = Math.random() * Math.PI * 2;
        const x1 = r * Math.cos(theta) + randn() * noise * 0.8;
        const x2 = r * Math.sin(theta) + randn() * noise * 0.8;
        points.push({ x1, x2, label: 1 });
    }

    // Outer Ring (Class 0)
    for (let i = 0; i < n; i++) {
        const r = (Math.random() * 0.4 + 0.6) * 4.8;
        const theta = Math.random() * Math.PI * 2;
        const x1 = r * Math.cos(theta) + randn() * noise * 0.8;
        const x2 = r * Math.sin(theta) + randn() * noise * 0.8;
        points.push({ x1, x2, label: 0 });
    }

    return points;
}

// 3. XOR Quadrants
function generateXOR(count, noise) {
    const points = [];

    for (let i = 0; i < count; i++) {
        let x1 = (Math.random() * 2 - 1) * 4.6;
        let x2 = (Math.random() * 2 - 1) * 4.6;

        // Push away from origin slightly for cleaner quadrants
        x1 += (x1 > 0 ? 0.3 : -0.3);
        x2 += (x2 > 0 ? 0.3 : -0.3);

        x1 += randn() * noise * 0.8;
        x2 += randn() * noise * 0.8;

        const label = (x1 * x2 > 0) ? 1 : 0;
        points.push({ x1, x2, label });
    }

    return points;
}

// 4. Two Gaussian Clusters
function generateClusters(count, noise) {
    const points = [];
    const n = Math.floor(count / 2);

    // Cluster 1 (Class 0) at (-2.2, -2.0)
    for (let i = 0; i < n; i++) {
        const x1 = -2.2 + randn() * (1.1 + noise * 1.5);
        const x2 = -2.0 + randn() * (1.1 + noise * 1.5);
        points.push({ x1, x2, label: 0 });
    }

    // Cluster 2 (Class 1) at (2.2, 2.0)
    for (let i = 0; i < n; i++) {
        const x1 = 2.2 + randn() * (1.1 + noise * 1.5);
        const x2 = 2.0 + randn() * (1.1 + noise * 1.5);
        points.push({ x1, x2, label: 1 });
    }

    return points;
}
