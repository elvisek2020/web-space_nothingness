import * as THREE from "three";
import {
    ELITE_MULTIPLIERS,
    ENEMY_TYPES,
    GAME_CONFIG,
    PERCEPTION,
    SPAWN_GRACE_SECONDS,
    SPAWN_SAFE_RADIUS,
    VISUALS,
} from "./config.js";
import { gameplayColliders, isInsideAnyCollider, moveWithSubsteps } from "./collision.js";
import {
    alertEnemiesBySound,
    buildColliderGrid,
    canEnemySeePlayer,
} from "./perception.js";
import {
    bossGroundY,
    calculateBallisticVelocity,
    clampBallisticY,
    clampBossJumpY,
    limitArcPeak,
    positionOnBallisticArc,
    STALKER_STATES,
} from "./stalker-physics.js";
import {
    createGlowSprite,
    createParticleBurst,
    disposeObject3D,
    getVisuals,
} from "./visual-utils.js";

export class EnemyManager {
    constructor(scene, levelConfig, world, quality, audio, callbacks = {}) {
        this.scene = scene;
        this.levelConfig = levelConfig;
        this.world = world;
        this.quality = quality;
        this.audio = audio;
        this.callbacks = callbacks;
        this.enemies = [];
        this.acidProjectiles = [];
        this.acidPool = [];
        this.effects = [];
        this.bossSpawned = false;
        this.bossDefeated = false;
        this.completed = false;
        this.started = false;
        this.spawnCursor = 0;
        this.randomSeed = levelConfig.number * 101;
        this.graceRemaining = 0;
        this.spatial = null;
    }

    start() {
        this.started = true;
        this.graceRemaining = SPAWN_GRACE_SECONDS;
        this.spatial = buildColliderGrid(gameplayColliders(this.world.colliders));
        this._spawnWave(this.levelConfig.enemies || {}, false);
        this._spawnWave(this.levelConfig.elite || {}, true);
        this._notifyCount();
    }

    _spawnWave(enemyMap, elite) {
        Object.entries(enemyMap).forEach(([type, count]) => {
            const points = this._pickRandomSpawnPoints(count);
            for (let index = 0; index < count; index += 1) {
                this.spawn(type, points[index] || null, elite);
            }
        });
    }

    alertBySound(origin, radius, player) {
        return alertEnemiesBySound(origin, radius, this.enemies, player.camera.position);
    }

    _random() {
        this.randomSeed = (this.randomSeed * 9301 + 49297) % 233280;
        return this.randomSeed / 233280;
    }

    spawn(type, requestedPosition = null, elite = false) {
        const definition = ENEMY_TYPES[type];
        if (!definition) return null;
        const point = requestedPosition || this._pickSpawnPoint(definition);
        const stats = elite ? ELITE_MULTIPLIERS : null;
        const color = elite
            ? new THREE.Color(definition.color).lerp(new THREE.Color(0xffe066), 0.35).getHex()
            : definition.color;
        const enemy = {
            type,
            definition,
            elite,
            group: this._createModel(type, { ...definition, color }, elite),
            hp: Math.round(definition.hp * (stats?.hp ?? 1)),
            radius: definition.radius,
            attackTimer: this._random() * definition.attackCooldown,
            jumpTimer: 1 + this._random() * 2,
            summonTimer: 6,
            hitTimer: 0,
            phase: this._random() * Math.PI * 2,
            burnRemaining: 0,
            burnDamage: 0,
            dead: false,
            aiState: "patrol",
            loseSightTimer: 0,
            alertTimer: 0,
            patrolDirection: new THREE.Vector3(
                this._random() - 0.5,
                0,
                this._random() - 0.5,
            ).normalize(),
            damageMultiplier: stats?.damage ?? 1,
            speedMultiplier: stats?.speed ?? 1,
            scoreMultiplier: stats?.score ?? 1,
        };
        if (definition.ceilingStalker) {
            enemy.stalkerState = STALKER_STATES.PATROL;
            enemy.stalkerTimer = definition.returnCooldown * (0.35 + this._random() * 0.65);
            enemy.soundTimer = 0.35 + this._random();
            enemy.patrolDirection = new THREE.Vector3(
                this._random() - 0.5,
                0,
                this._random() - 0.5,
            ).normalize();
            enemy.jumpElapsed = 0;
            enemy.jumpStart = null;
            enemy.jumpVelocity = null;
        }
        enemy.group.position.copy(point);
        enemy.group.position.y = definition.ceilingStalker
            ? definition.ceilingY
            : definition.radius * 0.72;
        enemy.group.scale.setScalar(definition.boss ? 1.25 : 1);
        if (definition.ceilingStalker) enemy.group.userData.model.rotation.z = Math.PI;
        this._rescueIfStuck(enemy);
        this.scene.add(enemy.group);
        this.enemies.push(enemy);
        this._notifyCount();
        return enemy;
    }

    _navSpawnPool() {
        const nodes = this.world.navNodes || [];
        if (nodes.length) {
            return nodes
                .filter((node) => node.kind === "ring" || node.kind === "tunnel" || node.kind === "module")
                .map((node) => new THREE.Vector3(node.x, 0, node.z));
        }
        return [...(this.world.spawnPoints || [])];
    }

