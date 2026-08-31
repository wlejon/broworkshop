// navmesh.js — Dynamic NavMesh representation, AABB obstacle carving, and Off-Mesh Links (Ladder, Jump Pad, Elevator).

import { FLOORS } from "./environment.js";

export const LINK_TYPES = {
    LADDER: 'ladder',
    JUMP: 'jump',
    ELEVATOR: 'elevator'
};

export class NavMeshGraph {
    constructor() {
        this.nodes = []; // [{ id, x, y, z, floor, neighbors: [{ id, cost, link: null|{type,...} }], carved: false }]
        this.links = []; // [{ id, type, fromId, toId, startPos, endPos, cost, bidirectional }]
        this.carvedObstacles = new Map(); // name -> aabb
        this.generation = 1;

        this.buildDefaultNavGraph();
    }

    buildDefaultNavGraph() {
        this.nodes = [];
        this.links = [];
        let nextId = 0;

        // Helper to add node
        const addNode = (x, y, z, floor) => {
            const node = {
                id: nextId++,
                x, y, z, floor,
                neighbors: [],
                carved: false
            };
            this.nodes.push(node);
            return node;
        };

        // --- 1. Floor 0: Ground Nodes (y = 0) ---
        // South courtyard (z > -4)
        const gNodesSouth = [];
        for (let x = -8; x <= 8; x += 2.0) {
            for (let z = -2; z <= 8; z += 2.0) {
                gNodesSouth.push(addNode(x, FLOORS.GROUND, z, 0));
            }
        }
        // North courtyard behind blast gate (z < -4)
        const gNodesNorth = [];
        for (let x = -8; x <= 8; x += 2.0) {
            for (let z = -8; z <= -5; z += 1.5) {
                gNodesNorth.push(addNode(x, FLOORS.GROUND, z, 0));
            }
        }
        // Gate doorway passage node
        const gatePassageNode = addNode(0.0, FLOORS.GROUND, -4.0, 0);

        // Ground Floor Elevator Stop Node
        const elevNodeF0 = addNode(-6.0, FLOORS.GROUND, 0.0, 0);

        // --- 2. Ramp Connecting Floor 0 to Floor 1 ---
        const rampNodes = [
            addNode(7.0, 0.8, -2.5, 0.5),
            addNode(7.0, 1.8, -1.0, 0.5),
            addNode(7.0, 2.8, 0.5, 0.5)
        ];

        // --- 3. Floor 1: Mezzanine / Catwalk (y = 3.5) ---
        const mezzNodes = [];
        for (let x = -7; x <= 7; x += 2.0) {
            for (let z = -7.5; z <= -4.5; z += 1.5) {
                mezzNodes.push(addNode(x, FLOORS.MEZZANINE, z, 1));
            }
        }
        // Mezzanine Elevator Stop Node
        const elevNodeF1 = addNode(-6.0, FLOORS.MEZZANINE, 0.0, 1);
        // Ladder bottom node on Mezzanine
        const ladderBottom = addNode(-5.5, FLOORS.MEZZANINE, -3.5, 1);

        // --- 4. Floor 2: High Rooftop (y = 7.0) ---
        const roofNodes = [];
        for (let x = -5; x <= 2; x += 1.8) {
            for (let z = 0; z <= 5; z += 1.8) {
                roofNodes.push(addNode(x, FLOORS.ROOFTOP, z, 2));
            }
        }
        // Ladder top node on Rooftop
        const ladderTop = addNode(-5.5, FLOORS.ROOFTOP, -3.5, 2);
        // Rooftop Elevator Stop Node
        const elevNodeF2 = addNode(-6.0, FLOORS.ROOFTOP, 0.0, 2);
        // Chasm Jump Takeoff Pad Node
        const jumpTakeoff = addNode(2.0, FLOORS.ROOFTOP, 2.0, 2);

        // --- 5. Floor 2: Retractable Bridge Nodes ---
        const bridgeNodes = [
            addNode(4.5, FLOORS.ROOFTOP, 2.0, 2),
            addNode(6.5, FLOORS.ROOFTOP, 2.0, 2),
            addNode(8.5, FLOORS.ROOFTOP, 2.0, 2)
        ];

        // --- 6. Floor 2: High Island Pad (across chasm, y = 7.0) ---
        const islandNodes = [];
        for (let x = 10; x <= 13; x += 1.5) {
            for (let z = 0; z <= 4; z += 1.5) {
                islandNodes.push(addNode(x, FLOORS.ROOFTOP, z, 2));
            }
        }
        // Chasm Jump Landing Pad Node
        const jumpLanding = addNode(10.0, FLOORS.ROOFTOP, 2.0, 2);

        // --- 7. Auto-Connect Proximity Edges on Same Surface ---
        const connectSameFloor = (nodeList, maxDist = 2.8) => {
            for (let i = 0; i < nodeList.length; i++) {
                for (let j = i + 1; j < nodeList.length; j++) {
                    const a = nodeList[i];
                    const b = nodeList[j];
                    const dist = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
                    if (dist <= maxDist) {
                        a.neighbors.push({ id: b.id, cost: dist, link: null });
                        b.neighbors.push({ id: a.id, cost: dist, link: null });
                    }
                }
            }
        };

        connectSameFloor(gNodesSouth);
        connectSameFloor(gNodesNorth);
        connectSameFloor(mezzNodes);
        connectSameFloor(roofNodes);
        connectSameFloor(islandNodes);
        connectSameFloor([...bridgeNodes, jumpTakeoff, jumpLanding]);

        // Connect Ramp to Floor 0 and Floor 1
        connectSameFloor([...rampNodes, ...gNodesSouth, ...mezzNodes], 3.0);

        // Connect Gate Passage Node to South and North
        connectSameFloor([gatePassageNode, ...gNodesSouth, ...gNodesNorth], 2.8);

        // Connect Elevator Stops to their floor nodes
        connectSameFloor([elevNodeF0, ...gNodesSouth], 3.2);
        connectSameFloor([elevNodeF1, ...mezzNodes], 3.2);
        connectSameFloor([elevNodeF2, ...roofNodes], 3.2);

        // Connect Bridge to Rooftop and Island
        connectSameFloor([bridgeNodes[0], jumpTakeoff], 2.8);
        connectSameFloor([bridgeNodes[2], jumpLanding], 2.8);

        // --- 8. Define Off-Mesh Links ---
        // (A) Ladder Link (Mezzanine <-> High Rooftop)
        this.addOffMeshLink({
            type: LINK_TYPES.LADDER,
            fromId: ladderBottom.id,
            toId: ladderTop.id,
            startPos: { x: ladderBottom.x, y: ladderBottom.y, z: ladderBottom.z },
            endPos: { x: ladderTop.x, y: ladderTop.y, z: ladderTop.z },
            cost: 3.5, // ladder climb cost
            bidirectional: true
        });

        // (B) Jump Pad Link (Rooftop -> Island over Chasm)
        this.addOffMeshLink({
            type: LINK_TYPES.JUMP,
            fromId: jumpTakeoff.id,
            toId: jumpLanding.id,
            startPos: { x: jumpTakeoff.x, y: jumpTakeoff.y, z: jumpTakeoff.z },
            endPos: { x: jumpLanding.x, y: jumpLanding.y, z: jumpLanding.z },
            cost: 2.0, // fast ballistic jump
            bidirectional: true
        });

        // (C) Elevator Off-Mesh Links (Multi-floor)
        const elevStops = [elevNodeF0, elevNodeF1, elevNodeF2];
        for (let i = 0; i < elevStops.length; i++) {
            for (let j = 0; j < elevStops.length; j++) {
                if (i !== j) {
                    this.addOffMeshLink({
                        type: LINK_TYPES.ELEVATOR,
                        fromId: elevStops[i].id,
                        toId: elevStops[j].id,
                        startPos: { x: elevStops[i].x, y: elevStops[i].y, z: elevStops[i].z },
                        endPos: { x: elevStops[j].x, y: elevStops[j].y, z: elevStops[j].z },
                        cost: 4.0 + Math.abs(elevStops[i].y - elevStops[j].y) * 1.2,
                        bidirectional: false
                    });
                }
            }
        }

        this.bridgeNodeIds = bridgeNodes.map(n => n.id);
        this.gatePassageNodeId = gatePassageNode.id;
    }

