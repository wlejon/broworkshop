// game.js — Runner physics, parallax rendering, obstacles, and game loop for Clap Runner

export class ClapRunnerGame {
    constructor(canvas, callbacks = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.callbacks = callbacks;

        this.width = 960;
        this.height = 540;
        this.groundY = 440;

        this.state = 'TITLE'; // 'TITLE', 'PLAYING', 'GAMEOVER'

        // Gameplay parameters
        this.baseSpeed = 380;
        this.speed = this.baseSpeed;
        this.maxSpeed = 820;
        this.gravity = 1850;
        this.glideGravity = 280;

        // Player state
        this.player = {
            x: 140,
            y: this.groundY,
            vy: 0,
            width: 38,
            height: 68,
            isGrounded: true,
            isGliding: false,
            isSliding: false,
            isSuperJumping: false,
            hasShield: false,
            shieldTimer: 0,
            invincibleTimer: 0,
            animTimer: 0,
            runFrame: 0,
            slideTimer: 0
        };

        // Score and stats
        this.score = 0;
        this.distance = 0;
        this.coins = 0;
        this.multiplier = 1;
        this.streak = 0;
        this.highScore = parseInt(localStorage.getItem('clap_runner_highscore') || '0', 10);

        // World entities
        this.obstacles = [];
        this.collectibles = [];
        this.particles = [];
        this.floatingTexts = [];

        // Spawn timers
        this.obstacleTimer = 0;
        this.nextObstacleDistance = 500;
        this.coinTimer = 0;

        // Parallax background offsets
        this.bgOffsetSky = 0;
        this.bgOffsetFar = 0;
        this.bgOffsetMid = 0;
        this.bgOffsetNear = 0;

        // Generate static skyline buildings
        this.skylineBuildings = this._generateSkyline();
        this.midlineBuildings = this._generateMidline();
    }

    start() {
        this.state = 'PLAYING';
        this.speed = this.baseSpeed;
        this.score = 0;
        this.distance = 0;
        this.coins = 0;
        this.multiplier = 1;
        this.streak = 0;

        this.player.y = this.groundY;
        this.player.vy = 0;
        this.player.isGrounded = true;
        this.player.isGliding = false;
        this.player.isSliding = false;
        this.player.isSuperJumping = false;
        this.player.hasShield = false;
        this.player.invincibleTimer = 0;

        this.obstacles = [];
        this.collectibles = [];
        this.particles = [];
        this.floatingTexts = [];
        this.obstacleTimer = 0;
        this.nextObstacleDistance = 400;

        this._emitScoreUpdate();
    }

    // Input actions from GestureController
    handleJump(strength = 1) {
        if (this.state !== 'PLAYING') return;
        if (this.player.isGrounded || (this.player.isGliding && this.player.vy > -100)) {
            this.player.isGrounded = false;
            this.player.isSliding = false;
            this.player.isSuperJumping = false;
            this.player.vy = -680;
            this._spawnJumpParticles(this.player.x, this.player.y, '#00e5ff', 12);
            this._triggerSound('jump');
        }
    }

    handleSuperJump() {
        if (this.state !== 'PLAYING') return;
        this.player.isGrounded = false;
        this.player.isSliding = false;
        this.player.isSuperJumping = true;
        this.player.vy = -980;
        this._spawnJumpParticles(this.player.x, this.player.y, '#ff007f', 24);
        this._addFloatingText(this.player.x + 20, this.player.y - 40, 'SUPER JUMP!', '#ff007f');
        this._triggerSound('superJump');
    }

    handleGlideStart() {
        if (this.state !== 'PLAYING') return;
        if (!this.player.isGliding) {
            this.player.isGliding = true;
            this.player.isSliding = false;
            if (this.player.vy > 60) {
                this.player.vy = 60;
            }
            this._triggerSound('glideStart');
        }
    }

    handleGlideEnd() {
        if (this.player.isGliding) {
            this.player.isGliding = false;
            this._triggerSound('glideStop');
        }
    }

    handleSlideStart() {
        if (this.state !== 'PLAYING') return;
        if (this.player.isGrounded && !this.player.isSliding) {
            this.player.isSliding = true;
            this.player.slideTimer = 0.55;
            this._spawnSlideParticles(this.player.x, this.player.y, 10);
            this._triggerSound('slide');
        }
    }