    _rescueIfStuck(enemy) {
        if (
            enemy.definition.ceilingStalker
            && (
                enemy.stalkerState === STALKER_STATES.JUMP
                || enemy.stalkerState === STALKER_STATES.WARNING
                || enemy.stalkerState === STALKER_STATES.RETURN
            )
        ) {
            return false;
        }
        const probe = Math.max(0.7, enemy.radius * 0.85);
        const solid = gameplayColliders(this.world.colliders);
        if (!isInsideAnyCollider(enemy.group.position, probe, solid)) return false;
        const safe = this._pickSpawnPoint(enemy.definition);
        if (!safe) return false;
        enemy.group.position.x = safe.x;
        enemy.group.position.z = safe.z;
        if (!enemy.definition.ceilingStalker) {
            enemy.group.position.y = enemy.definition.radius * 0.72;
        }
        if (isInsideAnyCollider(enemy.group.position, probe, solid)) {
            console.warn("[ORION-9] enemy still inside collider after rescue", enemy.type);
        }
        return true;
    }

    rescueStuckEnemies() {
        let rescued = 0;
        this.enemies.forEach((enemy) => {
            if (enemy.dead) return;
            if (this._rescueIfStuck(enemy)) rescued += 1;
        });
        return rescued;
    }

    _pickRandomSpawnPoints(count) {
        const points = [...this._navSpawnPool()];
        for (let index = points.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(this._random() * (index + 1));
            [points[index], points[swap]] = [points[swap], points[index]];
        }
        const start = this.world.playerStart;
        const chosen = [];
        points.forEach((point) => {
            if (chosen.length >= count) return;
            const outsideSafe = !start
                || Math.hypot(point.x - start.x, point.z - start.z) >= SPAWN_SAFE_RADIUS;
            const spacingOk = chosen.every(
                (existing) => Math.hypot(existing.x - point.x, existing.z - point.z) >= 3,
            );
            const clear = !isInsideAnyCollider(point, 0.85, gameplayColliders(this.world.colliders));
            if (outsideSafe && spacingOk && clear) chosen.push(point.clone());
        });
        return chosen;
    }

    _pickSpawnPoint(definition) {
        const points = this._navSpawnPool();
        const start = this.world.playerStart;
        const probe = Math.max(0.7, definition.radius * 0.85);
        for (let attempt = 0; attempt < Math.max(points.length, 1) * 2; attempt += 1) {
            const point = points.length
                ? points[this.spawnCursor++ % points.length]
                : null;
            if (!point) break;
            const outsideSafeRadius = !start
                || Math.hypot(point.x - start.x, point.z - start.z) >= SPAWN_SAFE_RADIUS;
            const blocked = isInsideAnyCollider(point, probe, gameplayColliders(this.world.colliders));
            if (outsideSafeRadius && !blocked) {
                return point.clone();
            }
        }
        const candidates = points.filter((point) => {
            const outsideSafe = !start
                || Math.hypot(point.x - start.x, point.z - start.z) >= SPAWN_SAFE_RADIUS;
            return outsideSafe && !isInsideAnyCollider(
                point,
                probe,
                gameplayColliders(this.world.colliders),
            );
        });
        if (candidates.length) {
            return candidates.reduce((farthest, point) => (
                point.distanceToSquared(start) > farthest.distanceToSquared(start) ? point : farthest
            )).clone();
        }
        const nav = this.world.navNodes?.find((node) => node.kind === "ring");
        if (nav) return new THREE.Vector3(nav.x, 0, nav.z);
        const angle = Math.atan2(start?.x || 0, start?.z || 1) + Math.PI;
        const r = (this.world.layout?.ringRadius ?? this.world.layoutGraph?.ring?.radius ?? 20);
        return new THREE.Vector3(Math.sin(angle) * r, 0, Math.cos(angle) * r);
    }