    addOffMeshLink(linkDef) {
        const link = {
            id: this.links.length,
            ...linkDef
        };
        this.links.push(link);

        const fromNode = this.nodes[link.fromId];
        const toNode = this.nodes[link.toId];

        fromNode.neighbors.push({
            id: toNode.id,
            cost: link.cost,
            link
        });

        if (link.bidirectional) {
            toNode.neighbors.push({
                id: fromNode.id,
                cost: link.cost,
                link: {
                    ...link,
                    fromId: link.toId,
                    toId: link.fromId,
                    startPos: link.endPos,
                    endPos: link.startPos
                }
            });
        }
    }

    // --- Dynamic Carving & Synchronization with Environment ---
    syncEnvironmentObstacles(env) {
        let changed = false;

        // 1. Blast Gate: if closed, carve gate passage node
        const gateCarved = !env.gate.open;
        const gateNode = this.nodes[this.gatePassageNodeId];
        if (gateNode && gateNode.carved !== gateCarved) {
            gateNode.carved = gateCarved;
            changed = true;
        }

        // 2. Retractable Bridge: if retracted, carve bridge nodes
        const bridgeCarved = !env.bridge.extended;
        for (const bId of this.bridgeNodeIds) {
            const bNode = this.nodes[bId];
            if (bNode && bNode.carved !== bridgeCarved) {
                bNode.carved = bridgeCarved;
                changed = true;
            }
        }

        // 3. Barricade Crate
        const barricadeActive = env.barricade.active;
        const bPos = env.barricade.pos;
        for (const node of this.nodes) {
            if (node.floor === 0) {
                const dist = Math.hypot(node.x - bPos.x, node.z - bPos.z);
                if (dist < 1.4) {
                    if (node.carved !== barricadeActive) {
                        node.carved = barricadeActive;
                        changed = true;
                    }
                }
            }
        }

        if (changed) {
            this.generation++;
        }
    }