    handleSlideEnd() {
        this.player.isSliding = false;
    }

    update(dt) {
        if (this.state !== 'PLAYING') {
            this._updateParticles(dt);
            this._updateFloatingTexts(dt);
            return;
        }

        // 1. Accelerate speed with distance
        this.speed = Math.min(this.maxSpeed, this.baseSpeed + (this.distance / 12));
        const moveDist = this.speed * dt;
        this.distance += moveDist * 0.05;

        // 2. Parallax background scrolling
        this.bgOffsetSky = (this.bgOffsetSky + this.speed * 0.04 * dt) % this.width;
        this.bgOffsetFar = (this.bgOffsetFar + this.speed * 0.18 * dt) % this.width;
        this.bgOffsetMid = (this.bgOffsetMid + this.speed * 0.45 * dt) % this.width;
        this.bgOffsetNear = (this.bgOffsetNear + this.speed * dt) % this.width;

        // 3. Player Physics
        const currentGravity = this.player.isGliding ? this.glideGravity : this.gravity;
        this.player.vy += currentGravity * dt;

        if (this.player.isGliding) {
            // Terminal velocity when gliding
            if (this.player.vy > 120) this.player.vy = 120;
            // Spawn hover thruster flame particles
            if (Math.random() < 0.75) {
                this.particles.push({
                    x: this.player.x - 10 + (Math.random() * 8 - 4),
                    y: this.player.y - 12,
                    vx: -this.speed * 0.4 - Math.random() * 60,
                    vy: 40 + Math.random() * 50,
                    color: Math.random() > 0.4 ? '#00e5ff' : '#00ffaa',
                    size: 3 + Math.random() * 3,
                    life: 0.35,
                    maxLife: 0.35
                });
            }
        }

        this.player.y += this.player.vy * dt;

        if (this.player.y >= this.groundY) {
            this.player.y = this.groundY;
            this.player.vy = 0;
            this.player.isGrounded = true;
            this.player.isSuperJumping = false;
        } else {
            this.player.isGrounded = false;
        }

        // Slide timer handling
        if (this.player.isSliding) {
            this.player.slideTimer -= dt;
            if (this.player.slideTimer <= 0) {
                this.player.isSliding = false;
            } else {
                this._spawnSlideParticles(this.player.x, this.player.y, 1);
            }
        }

        // Invincibility flicker
        if (this.player.invincibleTimer > 0) {
            this.player.invincibleTimer -= dt;
        }

        // Run animation
        this.player.animTimer += dt * (this.speed / 180);
        this.player.runFrame = Math.floor(this.player.animTimer) % 6;

        // 4. Spawning Obstacles & Collectibles
        this.obstacleTimer += moveDist;
        if (this.obstacleTimer >= this.nextObstacleDistance) {
            this.obstacleTimer = 0;
            this._spawnObstacleWave();
            this.nextObstacleDistance = 320 + Math.random() * 380;
        }

        // 5. Update Obstacles
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const obs = this.obstacles[i];
            obs.x -= moveDist;

            // Hover drone movement
            if (obs.type === 'HOVER_DRONE') {
                obs.hoverT = (obs.hoverT || 0) + dt * 3;
                obs.y = obs.baseY + Math.sin(obs.hoverT) * 35;
            }

            // Check collision with player
            if (!obs.passed && obs.x + obs.w < this.player.x) {
                obs.passed = true;
                this.score += 50 * this.multiplier;
                this.streak++;
                if (this.streak % 5 === 0 && this.multiplier < 8) {
                    this.multiplier++;
                    this._addFloatingText(this.player.x, this.player.y - 60, `${this.multiplier}X MULTIPLIER!`, '#ffea00');
                    this._triggerSound('multiplier');
                }
                this._emitScoreUpdate();
            }

            if (this._checkPlayerObstacleCollision(obs)) {
                if (this.player.invincibleTimer <= 0) {
                    if (this.player.hasShield) {
                        this.player.hasShield = false;
                        this.player.invincibleTimer = 1.2;
                        this._spawnExplosion(obs.x + obs.w / 2, obs.y + obs.h / 2, '#ff00ff', 20);
                        this._addFloatingText(this.player.x, this.player.y - 50, 'SHIELD BROKEN!', '#ff007f');
                        this._triggerSound('crash');
                    } else {
                        this._gameOver();
                        return;
                    }
                }
            }

            if (obs.x < -100) {
                this.obstacles.splice(i, 1);
            }
        }