    _createModel(type, definition, elite = false) {
        const group = new THREE.Group();
        group.name = definition.label;
        const shell = new THREE.MeshPhysicalMaterial({
            color: definition.color,
            ...VISUALS.materials.alien,
            emissive: definition.color,
            emissiveIntensity: definition.boss ? 0.42 : (elite ? 0.28 : 0.12),
        });
        const dark = new THREE.MeshPhysicalMaterial({
            color: 0x080c0f,
            roughness: 0.24,
            metalness: 0.12,
            clearcoat: 0.72,
            clearcoatRoughness: 0.2,
        });

        const body = new THREE.Mesh(
            new THREE.CapsuleGeometry(
                definition.radius * (definition.ceilingStalker ? 0.42 : 0.48),
                definition.radius * (definition.ceilingStalker ? 0.78 : 1.05),
                5,
                10,
            ),
            shell,
        );
        body.rotation.x = Math.PI / 2;
        body.scale.set(
            definition.ceilingStalker ? 1.18 : 1.05,
            definition.ceilingStalker ? 0.72 : 0.82,
            definition.ceilingStalker ? 0.92 : 1.18,
        );
        body.castShadow = this.quality === "high";
        body.userData.primaryShell = true;
        group.add(body);

        const abdomen = new THREE.Mesh(
            new THREE.SphereGeometry(definition.radius * 0.62, 12, 8),
            shell,
        );
        abdomen.scale.set(0.9, 0.72, 1.28);
        abdomen.position.z = definition.radius * 0.62;
        abdomen.castShadow = this.quality === "high";
        abdomen.userData.primaryShell = true;
        group.add(abdomen);

        const head = new THREE.Mesh(
            new THREE.SphereGeometry(definition.radius * 0.56, 12, 8),
            dark,
        );
        head.scale.set(1, 0.55, 1.4);
        head.position.set(0, 0.28, -definition.radius * 0.85);
        head.castShadow = this.quality === "high";
        group.add(head);

        const eyeColor = definition.boss ? 0xff243d : 0xa5ff46;
        const eyeMaterial = new THREE.MeshStandardMaterial({
            color: eyeColor,
            emissive: eyeColor,
            emissiveIntensity: VISUALS.emissive.eyeIntensity,
            roughness: 0.15,
            toneMapped: true,
        });
        for (const x of [-0.18, 0.18]) {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), eyeMaterial);
            eye.position.set(x * definition.radius, 0.34, -definition.radius * 1.38);
            group.add(eye);
            const eyeGlow = createGlowSprite(eyeColor, definition.boss ? 0.42 : 0.26, 0.68);
            eyeGlow.position.copy(eye.position);
            eyeGlow.position.z -= 0.04;
            group.add(eyeGlow);
        }

        {
            const legCount = definition.boss || definition.ceilingStalker ? 8 : 6;
            for (let index = 0; index < legCount; index += 1) {
                const angle = (index / legCount) * Math.PI * 2;
                const leg = new THREE.Group();
                leg.rotation.y = angle;
                leg.position.set(
                    Math.cos(angle) * definition.radius * 0.72,
                    -definition.radius * 0.42,
                    Math.sin(angle) * definition.radius * 0.72,
                );
                leg.userData.leg = index;
                const upper = new THREE.Mesh(
                    new THREE.CylinderGeometry(
                        definition.ceilingStalker ? 0.045 : 0.065,
                        definition.ceilingStalker ? 0.075 : 0.1,
                        definition.radius * (definition.ceilingStalker ? 1.2 : 0.9),
                        6,
                    ),
                    dark,
                );
                upper.rotation.z = Math.PI / 2.7;
                upper.position.x = definition.radius * 0.26;
                leg.add(upper);
                const joint = new THREE.Mesh(
                    new THREE.SphereGeometry(definition.radius * 0.12, 7, 5),
                    shell,
                );
                joint.position.x = definition.radius * 0.58;
                leg.add(joint);
                const lower = new THREE.Mesh(
                    new THREE.CylinderGeometry(
                        0.035,
                        definition.ceilingStalker ? 0.055 : 0.07,
                        definition.radius * (definition.ceilingStalker ? 1.18 : 0.88),
                        6,
                    ),
                    dark,
                );
                lower.rotation.z = -Math.PI / 3.2;
                lower.position.set(definition.radius * 0.78, -definition.radius * 0.25, 0);
                leg.add(lower);
                if (definition.ceilingStalker) leg.userData.stalkerLeg = true;
                group.add(leg);
            }

            for (let index = 0; index < 5; index += 1) {
                const tail = new THREE.Mesh(
                    new THREE.CapsuleGeometry(
                        definition.radius * (0.15 - index * 0.015),
                        definition.radius * 0.38,
                        3,
                        7,
                    ),
                    index % 2 ? dark : shell,
                );
                tail.rotation.x = Math.PI / 2;
                tail.position.set(
                    0,
                    0.05 + index * 0.035,
                    definition.radius * (1.15 + index * 0.42),
                );
                tail.userData.tail = index;
                group.add(tail);
            }

            for (const side of [-1, 1]) {
                const mandible = new THREE.Mesh(
                    new THREE.ConeGeometry(definition.radius * 0.11, definition.radius * 0.62, 6),
                    dark,
                );
                mandible.rotation.x = Math.PI / 2;
                mandible.rotation.z = side * 0.18;
                mandible.position.set(
                    side * definition.radius * 0.28,
                    0.02,
                    -definition.radius * 1.46,
                );
                mandible.userData.mandible = side;
                group.add(mandible);
            }
        }

        if (definition.ranged) {
            const sac = new THREE.Mesh(
                new THREE.SphereGeometry(definition.radius * 0.6, 8, 6),
                new THREE.MeshStandardMaterial({
                    color: 0xb7e83b,
                    emissive: 0x5b8f00,
                    emissiveIntensity: 0.7,
                }),
            );
            sac.position.z = definition.radius * 0.75;
            group.add(sac);
        }
        if (definition.boss) {
            for (let plate = 0; plate < 4; plate += 1) {
                const crown = new THREE.Mesh(
                    new THREE.ConeGeometry(
                        definition.radius * (0.72 - plate * 0.08),
                        definition.radius * 0.92,
                        5,
                    ),
                    shell,
                );
                crown.position.set(
                    0,
                    definition.radius * (0.52 + plate * 0.16),
                    definition.radius * (0.22 + plate * 0.18),
                );
                crown.rotation.x = -0.25 - plate * 0.08;
                group.add(crown);
            }
        }
        const root = new THREE.Group();
        root.name = definition.label;
        group.name = `${definition.label}-model`;
        root.add(group);
        root.userData.model = group;
        return root;
    }

    update(delta, elapsed, player) {
        if (!player?.active) return;
        this.graceRemaining = Math.max(0, this.graceRemaining - delta);
        const passive = this.graceRemaining > 0;
        const playerPosition = player.camera.position;
        this.enemies.forEach((enemy) => {
            if (enemy.dead) return;
            this._rescueIfStuck(enemy);
            enemy.attackTimer -= delta;
            enemy.jumpTimer -= delta;
            enemy.hitTimer = Math.max(0, enemy.hitTimer - delta);
            if (enemy.burnRemaining > 0) {
                enemy.burnRemaining -= delta;
                enemy.hp -= enemy.burnDamage * delta;
                if (enemy.hp <= 0) enemy.dead = true;
            }
            if (enemy.dead) return;
            if (passive) {
                this._animate(enemy, elapsed * 0.45);
                return;
            }
            if (enemy.definition.ceilingStalker) {
                this._updateCeilingStalker(enemy, delta, elapsed, player);
                return;
            }
            this._updateGroundEnemy(enemy, delta, elapsed, player);
        });

        this._collidePlayerProjectiles(player);
        this._updateAcid(delta, player);
        this._updateEffects(delta);
        this._removeDeadEnemies(player);

        const living = this.enemies.filter((enemy) => !enemy.dead);
        if (this.started && !this.bossSpawned && living.length === 0) this._spawnBoss();
        if (this.started && this.bossDefeated && living.length === 0 && !this.completed) {
            this.completed = true;
            this.callbacks.onComplete?.();
        }
    }

    _updateGroundEnemy(enemy, delta, elapsed, player) {
        const playerPosition = player.camera.position;
        const floorY = bossGroundY(enemy.radius, this.world.floorY ?? 0);
        const ceilingY = this.world.ceilingY ?? 6.85;
        const seesPlayer = canEnemySeePlayer(
            enemy,
            player,
            this.world.colliders,
            this.spatial,
        );
        if (seesPlayer) {
            enemy.aiState = "chase";
            enemy.lastKnownPosition = playerPosition.clone();
            enemy.loseSightTimer = PERCEPTION.loseSightSeconds;
        } else if (enemy.alertTimer > 0) {
            enemy.alertTimer -= delta;
            enemy.aiState = "investigate";
        } else if (enemy.loseSightTimer > 0) {
            enemy.loseSightTimer -= delta;
            enemy.aiState = "investigate";
        } else if (enemy.aiState !== "patrol") {
            enemy.aiState = "patrol";
        }

        const engaged = enemy.aiState === "chase" || enemy.aiState === "investigate";
        const target = engaged && enemy.lastKnownPosition
            ? enemy.lastKnownPosition
            : null;
        const toTarget = target
            ? new THREE.Vector3(
                target.x - enemy.group.position.x,
                0,
                target.z - enemy.group.position.z,
            )
            : enemy.patrolDirection.clone();
        const horizontalDistance = Math.hypot(toTarget.x, toTarget.z);
        const direction = horizontalDistance > 0.01
            ? toTarget.normalize()
            : enemy.patrolDirection;

        if (enemy.aiState === "patrol") {
            this._moveEnemy(
                enemy,
                enemy.patrolDirection.clone().multiplyScalar(enemy.definition.speed * 0.35 * delta),
            );
            if (this._random() < delta * 0.08) {
                enemy.patrolDirection.set(
                    this._random() - 0.5,
                    0,
                    this._random() - 0.5,
                ).normalize();
            }
        } else {
            const preferredRange = enemy.definition.ranged ? 8 : enemy.definition.attackRange * 0.8;
            const speedBoost = enemy.definition.jumper && enemy.jumpTimer < 0 ? 1.9 : 1;
            const speed = enemy.definition.speed * enemy.speedMultiplier * speedBoost;
            if (horizontalDistance > preferredRange || enemy.aiState === "investigate") {
                this._moveEnemy(enemy, direction.multiplyScalar(speed * delta));
            } else if (enemy.definition.ranged && horizontalDistance < 5) {
                this._moveEnemy(enemy, direction.multiplyScalar(-speed * 0.45 * delta));
            }
            if (
                enemy.aiState === "investigate"
                && horizontalDistance < 1.2
                && enemy.loseSightTimer <= 0
                && enemy.alertTimer <= 0
            ) {
                enemy.aiState = "patrol";
            }
        }

        if (engaged) {
            enemy.group.lookAt(playerPosition.x, enemy.group.position.y, playerPosition.z);
        }
        this._animate(enemy, elapsed);

        if (enemy.definition.jumper && enemy.jumpTimer < 0) {
            enemy.jumpTimer = 2.4 + this._random() * 2;
        }
        const jumping = engaged && enemy.definition.jumper && enemy.jumpTimer > 1.9;
        const jumpPhase = (enemy.jumpTimer - 1.9);
        enemy.group.position.y = jumping
            ? clampBossJumpY(floorY, jumpPhase, 1.1, floorY, ceilingY, enemy.radius)
            : floorY;

        const attackDistance = Math.hypot(
            playerPosition.x - enemy.group.position.x,
            playerPosition.z - enemy.group.position.z,
        );
        if (engaged && enemy.attackTimer <= 0) {
            const damage = Math.round(enemy.definition.damage * enemy.damageMultiplier);
            if (enemy.definition.ranged && attackDistance <= enemy.definition.attackRange) {
                this._fireAcid(enemy, playerPosition);
                enemy.attackTimer = enemy.definition.attackCooldown;
            } else if (attackDistance <= enemy.definition.attackRange) {
                player.damage(damage);
                enemy.attackTimer = enemy.definition.attackCooldown;
            }
        }

        if (enemy.definition.summons && engaged) {
            enemy.summonTimer -= delta;
            if (enemy.summonTimer <= 0 && this.enemies.filter((item) => !item.dead).length < 12) {
                for (let index = 0; index < 2; index += 1) {
                    const offset = new THREE.Vector3((index ? 1 : -1) * 2.2, 0, 1.5);
                    this.spawn("crawler", enemy.group.position.clone().add(offset));
                }
                enemy.summonTimer = 8;
                this.audio?.alienCry(true);
            }
        }
    }

    _moveEnemy(enemy, movement) {
        const radius = enemy.radius * 0.75;
        const next = moveWithSubsteps(
            { x: enemy.group.position.x, z: enemy.group.position.z },
            { x: movement.x, z: movement.z },
            radius,
            gameplayColliders(this.world.colliders),
            this.world.bounds,
            GAME_CONFIG.world.collisionSubstep,
        );
        enemy.group.position.x = next.x;
        enemy.group.position.z = next.z;
    }

    _updateCeilingStalker(enemy, delta, elapsed, player) {
        const definition = enemy.definition;
        const playerPosition = player.camera.position;
        const floorY = bossGroundY(enemy.radius, this.world.floorY ?? 0);
        const ceilingY = this.world.ceilingY ?? definition.ceilingY;
        const model = enemy.group.userData.model;
        const toPlayer = playerPosition.clone().sub(enemy.group.position);
        const horizontalDistance = Math.hypot(toPlayer.x, toPlayer.z);
        const direction = new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize();

        enemy.stalkerTimer -= delta;
        enemy.soundTimer -= delta;

        if (enemy.stalkerState === STALKER_STATES.PATROL) {
            enemy.group.position.y = definition.ceilingY;
            model.rotation.z = Math.PI;
            const before = enemy.group.position.clone();
            this._moveEnemy(
                enemy,
                enemy.patrolDirection.clone().multiplyScalar(definition.patrolSpeed * delta),
            );
            if (before.distanceToSquared(enemy.group.position) < 0.0001) {
                enemy.patrolDirection.set(
                    this._random() - 0.5,
                    0,
                    this._random() - 0.5,
                ).normalize();
            }
            enemy.group.lookAt(playerPosition.x, enemy.group.position.y, playerPosition.z);
            this._animate(enemy, elapsed * 1.2);
            if (enemy.soundTimer <= 0) {
                this.audio?.ceilingScratch(enemy.group.position);
                enemy.soundTimer = 1.2 + this._random() * 1.6;
            }
            if (
                (
                    horizontalDistance <= definition.detectionRange
                    && canEnemySeePlayer(
                        enemy,
                        player,
                        gameplayColliders(this.world.colliders),
                        this.spatial,
                    )
                )
                || enemy.alertTimer > 0
            ) {
                enemy.stalkerState = STALKER_STATES.WARNING;
                enemy.stalkerTimer = definition.warningDuration;
                this.audio?.ceilingScreech(enemy.group.position);
            }
            return;
        }

        if (enemy.stalkerState === STALKER_STATES.WARNING) {
            enemy.group.lookAt(playerPosition.x, enemy.group.position.y, playerPosition.z);
            const crouch = 1 - Math.sin(
                Math.max(0, enemy.stalkerTimer) / definition.warningDuration * Math.PI,
            ) * 0.18;
            model.scale.set(1.12 - crouch * 0.12, crouch, 1.12 - crouch * 0.12);
            this._animate(enemy, elapsed * 1.7);
            if (enemy.stalkerTimer <= 0) {
                model.scale.setScalar(1);
                enemy.stalkerState = STALKER_STATES.JUMP;
                enemy.jumpElapsed = 0;
                enemy.jumpStart = enemy.group.position.clone();
                const limited = limitArcPeak(
                    enemy.jumpStart.y,
                    floorY,
                    definition.jumpDuration,
                    definition.jumpForce,
                    ceilingY,
                );
                enemy.jumpTarget = new THREE.Vector3(
                    playerPosition.x,
                    limited.adjustedTargetY,
                    playerPosition.z,
                );
                const velocity = calculateBallisticVelocity(
                    enemy.jumpStart,
                    enemy.jumpTarget,
                    definition.jumpDuration,
                    definition.jumpForce,
                );
                enemy.jumpVelocity = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
            }
            return;
        }

        if (enemy.stalkerState === STALKER_STATES.JUMP) {
            enemy.jumpElapsed = Math.min(
                definition.jumpDuration,
                enemy.jumpElapsed + delta,
            );
            const next = positionOnBallisticArc(
                enemy.jumpStart,
                enemy.jumpVelocity,
                enemy.jumpElapsed,
                definition.jumpForce,
            );
            this._moveEnemy(
                enemy,
                new THREE.Vector3(
                    next.x - enemy.group.position.x,
                    0,
                    next.z - enemy.group.position.z,
                ),
            );
            // Clamp with floorY only (bossGroundY already includes stance height).
            enemy.group.position.y = clampBallisticY(next.y, floorY, ceilingY, 0);
            model.rotation.z = Math.PI * (
                1 - enemy.jumpElapsed / definition.jumpDuration
            );
            this._animate(enemy, elapsed * 2);
            if (
                enemy.jumpElapsed >= definition.jumpDuration - 1e-4
                || enemy.group.position.y <= floorY + 0.05
            ) {
                enemy.group.position.y = floorY;
                model.rotation.z = 0;
                enemy.stalkerState = STALKER_STATES.GROUND;
                enemy.stalkerTimer = definition.groundDuration;
                const impactDistance = Math.hypot(
                    playerPosition.x - enemy.group.position.x,
                    playerPosition.z - enemy.group.position.z,
                );
                if (impactDistance <= definition.attackRange + 0.9) {
                    player.damage(definition.impactDamage);
                }
                enemy.attackTimer = definition.attackCooldown;
            }
            return;
        }

        if (enemy.stalkerState === STALKER_STATES.GROUND) {
            enemy.group.position.y = floorY;
            model.rotation.z = 0;
            if (horizontalDistance > definition.attackRange * 0.8) {
                this._moveEnemy(
                    enemy,
                    direction.multiplyScalar(definition.speed * delta),
                );
            }
            enemy.group.lookAt(playerPosition.x, enemy.group.position.y, playerPosition.z);
            this._animate(enemy, elapsed * 1.35);
            if (enemy.attackTimer <= 0 && horizontalDistance <= definition.attackRange) {
                player.damage(definition.damage);
                enemy.attackTimer = definition.attackCooldown;
            }
            if (enemy.stalkerTimer <= 0) {
                enemy.stalkerState = STALKER_STATES.RETURN;
                enemy.stalkerTimer = definition.returnDuration;
                enemy.returnStartY = enemy.group.position.y;
            }
            return;
        }

        if (enemy.stalkerState === STALKER_STATES.RETURN) {
            const progress = THREE.MathUtils.clamp(
                1 - enemy.stalkerTimer / definition.returnDuration,
                0,
                1,
            );
            enemy.group.position.y = THREE.MathUtils.lerp(
                enemy.returnStartY,
                definition.ceilingY,
                progress,
            );
            model.rotation.z = progress * Math.PI;
            this._animate(enemy, elapsed * 1.1);
            if (enemy.stalkerTimer <= 0) {
                enemy.group.position.y = definition.ceilingY;
                model.rotation.z = Math.PI;
                enemy.stalkerState = STALKER_STATES.PATROL;
                enemy.stalkerTimer = definition.returnCooldown;
                enemy.patrolDirection.set(
                    this._random() - 0.5,
                    0,
                    this._random() - 0.5,
                ).normalize();
            }
        }
    }

    _animate(enemy, elapsed) {
        const pulse = elapsed * (enemy.type === "hunter" ? 12 : 7) + enemy.phase;
        enemy.group.traverse((part) => {
            if (part.userData.leg !== undefined) {
                const amplitude = part.userData.stalkerLeg ? 0.55 : 0.35;
                part.rotation.x = Math.sin(pulse + part.userData.leg) * amplitude;
                part.rotation.z = Math.cos(pulse * 0.8 + part.userData.leg)
                    * (part.userData.stalkerLeg ? 0.22 : 0.12);
            }
            if (part.userData.tail !== undefined) {
                part.rotation.y = Math.sin(
                    pulse * 0.45 - part.userData.tail * 0.62,
                ) * (0.18 + part.userData.tail * 0.025);
            }
            if (part.userData.mandible) {
                part.rotation.z = part.userData.mandible
                    * (0.16 + Math.sin(pulse * 0.6) * 0.08);
            }
        });
        enemy.group.rotation.z = Math.sin(pulse * 0.35) * 0.04;
    }

    _acquireAcid(boss) {
        const key = boss ? "boss" : "normal";
        const pooled = this.acidPool.find((item) => item.key === key);
        if (pooled) {
            this.acidPool.splice(this.acidPool.indexOf(pooled), 1);
            pooled.mesh.visible = true;
            return pooled;
        }
        const radius = boss ? 0.24 : 0.17;
        const material = getVisuals().getMaterial("acid-projectile", () => new THREE.MeshStandardMaterial({
            color: 0xd8ff62,
            emissive: 0x79ff19,
            emissiveIntensity: VISUALS.emissive.projectileIntensity,
            roughness: 0.18,
            toneMapped: true,
        }));
        const mesh = new THREE.Mesh(
            getVisuals().getGeometry(`acid-${key}`, () => new THREE.SphereGeometry(radius, 7, 6)),
            material,
        );
        mesh.add(createGlowSprite(0x8dff1f, boss ? 1.2 : 0.8, 0.8));
        if (this.quality === "high") {
            const light = new THREE.PointLight(0x8dff1f, 3, 2.5);
            light.castShadow = false;
            mesh.add(light);
        }
        return {
            key,
            mesh,
            velocity: new THREE.Vector3(),
            life: 0,
            damage: 0,
            radius: boss ? 0.35 : 0.25,
        };
    }

    _releaseAcid(projectile) {
        projectile.mesh.visible = false;
        projectile.mesh.removeFromParent();
        if (this.acidPool.length < 32) this.acidPool.push(projectile);
        else disposeObject3D(projectile.mesh);
    }

    _fireAcid(enemy, target) {
        const count = enemy.definition.burst || 1;
        for (let index = 0; index < count; index += 1) {
            const projectile = this._acquireAcid(Boolean(enemy.definition.boss));
            projectile.mesh.position.copy(enemy.group.position).add(new THREE.Vector3(0, 0.5, 0));
            const direction = target.clone().sub(projectile.mesh.position).normalize();
            if (count > 1) direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), (index - 1) * 0.12);
            projectile.velocity.copy(direction).multiplyScalar(enemy.definition.boss ? 11 : 8);
            projectile.life = 4;
            projectile.damage = enemy.definition.damage;
            this.scene.add(projectile.mesh);
            this.acidProjectiles.push(projectile);
        }
        this.audio?.alienCry(false);
    }

    _updateAcid(delta, player) {
        this.acidProjectiles.forEach((projectile) => {
            projectile.life -= delta;
            projectile.mesh.position.addScaledVector(projectile.velocity, delta);
            if (projectile.mesh.position.distanceTo(player.camera.position) < projectile.radius + 0.45) {
                player.damage(projectile.damage);
                this.effects.push(createParticleBurst(this.scene, {
                    position: projectile.mesh.position,
                    color: 0x9dff38,
                    count: this.quality === "high" ? 14 : 6,
                    speed: 4,
                    life: 0.55,
                    size: 0.13,
                    gravity: 3,
                    random: () => this._random(),
                }));
                projectile.life = 0;
            }
        });
        this.acidProjectiles = this.acidProjectiles.filter((projectile) => {
            if (projectile.life > 0) return true;
            this._releaseAcid(projectile);
            return false;
        });
    }

    _collidePlayerProjectiles(player) {
        player.projectiles.forEach((projectile) => {
            if (projectile.dead) return;
            const enemy = this.enemies.find(
                (candidate) => {
                    if (candidate.dead) return false;
                    const hitCenter = candidate.group.position.clone();
                    if (!candidate.definition.ceilingStalker) hitCenter.y += candidate.radius * 0.6;
                    const hitRadius = candidate.radius
                        * (candidate.definition.ceilingStalker ? 1.35 : 1.1);
                    const closest = new THREE.Line3(
                        projectile.previousPosition || projectile.mesh.position,
                        projectile.mesh.position,
                    ).closestPointToPoint(hitCenter, true, new THREE.Vector3());
                    return closest.distanceTo(hitCenter) < projectile.radius + hitRadius;
                },
            );
            if (!enemy) return;
            projectile.dead = true;
            enemy.hp -= projectile.damage;
            this.effects.push(createParticleBurst(this.scene, {
                position: projectile.mesh.position,
                color: projectile.mesh.material.color,
                count: this.quality === "high" ? 9 : 4,
                speed: 3.4,
                life: 0.42,
                size: 0.1,
                gravity: 4,
                random: () => this._random(),
            }));
            if (projectile.burnDuration > 0) {
                enemy.burnRemaining = Math.max(enemy.burnRemaining, projectile.burnDuration);
                enemy.burnDamage = Math.max(enemy.burnDamage, projectile.burnDamage);
            }
            enemy.hitTimer = 0.09;
            this.audio?.hit();
            enemy.group.traverse((part) => {
                if (part.userData.primaryShell && part.material) {
                    const original = part.material.emissiveIntensity;
                    part.material.emissiveIntensity = 2.5;
                    window.setTimeout(() => {
                        if (part.material) part.material.emissiveIntensity = original;
                    }, 70);
                }
            });
            if (enemy.hp <= 0) enemy.dead = true;
        });
    }

    _removeDeadEnemies(player) {
        const dead = this.enemies.filter((enemy) => enemy.dead);
        dead.forEach((enemy) => {
            this._deathEffect(enemy.group.position, enemy.definition.color, enemy.definition.boss);
            disposeObject3D(enemy.group);
            player.addScore(enemy.definition.score);
            this.audio?.enemyDeath(enemy.definition.boss);
            if (enemy.definition.boss) this.bossDefeated = true;
        });
        if (dead.length) {
            this.enemies = this.enemies.filter((enemy) => !enemy.dead);
            this._notifyCount();
        }
    }

    _deathEffect(position, color, large) {
        const baseCount = this.quality === "high"
            ? VISUALS.particles.deathHigh
            : VISUALS.particles.deathLow;
        this.effects.push(createParticleBurst(this.scene, {
            position,
            color,
            count: large ? Math.round(baseCount * 1.6) : baseCount,
            speed: large ? 8 : 5,
            life: large ? 1.5 : 0.8,
            size: large ? 0.25 : 0.16,
            gravity: 5,
            random: () => this._random(),
        }));

        const fragmentGroup = new THREE.Group();
        const fragmentMaterial = new THREE.MeshPhysicalMaterial({
            color,
            emissive: color,
            emissiveIntensity: large ? 2.6 : 1.5,
            ...VISUALS.materials.alien,
        });
        const pieces = [];
        const fragmentCount = large ? 12 : 6;
        for (let index = 0; index < fragmentCount; index += 1) {
            const fragment = new THREE.Mesh(
                new THREE.TetrahedronGeometry((large ? 0.3 : 0.18) * (0.7 + this._random())),
                fragmentMaterial,
            );
            fragment.position.copy(position);
            fragment.position.add(new THREE.Vector3(
                (this._random() - 0.5) * 0.7,
                (this._random() - 0.5) * 0.7,
                (this._random() - 0.5) * 0.7,
            ));
            fragmentGroup.add(fragment);
            pieces.push({
                mesh: fragment,
                velocity: new THREE.Vector3(
                    (this._random() - 0.5) * 6,
                    2 + this._random() * 5,
                    (this._random() - 0.5) * 6,
                ),
                spin: new THREE.Vector3(this._random(), this._random(), this._random())
                    .multiplyScalar(8),
            });
        }
        this.scene.add(fragmentGroup);
        this.effects.push({
            object: fragmentGroup,
            pieces,
            life: large ? 1.7 : 1.05,
            maxLife: large ? 1.7 : 1.05,
            update(delta) {
                this.life -= delta;
                this.pieces.forEach((piece) => {
                    piece.velocity.y -= delta * 7;
                    piece.mesh.position.addScaledVector(piece.velocity, delta);
                    piece.mesh.rotation.x += piece.spin.x * delta;
                    piece.mesh.rotation.y += piece.spin.y * delta;
                    piece.mesh.rotation.z += piece.spin.z * delta;
                    piece.mesh.material.emissiveIntensity = Math.max(
                        0,
                        2 * this.life / this.maxLife,
                    );
                });
                return this.life > 0;
            },
            dispose() {
                disposeObject3D(this.object);
            },
        });
    }

    _updateEffects(delta) {
        this.effects = this.effects.filter((effect) => {
            const alive = effect.update(delta);
            if (!alive) effect.dispose();
            return alive;
        });
    }

    _spawnBoss() {
        this.bossSpawned = true;
        const arena = this.world.bossArena;
        const point = arena
            ? new THREE.Vector3(arena.center.x, 0, arena.center.z)
            : new THREE.Vector3(0, 0, 0);
        const boss = this.levelConfig.boss;
        if (boss === "alphaPack") {
            for (let index = 0; index < 3; index += 1) {
                this.spawn("alpha", point.clone().add(new THREE.Vector3((index - 1) * 3.2, 0, 1.5)));
            }
            this.callbacks.onBoss?.("Alfa smečka");
        } else if (boss === "praetorianDuo") {
            this.spawn("praetorian", point.clone().add(new THREE.Vector3(-2.8, 0, 0)));
            this.spawn("praetorian", point.clone().add(new THREE.Vector3(2.8, 0, 0)));
            this.callbacks.onBoss?.("Dvojice pretoriánů");
        } else if (boss === "reactorGuardian") {
            this.spawn("mutant", point.clone());
            this.spawn("hunter", point.clone().add(new THREE.Vector3(3.5, 0, -2.5)));
            this.spawn("hunter", point.clone().add(new THREE.Vector3(-3.5, 0, -2.5)));
            this.callbacks.onBoss?.("Strážce reaktoru");
        } else {
            this.spawn(boss, point);
            this.callbacks.onBoss?.(ENEMY_TYPES[boss]?.label || boss);
        }
        this.audio?.bossAlarm();
    }

    _notifyCount() {
        this.callbacks.onCount?.(this.enemies.filter((enemy) => !enemy.dead).length);
    }

    damageEnemy(enemy, damage, source = "external") {
        if (!enemy || enemy.dead || damage <= 0) return false;
        enemy.hp -= damage;
        enemy.lastDamageSource = source;
        if (enemy.hp <= 0) enemy.dead = true;
        return enemy.dead;
    }

    damageInRadius(position, radius, damage, source = "external") {
        let killed = 0;
        this.enemies.forEach((enemy) => {
            if (enemy.dead) return;
            const distance = enemy.group.position.distanceTo(position);
            if (distance > radius) return;
            const falloff = Math.max(0.25, 1 - distance / radius);
            if (this.damageEnemy(enemy, damage * falloff, source)) killed += 1;
        });
        return killed;
    }

    killInRadius(position, radius, source = "external") {
        let killed = 0;
        this.enemies.forEach((enemy) => {
            if (!enemy.dead && enemy.group.position.distanceTo(position) <= radius) {
                enemy.dead = true;
                enemy.lastDamageSource = source;
                killed += 1;
            }
        });
        return killed;
    }

    getNearest(position, range) {
        let nearest = null;
        let nearestDistance = range;
        this.enemies.forEach((enemy) => {
            if (enemy.dead) return;
            const distance = enemy.group.position.distanceTo(position);
            if (distance < nearestDistance) {
                nearest = enemy;
                nearestDistance = distance;
            }
        });
        return nearest;
    }

    getRadarEntities() {
        return this.enemies
            .filter((enemy) => !enemy.dead)
            .map((enemy) => ({
                position: enemy.group.position,
                boss: Boolean(enemy.definition.boss),
                ceiling: enemy.definition.ceilingStalker && (
                    enemy.stalkerState === STALKER_STATES.PATROL
                    || enemy.stalkerState === STALKER_STATES.WARNING
                ),
            }));
    }

    dispose() {
        [...this.enemies].forEach((enemy) => {
            disposeObject3D(enemy.group);
        });
        this.enemies = [];
        this.acidProjectiles.forEach((projectile) => this._releaseAcid(projectile));
        this.acidProjectiles = [];
        this.acidPool.forEach((projectile) => disposeObject3D(projectile.mesh));
        this.acidPool = [];
        this.effects.forEach((effect) => effect.dispose());
        this.effects = [];
    }
}