    findNearestNode(pos) {
        let bestNode = null;
        let bestDist = Infinity;

        for (const node of this.nodes) {
            if (node.carved) continue;
            // Penalize floor/elevation mismatch
            const dy = (node.y - pos.y) * 2.0;
            const dist = Math.hypot(node.x - pos.x, dy, node.z - pos.z);
            if (dist < bestDist) {
                bestDist = dist;
                bestNode = node;
            }
        }

        return bestNode;
    }

    // --- A* / Theta* 3D Pathfinding ---
    findPath(startPos, goalPos) {
        const startNode = this.findNearestNode(startPos);
        const goalNode = this.findNearestNode(goalPos);

        if (!startNode || !goalNode) return null;
        if (startNode.id === goalNode.id) {
            return [{ x: goalPos.x, y: goalPos.y, z: goalPos.z, link: null }];
        }

        // Priority queue for A*
        const openSet = [startNode.id];
        const cameFrom = new Map(); // nodeId -> { fromId, link }
        const gScore = new Map();
        const fScore = new Map();

        for (const n of this.nodes) {
            gScore.set(n.id, Infinity);
            fScore.set(n.id, Infinity);
        }

        const heuristic = (a, b) => {
            const dx = a.x - b.x;
            const dy = (a.y - b.y) * 1.5;
            const dz = a.z - b.z;
            return Math.hypot(dx, dy, dz);
        };

        gScore.set(startNode.id, 0);
        fScore.set(startNode.id, heuristic(startNode, goalNode));

        while (openSet.length > 0) {
            // Find node in openSet with lowest fScore
            let lowestIdx = 0;
            let lowestF = fScore.get(openSet[0]);
            for (let i = 1; i < openSet.length; i++) {
                const f = fScore.get(openSet[i]);
                if (f < lowestF) {
                    lowestF = f;
                    lowestIdx = i;
                }
            }

            const currentId = openSet[lowestIdx];
            if (currentId === goalNode.id) {
                // Reconstruct path
                return this.reconstructPath(cameFrom, currentId, goalPos);
            }

            openSet.splice(lowestIdx, 1);
            const currentNode = this.nodes[currentId];

            for (const neighbor of currentNode.neighbors) {
                const targetNode = this.nodes[neighbor.id];
                if (targetNode.carved) continue;

                const tentativeG = gScore.get(currentId) + neighbor.cost;
                if (tentativeG < gScore.get(neighbor.id)) {
                    cameFrom.set(neighbor.id, { fromId: currentId, link: neighbor.link });
                    gScore.set(neighbor.id, tentativeG);
                    fScore.set(neighbor.id, tentativeG + heuristic(targetNode, goalNode));

                    if (!openSet.includes(neighbor.id)) {
                        openSet.push(neighbor.id);
                    }
                }
            }
        }

        return null; // No path available
    }

    reconstructPath(cameFrom, currentId, goalPos) {
        const waypoints = [];
        let curr = currentId;

        // Final goal waypoint
        waypoints.unshift({
            x: goalPos.x,
            y: goalPos.y,
            z: goalPos.z,
            link: null
        });

        while (cameFrom.has(curr)) {
            const entry = cameFrom.get(curr);
            const node = this.nodes[curr];
            waypoints.unshift({
                x: node.x,
                y: node.y,
                z: node.z,
                link: entry.link
            });
            curr = entry.fromId;
        }

        const startNode = this.nodes[curr];
        waypoints.unshift({
            x: startNode.x,
            y: startNode.y,
            z: startNode.z,
            link: null
        });

        return waypoints;
    }
}