        // 6. Update Collectibles
        for (let i = this.collectibles.length - 1; i >= 0; i--) {
            const item = this.collectibles[i];
            item.x -= moveDist;
            item.rot = (item.rot || 0) + dt * 4;

            if (this._checkPlayerItemCollision(item)) {
                if (item.type === 'COIN') {
                    this.coins++;
                    this.score += 100 * this.multiplier;
                    this._spawnExplosion(item.x, item.y, '#ffea00', 10);
                    this._triggerSound('coin');
                } else if (item.type === 'MULTIPLIER') {
                    this.multiplier = Math.min(8, this.multiplier + 1);
                    this.score += 250 * this.multiplier;
                    this._addFloatingText(item.x, item.y - 30, `+1X BOOST!`, '#00e5ff');
                    this._triggerSound('multiplier');
                } else if (item.type === 'SHIELD') {
                    this.player.hasShield = true;
                    this._addFloatingText(item.x, item.y - 30, `SHIELD ACTIVE!`, '#ff00e5');
                    this._triggerSound('shield');
                }
                this._emitScoreUpdate();
                this.collectibles.splice(i, 1);
                continue;
            }

            if (item.x < -50) {
                this.collectibles.splice(i, 1);
            }
        }

        // 7. Update Particles & Texts
        this._updateParticles(dt);
        this._updateFloatingTexts(dt);

