// agents.js — Intelligent NPC agents with 3D path following, dynamic repathing, and off-mesh link actions.

import { LINK_TYPES } from "./navmesh.js";
import { FLOORS } from "./environment.js";

export const AGENT_STATE = {
    IDLE: 'IDLE',
    WALKING: 'WALKING',
    CLIMBING: 'CLIMBING',
    JUMPING: 'JUMPING',
    WAITING_ELEVATOR: 'WAITING_ELEVATOR',
    RIDING_ELEVATOR: 'RIDING_ELEVATOR'
};

const AGENT_COLORS = ['#00f0ff', '#39ff14', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];

export class Agent {
    constructor(id, x, y, z, scene, color = null) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.z = z;
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.yaw = 0;

        this.speed = 3.5; // m/s
        this.radius = 0.35;
        this.state = AGENT_STATE.IDLE;
        this.color = color || AGENT_COLORS[id % AGENT_COLORS.length];

        // Path & Waypoint tracking
        this.path = []; // [{ x, y, z, link }]
        this.waypointIndex = 0;
        this.goalPos = null;
        this.lastNavGen = 0;

        // Off-mesh action state
        this.actionTimer = 0;
        this.actionDuration = 1.0;
        this.linkStart = null;
        this.linkEnd = null;

        // 3D Visual Mesh
        this.scene = scene;
        this.mesh = null;
        this.initMesh();
    }

    initMesh() {
        if (!this.scene || typeof this.scene.createMesh !== 'function') return;
        try {
            this.mesh = this.scene.createMesh({
                mesh: 'capsule',
                radius: this.radius,
                halfHeight: 0.5,
                color: this.color,
                roughness: 0.4,
                x: this.x,
                y: this.y + 0.5,
                z: this.z
            });
        } catch (_) {}
    }

    setGoal(gx, gy, gz, navGraph) {
        this.goalPos = { x: gx, y: gy, z: gz };
        this.recalculatePath(navGraph);
    }

    recalculatePath(navGraph) {
        if (!this.goalPos) return;

        const path = navGraph.findPath({ x: this.x, y: this.y, z: this.z }, this.goalPos);
        if (path && path.length > 0) {
            this.path = path;
            this.waypointIndex = 0;
            this.state = AGENT_STATE.WALKING;
            this.lastNavGen = navGraph.generation;
        } else {
            this.path = [];
            this.state = AGENT_STATE.IDLE;
        }
    }

    update(dt, navGraph, env, stats) {
        // Check if NavMesh has been re-carved and repath if necessary
        if (this.state === AGENT_STATE.WALKING && this.goalPos && this.lastNavGen !== navGraph.generation) {
            this.recalculatePath(navGraph);
        }

        switch (this.state) {
            case AGENT_STATE.WALKING:
                this.updateWalking(dt, navGraph, env, stats);
                break;
            case AGENT_STATE.CLIMBING:
                this.updateClimbing(dt, stats);
                break;
            case AGENT_STATE.JUMPING:
                this.updateJumping(dt, stats);
                break;
            case AGENT_STATE.WAITING_ELEVATOR:
                this.updateWaitingElevator(dt, env, stats);
                break;
            case AGENT_STATE.RIDING_ELEVATOR:
                this.updateRidingElevator(dt, env, stats);
                break;
            case AGENT_STATE.IDLE:
            default:
                break;
        }

        // Sync 3D Visual Mesh
        if (this.mesh) {
            this.mesh.position = [this.x, this.y + 0.5, this.z];
            this.mesh.rotation = [0, Math.sin(this.yaw / 2), 0, Math.cos(this.yaw / 2)];
        }
    }

    updateWalking(dt, navGraph, env, stats) {
        if (this.waypointIndex >= this.path.length) {
            this.state = AGENT_STATE.IDLE;
            return;
        }

        const wp = this.path[this.waypointIndex];
        const dx = wp.x - this.x;
        const dy = wp.y - this.y;
        const dz = wp.z - this.z;
        const dist = Math.hypot(dx, dz);

        // Check if reaching off-mesh link trigger waypoint
        if (wp.link && dist < 0.6 && Math.abs(dy) < 0.8) {
            const link = wp.link;
            stats.traversals++;

            if (link.type === LINK_TYPES.LADDER) {
                this.state = AGENT_STATE.CLIMBING;
                this.linkStart = { ...wp.link.startPos };
                this.linkEnd = { ...wp.link.endPos };
                const heightDiff = Math.abs(this.linkEnd.y - this.linkStart.y);
                this.actionDuration = heightDiff / 2.0; // 2 m/s climb speed
                this.actionTimer = 0;
                return;
            } else if (link.type === LINK_TYPES.JUMP) {
                this.state = AGENT_STATE.JUMPING;
                this.linkStart = { ...wp.link.startPos };
                this.linkEnd = { ...wp.link.endPos };
                this.actionDuration = 1.1; // 1.1s air time
                this.actionTimer = 0;
                return;
            } else if (link.type === LINK_TYPES.ELEVATOR) {
                this.state = AGENT_STATE.WAITING_ELEVATOR;
                this.linkStart = { ...wp.link.startPos };
                this.linkEnd = { ...wp.link.endPos };
                return;
            }
        }

        // Steer towards waypoint
        if (dist > 0.25) {
            const dirX = dx / dist;
            const dirZ = dz / dist;
            this.x += dirX * this.speed * dt;
            this.z += dirZ * this.speed * dt;
            this.y += dy * Math.min(1.0, dt * 5.0); // smooth vertical ramp climb
            this.yaw = Math.atan2(dirX, dirZ);
        } else {
            // Next waypoint
            this.waypointIndex++;
        }
    }

    updateClimbing(dt, stats) {
        this.actionTimer += dt;
        const p = Math.min(1.0, this.actionTimer / this.actionDuration);

        // Smooth vertical climbing interpolation with subtle rung sway
        this.x = this.linkStart.x;
        this.z = this.linkStart.z;
        this.y = this.linkStart.y + (this.linkEnd.y - this.linkStart.y) * p;

        if (p >= 1.0) {
            this.x = this.linkEnd.x;
            this.y = this.linkEnd.y;
            this.z = this.linkEnd.z;
            this.waypointIndex++;
            this.state = AGENT_STATE.WALKING;
        }
    }

    updateJumping(dt, stats) {
        this.actionTimer += dt;
        const p = Math.min(1.0, this.actionTimer / this.actionDuration);

        // Parabolic ballistic trajectory
        this.x = this.linkStart.x + (this.linkEnd.x - this.linkStart.x) * p;
        this.z = this.linkStart.z + (this.linkEnd.z - this.linkStart.z) * p;

        // Parabolic arc height (apex = 3.5m above ground)
        const arcY = 4.0 * p * (1 - p) * 3.5;
        this.y = this.linkStart.y + (this.linkEnd.y - this.linkStart.y) * p + arcY;

        if (p >= 1.0) {
            this.x = this.linkEnd.x;
            this.y = this.linkEnd.y;
            this.z = this.linkEnd.z;
            this.waypointIndex++;
            this.state = AGENT_STATE.WALKING;
        }
    }

    updateWaitingElevator(dt, env, stats) {
        // Call elevator to agent's current floor if it's not already on the way
        const curFloor = this.y > 5 ? 2 : (this.y > 2 ? 1 : 0);
        if (env.elevator.targetFloor !== curFloor && !env.elevator.isMoving) {
            env.callElevator(curFloor);
        }

        // Check if elevator has arrived at current floor with doors open
        const atFloor = Math.abs(env.elevator.y - this.y) < 0.3;
        if (atFloor && env.elevator.doorOpen > 0.8) {
            // Board elevator
            this.state = AGENT_STATE.RIDING_ELEVATOR;
            const targetFloor = this.linkEnd.y > 5 ? 2 : (this.linkEnd.y > 2 ? 1 : 0);
            env.callElevator(targetFloor);
        }
    }

    updateRidingElevator(dt, env, stats) {
        // Move with elevator cabin
        this.x = env.elevator.pos.x;
        this.z = env.elevator.pos.z;
        this.y = env.elevator.y + 0.1;

        // Check if destination floor reached
        const targetFloor = this.linkEnd.y > 5 ? 2 : (this.linkEnd.y > 2 ? 1 : 0);
        if (env.elevator.currentFloor === targetFloor && !env.elevator.isMoving && env.elevator.doorOpen > 0.8) {
            // Disembark
            this.x = this.linkEnd.x;
            this.y = this.linkEnd.y;
            this.z = this.linkEnd.z;
            this.waypointIndex++;
            this.state = AGENT_STATE.WALKING;
        }
    }
}

export class AgentManager {
    constructor(scene, navGraph, env) {
        this.scene = scene;
        this.navGraph = navGraph;
        this.env = env;
        this.agents = [];
        this.stats = { traversals: 0 };
    }

    spawnAgent(x = 0, y = 0, z = 4.0) {
        const id = this.agents.length;
        const agent = new Agent(id, x, y, z, this.scene);
        this.agents.push(agent);
        return agent;
    }

    spawnSquad(count = 5) {
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const sx = Math.cos(angle) * 3.5;
            const sz = 3.0 + Math.sin(angle) * 3.5;
            this.spawnAgent(sx, 0, sz);
        }
    }

    clearAgents() {
        for (const a of this.agents) {
            if (a.mesh && typeof a.mesh.dispose === 'function') {
                a.mesh.dispose();
            }
        }
        this.agents = [];
    }

    sendAllTo(gx, gy, gz) {
        for (const a of this.agents) {
            a.setGoal(gx, gy, gz, this.navGraph);
        }
    }

    update(dt) {
        for (const a of this.agents) {
            a.update(dt, this.navGraph, this.env, this.stats);
        }
    }
}