        // Continuous score update for distance
        this.score += Math.floor(moveDist * 0.08 * this.multiplier);
        this._emitScoreUpdate();
    }

    _spawnObstacleWave() {
        const types = ['SPIKE_BARRIER', 'HIGH_LASER', 'PLASMA_TOWER', 'HOVER_DRONE'];
        const r = Math.random();
        let type;

        if (r < 0.35) type = 'SPIKE_BARRIER';
        else if (r < 0.65) type = 'HIGH_LASER';
        else if (r < 0.85) type = 'PLASMA_TOWER';
        else type = 'HOVER_DRONE';

        const startX = this.width + 50;

        if (type === 'SPIKE_BARRIER') {
            this.obstacles.push({
                type,
                x: startX,
                y: this.groundY - 42,
                w: 46,
                h: 42,
                color: '#ff0055'
            });
            this._spawnCoinArch(startX + 100, this.groundY - 110, 4);
        } else if (type === 'HIGH_LASER') {
            this.obstacles.push({
                type,
                x: startX,
                y: this.groundY - 140,
                w: 64,
                h: 96,
                color: '#ffea00'
            });
            // Coins under laser
            this.collectibles.push({ type: 'COIN', x: startX + 30, y: this.groundY - 20, r: 12 });
        } else if (type === 'PLASMA_TOWER') {
            this.obstacles.push({
                type,
                x: startX,
                y: this.groundY - 120,
                w: 38,
                h: 120,
                color: '#b000ff'
            });
            // High floating coins above tower
            this.collectibles.push({ type: 'COIN', x: startX + 19, y: this.groundY - 170, r: 14 });
            if (Math.random() < 0.4) {
                this.collectibles.push({ type: 'MULTIPLIER', x: startX + 80, y: this.groundY - 180, r: 16 });
            }
        } else if (type === 'HOVER_DRONE') {
            const baseY = this.groundY - 110;
            this.obstacles.push({
                type,
                x: startX,
                baseY: baseY,
                y: baseY,
                w: 48,
                h: 36,
                hoverT: 0,
                color: '#00e5ff'
            });
            if (Math.random() < 0.25) {
                this.collectibles.push({ type: 'SHIELD', x: startX + 120, y: this.groundY - 130, r: 16 });
            }
        }
    }

    _spawnCoinArch(startX, baseY, count) {
        for (let i = 0; i < count; i++) {
            const x = startX + i * 36;
            const y = baseY - Math.sin((i / (count - 1)) * Math.PI) * 45;
            this.collectibles.push({ type: 'COIN', x, y, r: 12 });
        }
    }

    _checkPlayerObstacleCollision(obs) {
        // Compute player bounding box depending on slide/normal state
        let px = this.player.x - this.player.width / 2;
        let py = this.player.y - this.player.height;
        let pw = this.player.width;
        let ph = this.player.height;

        if (this.player.isSliding) {
            ph = 30;
            pw = 56;
            py = this.player.y - ph;
            px = this.player.x - pw / 2 + 10;
        }

        // Inset hitboxes slightly for fair arcade collisions
        const margin = 6;
        return (
            px + margin < obs.x + obs.w &&
            px + pw - margin > obs.x &&
            py + margin < obs.y + obs.h &&
            py + ph - margin > obs.y
        );
    }

    _checkPlayerItemCollision(item) {
        const px = this.player.x;
        const py = this.player.y - this.player.height / 2;
        const distSq = (px - item.x) * (px - item.x) + (py - item.y) * (py - item.y);
        const radius = item.r + 25;
        return distSq < radius * radius;
    }

    _gameOver() {
        this.state = 'GAMEOVER';
        this.handleGlideEnd();
        this._spawnExplosion(this.player.x, this.player.y - 30, '#ff0055', 40);
        this._triggerSound('crash');
        this._triggerSound('gameOver');

        if (this.score > this.highScore) {
            this.highScore = this.score;
            localStorage.setItem('clap_runner_highscore', String(this.highScore));
        }

        if (this.callbacks.onGameOver) {
            this.callbacks.onGameOver({
                score: this.score,
                distance: Math.floor(this.distance),
                coins: this.coins,
                highScore: this.highScore
            });
        }
    }

    _spawnJumpParticles(x, y, color, count) {
        for (let i = 0; i < count; i++) {
            const ang = Math.PI * (0.6 + Math.random() * 0.8);
            const sp = 80 + Math.random() * 180;
            this.particles.push({
                x, y,
                vx: Math.cos(ang) * sp,
                vy: Math.sin(ang) * sp,
                color,
                size: 2.5 + Math.random() * 3,
                life: 0.45,
                maxLife: 0.45
            });
        }
    }

    _spawnSlideParticles(x, y, count) {
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: x - 15 + Math.random() * 10,
                y: y - 2,
                vx: -this.speed * 0.6 - Math.random() * 120,
                vy: -Math.random() * 90,
                color: Math.random() > 0.5 ? '#ffea00' : '#ff5500',
                size: 2 + Math.random() * 2,
                life: 0.25,
                maxLife: 0.25
            });
        }
    }

    _spawnExplosion(x, y, color, count) {
        for (let i = 0; i < count; i++) {
            const ang = Math.random() * Math.PI * 2;
            const sp = 90 + Math.random() * 260;
            this.particles.push({
                x, y,
                vx: Math.cos(ang) * sp,
                vy: Math.sin(ang) * sp,
                color,
                size: 3 + Math.random() * 4,
                life: 0.6,
                maxLife: 0.6
            });
        }
    }

    _addFloatingText(x, y, text, color) {
        this.floatingTexts.push({ x, y, text, color, life: 1.0, maxLife: 1.0 });
    }

    _updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 300 * dt; // slight gravity
        }
    }

    _updateFloatingTexts(dt) {
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const t = this.floatingTexts[i];
            t.life -= dt;
            if (t.life <= 0) {
                this.floatingTexts.splice(i, 1);
                continue;
            }
            t.y -= 35 * dt;
        }
    }

    _triggerSound(name) {
        if (this.callbacks.onSound) {
            this.callbacks.onSound(name);
        }
    }

    _emitScoreUpdate() {
        if (this.callbacks.onScoreChange) {
            this.callbacks.onScoreChange({
                score: this.score,
                distance: Math.floor(this.distance),
                coins: this.coins,
                multiplier: this.multiplier,
                streak: this.streak,
                highScore: this.highScore
            });
        }
    }

    _generateSkyline() {
        const buildings = [];
        let curX = 0;
        while (curX < this.width * 2) {
            const w = 50 + Math.random() * 70;
            const h = 140 + Math.random() * 180;
            buildings.push({ x: curX, w, h });
            curX += w + 8;
        }
        return buildings;
    }

    _generateMidline() {
        const buildings = [];
        let curX = 0;
        while (curX < this.width * 2) {
            const w = 70 + Math.random() * 90;
            const h = 80 + Math.random() * 120;
            buildings.push({ x: curX, w, h });
            curX += w + 14;
        }
        return buildings;
    }

    render() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.clearRect(0, 0, w, h);

        // 1. Sky & Cyber Sun
        const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
        skyGrad.addColorStop(0, '#060612');
        skyGrad.addColorStop(0.55, '#120b24');
        skyGrad.addColorStop(1, '#230a38');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, w, h);

        // Glowing Sun / Grid Orb
        const sunX = w * 0.75;
        const sunY = 170;
        const sunR = 85;
        const sunGrad = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, sunR);
        sunGrad.addColorStop(0, '#ff007f');
        sunGrad.addColorStop(0.7, '#ffea00');
        sunGrad.addColorStop(1, 'rgba(255, 0, 127, 0)');
        ctx.fillStyle = sunGrad;
        ctx.beginPath();
        ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
        ctx.fill();

        // Horizontal sun cut lines
        ctx.fillStyle = '#120b24';
        for (let i = 0; i < 7; i++) {
            const lineY = sunY + 15 + i * 10;
            const lineH = 1 + i * 0.9;
            ctx.fillRect(sunX - sunR, lineY, sunR * 2, lineH);
        }

        // 2. Far Skyline
        ctx.fillStyle = '#1a1033';
        for (const b of this.skylineBuildings) {
            const bx = (b.x - this.bgOffsetFar + w * 2) % (w * 2) - 50;
            ctx.fillRect(bx, this.groundY - b.h, b.w, b.h);
            // Window dots
            ctx.fillStyle = '#ff00aa33';
            for (let wy = this.groundY - b.h + 12; wy < this.groundY - 15; wy += 22) {
                for (let wx = bx + 8; wx < bx + b.w - 10; wx += 14) {
                    if ((wx + wy) % 5 === 0) {
                        ctx.fillRect(wx, wy, 4, 8);
                    }
                }
            }
            ctx.fillStyle = '#1a1033';
        }

        // 3. Midline Buildings & Billboards
        ctx.fillStyle = '#261447';
        for (const b of this.midlineBuildings) {
            const bx = (b.x - this.bgOffsetMid + w * 2) % (w * 2) - 50;
            ctx.fillRect(bx, this.groundY - b.h, b.w, b.h);

            // Neon Roof outline
            ctx.strokeStyle = '#00e5ff44';
            ctx.lineWidth = 2;
            ctx.strokeRect(bx, this.groundY - b.h, b.w, b.h);
        }

        // 4. Ground Road & Neon Grid
        const groundGrad = ctx.createLinearGradient(0, this.groundY, 0, h);
        groundGrad.addColorStop(0, '#0c071a');
        groundGrad.addColorStop(1, '#05020a');
        ctx.fillStyle = groundGrad;
        ctx.fillRect(0, this.groundY, w, h - this.groundY);

        // Neon Top Edge Line
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, this.groundY);
        ctx.lineTo(w, this.groundY);
        ctx.stroke();

        // Perspective Grid Lines
        ctx.strokeStyle = '#ff00aa33';
        ctx.lineWidth = 1.5;
        const gridSpacing = 40;
        const offset = this.bgOffsetNear % gridSpacing;
        for (let gx = -offset; gx < w; gx += gridSpacing) {
            ctx.beginPath();
            ctx.moveTo(gx, this.groundY);
            ctx.lineTo(gx - 60, h);
            ctx.stroke();
        }

        // 5. Draw Collectibles
        for (const item of this.collectibles) {
            ctx.save();
            ctx.translate(item.x, item.y);
            ctx.rotate(item.rot || 0);

            if (item.type === 'COIN') {
                ctx.fillStyle = '#ffea00';
                ctx.shadowColor = '#ffea00';
                ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.moveTo(0, -item.r);
                ctx.lineTo(item.r * 0.8, 0);
                ctx.lineTo(0, item.r);
                ctx.lineTo(-item.r * 0.8, 0);
                ctx.closePath();
                ctx.fill();
            } else if (item.type === 'MULTIPLIER') {
                ctx.fillStyle = '#00e5ff';
                ctx.shadowColor = '#00e5ff';
                ctx.shadowBlur = 15;
                ctx.beginPath();
                ctx.arc(0, 0, item.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 11px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('2X', 0, 0);
            } else if (item.type === 'SHIELD') {
                ctx.fillStyle = '#ff00e5';
                ctx.shadowColor = '#ff00e5';
                ctx.shadowBlur = 16;
                ctx.beginPath();
                ctx.arc(0, 0, item.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
            ctx.restore();
        }

        // 6. Draw Obstacles
        for (const obs of this.obstacles) {
            ctx.save();
            ctx.shadowColor = obs.color;
            ctx.shadowBlur = 14;
            ctx.fillStyle = obs.color;

            if (obs.type === 'SPIKE_BARRIER') {
                // Triangle spikes
                ctx.beginPath();
                ctx.moveTo(obs.x, obs.y + obs.h);
                ctx.lineTo(obs.x + obs.w * 0.25, obs.y);
                ctx.lineTo(obs.x + obs.w * 0.5, obs.y + obs.h);
                ctx.lineTo(obs.x + obs.w * 0.75, obs.y);
                ctx.lineTo(obs.x + obs.w, obs.y + obs.h);
                ctx.closePath();
                ctx.fill();
            } else if (obs.type === 'HIGH_LASER') {
                // Overhead beam
                ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(obs.x + 4, obs.y + 4, obs.w - 8, obs.h - 8);
            } else if (obs.type === 'PLASMA_TOWER') {
                // Tall pillar
                ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.strokeRect(obs.x + 3, obs.y + 3, obs.w - 6, obs.h - 6);
            } else if (obs.type === 'HOVER_DRONE') {
                // Flying drone
                ctx.beginPath();
                ctx.arc(obs.x + obs.w / 2, obs.y + obs.h / 2, obs.w / 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ff0055';
                ctx.fillRect(obs.x + 12, obs.y + obs.h / 2 - 3, obs.w - 24, 6);
            }
            ctx.restore();
        }

        // 7. Draw Player Character
        if (this.state === 'PLAYING' || this.state === 'TITLE') {
            this._renderPlayer(ctx);
        }

        // 8. Draw Particles
        for (const p of this.particles) {
            const alpha = Math.max(0, p.life / p.maxLife);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // 9. Draw Floating Text Badges
        for (const t of this.floatingTexts) {
            const alpha = Math.max(0, t.life / t.maxLife);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = t.color;
            ctx.shadowColor = t.color;
            ctx.shadowBlur = 10;
            ctx.font = 'bold 16px "Courier New", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(t.text, t.x, t.y);
            ctx.restore();
        }
    }

    _renderPlayer(ctx) {
        const p = this.player;

        // Invincibility flicker
        if (p.invincibleTimer > 0 && Math.floor(p.invincibleTimer * 14) % 2 === 0) {
            return;
        }

        ctx.save();
        ctx.translate(p.x, p.y);

        // Shield aura
        if (p.hasShield) {
            ctx.strokeStyle = '#ff00e5';
            ctx.shadowColor = '#ff00e5';
            ctx.shadowBlur = 20;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, -p.height / 2, p.height * 0.7, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (p.isSliding) {
            // Sliding cyber-dash pose
            ctx.fillStyle = '#00e5ff';
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 12;
            ctx.fillRect(-26, -26, 52, 24);

            // Visor
            ctx.fillStyle = '#ffea00';
            ctx.fillRect(12, -22, 14, 6);
        } else {
            // Standard runner / jumper / glider pose
            const legOffset = p.isGrounded ? Math.sin(p.runFrame * Math.PI) * 12 : 0;

            // Main Cyber Body
            ctx.fillStyle = '#00e5ff';
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 12;
            ctx.fillRect(-12, -p.height + 20, 24, 32);

            // Head & Glowing Neon Visor
            ctx.fillStyle = '#0a0d1e';
            ctx.fillRect(-9, -p.height, 18, 18);
            ctx.fillStyle = '#ff007f';
            ctx.shadowColor = '#ff007f';
            ctx.shadowBlur = 10;
            ctx.fillRect(0, -p.height + 4, 11, 7);

            // Running Limbs / Jet Boots
            ctx.fillStyle = '#00e5ff';
            ctx.fillRect(-10, -p.height + 52, 8, 16 + legOffset);
            ctx.fillRect(2, -p.height + 52, 8, 16 - legOffset);

            // Wings / Jetpack when gliding
            if (p.isGliding) {
                ctx.fillStyle = '#00ffaa';
                ctx.shadowColor = '#00ffaa';
                ctx.shadowBlur = 15;
                ctx.beginPath();
                ctx.moveTo(-12, -p.height + 25);
                ctx.lineTo(-35, -p.height + 15);
                ctx.lineTo(-12, -p.height + 35);
                ctx.closePath();
                ctx.fill();
            }
        }

        ctx.restore();
    }
}
