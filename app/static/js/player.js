import * as THREE from "three";
import { GAME_CONFIG, VISUALS, WEAPONS } from "./config.js";
import { isInsideAnyCollider, moveWithSubsteps } from "./collision.js";
import {
    createGlowSprite,
    createParticleBurst,
    createSmokeSprite,
    disposeObject3D,
    getVisuals,
} from "./visual-utils.js";

export class Player {
    constructor(camera, scene, canvas, audio, callbacks = {}) {
        this.camera = camera;
        this.scene = scene;
        this.canvas = canvas;
        this.audio = audio;
        this.callbacks = callbacks;
        this.hp = GAME_CONFIG.player.maxHp;
        this.score = 0;
        this.yaw = 0;
        this.pitch = 0;
        this.keys = new Set();
        this.colliders = [];
        this.bounds = null;
        this.projectiles = [];
        this.lastShot = -Infinity;
        this.weaponKick = 0;
        this.active = false;
        this.godmode = false;
        this.mouseHeld = false;
        this.unlockedWeapons = new Set(["pulse"]);
        this.ammo = {
            pulse: Infinity,
            shotgun: 0,
            flamethrower: 0,
        };
        this.activeWeapon = "pulse";
        this.random = Math.random;
        this.visualEffects = [];

        this._onKeyDown = (event) => {
            this.keys.add(event.code);
            if (event.repeat) return;
            const weapon = Object.entries(WEAPONS).find(([, definition]) => definition.key === event.code);
            if (weapon) this.selectWeapon(weapon[0]);
            if (event.code === "KeyE") this.callbacks.onInteract?.();
            if (event.code === "KeyT") this.callbacks.onTurret?.();
        };
        this._onKeyUp = (event) => this.keys.delete(event.code);
        this._onMouseMove = (event) => this._look(event);
        this._onMouseDown = (event) => {
            if (event.button === 0 && this.active && document.pointerLockElement === this.canvas) {
                this.mouseHeld = true;
                this.shoot(performance.now() / 1000);
            }
        };
        this._onMouseUp = (event) => {
            if (event.button === 0) this.mouseHeld = false;
        };
        this._onWheel = (event) => {
            if (!this.active) return;
            event.preventDefault();
            this.cycleWeapon(event.deltaY > 0 ? 1 : -1);
        };
        window.addEventListener("keydown", this._onKeyDown);
        window.addEventListener("keyup", this._onKeyUp);
        document.addEventListener("mousemove", this._onMouseMove);
        document.addEventListener("mousedown", this._onMouseDown);
        document.addEventListener("mouseup", this._onMouseUp);
        this.canvas.addEventListener("wheel", this._onWheel, { passive: false });

        this._createWeapon();
    }

    _createWeapon() {
        this.weapon = new THREE.Group();
        this.camera.add(this.weapon);
        this._buildWeaponModel("pulse");
    }

    _buildWeaponModel(type) {
        [...this.weapon.children].forEach((object) => disposeObject3D(object));
        const dark = new THREE.MeshPhysicalMaterial({
            color: 0x111a1f,
            metalness: 0.88,
            roughness: 0.24,
            clearcoat: 0.34,
            clearcoatRoughness: 0.18,
            envMapIntensity: 1.1,
        });
        const colors = { pulse: 0x19cfc4, shotgun: 0xffa93d, flamethrower: 0xff5125 };
        const accent = new THREE.MeshStandardMaterial({
            color: colors[type],
            emissive: colors[type],
            emissiveIntensity: VISUALS.emissive.stripIntensity,
            metalness: 0.72,
            roughness: 0.2,
            envMapIntensity: 1,
        });
        const bodySize = type === "shotgun" ? [0.3, 0.22, 0.95] : [0.25, 0.2, 0.78];
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(...bodySize, 2, 2, 3),
            dark,
        );
        body.position.z = -0.3;
        this.weapon.add(body);
        for (const side of [-1, 1]) {
            const rail = new THREE.Mesh(
                new THREE.BoxGeometry(0.035, 0.05, bodySize[2] * 0.88),
                accent,
            );
            rail.position.set(side * bodySize[0] * 0.52, bodySize[1] * 0.12, -0.3);
            this.weapon.add(rail);
        }
        const barrelCount = type === "shotgun" ? 2 : 1;
        for (let index = 0; index < barrelCount; index += 1) {
            const radius = type === "flamethrower" ? 0.075 : 0.05;
            const barrel = new THREE.Mesh(
                new THREE.CylinderGeometry(radius, radius * 1.15, 0.72, 12),
                dark,
            );
            barrel.rotation.x = Math.PI / 2;
            barrel.position.set((index - (barrelCount - 1) / 2) * 0.1, 0.05, -0.88);
            this.weapon.add(barrel);
            const coil = new THREE.Mesh(
                new THREE.TorusGeometry(radius * 1.6, radius * 0.34, 6, 16),
                accent,
            );
            coil.position.set(barrel.position.x, barrel.position.y, -0.75);
            this.weapon.add(coil);
        }
        const sight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.16), accent);
        sight.position.set(0, 0.13, -0.36);
        this.weapon.add(sight);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.2), dark);
        grip.position.set(0, -0.2, -0.18);
        grip.rotation.x = -0.28;
        this.weapon.add(grip);
        if (type === "flamethrower") {
            const tank = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.12, 0.48, 12),
                dark,
            );
            tank.rotation.x = Math.PI / 2;
            tank.position.set(-0.15, -0.05, -0.25);
            this.weapon.add(tank);
        }
        for (let index = 0; index < 4; index += 1) {
            const indicator = new THREE.Mesh(
                new THREE.BoxGeometry(0.025, 0.025, 0.065),
                accent.clone(),
            );
            indicator.position.set(0.135, 0.04, -0.12 - index * 0.09);
            indicator.userData.ammoIndicator = index;
            this.weapon.add(indicator);
        }
        this.weapon.position.set(0.38, -0.31, -0.58);
        this.weapon.rotation.set(-0.08, -0.12, 0);
        this.muzzleLight = new THREE.PointLight(colors[type], 0, 5, 2);
        this.muzzleLight.position.set(0.04, 0.05, -1.24);
        this.weapon.add(this.muzzleLight);
        this.muzzleFlash = createGlowSprite(colors[type], 0.7, 0);
        this.muzzleFlash.position.copy(this.muzzleLight.position);
        this.weapon.add(this.muzzleFlash);
    }

    reset(position, colliders, bounds, score = 0) {
        this.hp = GAME_CONFIG.player.maxHp;
        this.score = score;
        this.camera.position.copy(position);
        this.yaw = 0;
        this.pitch = 0;
        this.camera.rotation.set(0, 0, 0);
        this.colliders = colliders;
        this.bounds = bounds;
        this.keys.clear();
        this.active = true;
        this.godmode = false;
        this.unlockedWeapons = new Set(["pulse"]);
        this.ammo = { pulse: Infinity, shotgun: 0, flamethrower: 0 };
        this.activeWeapon = "pulse";
        this._buildWeaponModel("pulse");
        this.clearProjectiles();
        this.callbacks.onHealth?.(this.hp);
        this.callbacks.onScore?.(this.score);
        this._notifyWeapon();
    }

    setWorld(position, colliders, bounds) {
        this.camera.position.copy(position);
        this.colliders = colliders;
        this.bounds = bounds;
        this.clearProjectiles();
    }

    _look(event) {
        if (!this.active || document.pointerLockElement !== this.canvas) return;
        const sensitivity = 0.0022;
        this.yaw -= event.movementX * sensitivity;
        this.pitch -= event.movementY * sensitivity;
        this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2.15, Math.PI / 2.15);
        this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    }

    update(delta, elapsed) {
        if (!this.active) return;
        const direction = new THREE.Vector3();
        if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) direction.z -= 1;
        if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) direction.z += 1;
        if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) direction.x -= 1;
        if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) direction.x += 1;
        if (direction.lengthSq() > 0) {
            direction.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
            const movement = direction.multiplyScalar(
                GAME_CONFIG.player.speed * Math.min(delta, 0.05),
            );
            this.moveBy(movement.x, movement.z);
        }
        if (this.mouseHeld && this.activeWeapon === "flamethrower") {
            this.shoot(performance.now() / 1000);
        }

        const bob = direction.lengthSq() > 0 ? Math.sin(elapsed * 10) * 0.012 : 0;
        this.weaponKick = Math.max(0, this.weaponKick - delta * 5.5);
        this.weapon.position.y = -0.31 + bob;
        this.weapon.position.z = -0.58 + this.weaponKick * 0.12;
        this.weapon.rotation.x = -0.08 + this.weaponKick * 0.16;
        this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - delta * 90);
        this.muzzleFlash.material.opacity = Math.max(
            0,
            this.muzzleFlash.material.opacity - delta * 12,
        );
        this.muzzleFlash.scale.setScalar(
            0.65 + this.muzzleFlash.material.opacity * 0.55,
        );
        this._updateProjectiles(delta);
        this._updateVisualEffects(delta);
    }

    moveBy(x, z) {
        const resolved = moveWithSubsteps(
            { x: this.camera.position.x, z: this.camera.position.z },
            { x, z },
            GAME_CONFIG.player.radius,
            this.colliders,
            this.bounds,
            GAME_CONFIG.world.collisionSubstep,
        );
        this.camera.position.x = resolved.x;
        this.camera.position.z = resolved.z;
    }

    _blocked(x, z, radius) {
        return isInsideAnyCollider({ x, z }, radius, this.colliders);
    }

    _blockingCollider(x, z, radius) {
        return this.colliders.find((collider) => isInsideAnyCollider(
            { x, z },
            radius,
            [collider],
        ));
    }

    shoot(now) {
        const definition = WEAPONS[this.activeWeapon];
        if (now - this.lastShot < definition.cooldown) return false;
        const cost = definition.ammoCost || 1;
        if (Number.isFinite(this.ammo[this.activeWeapon]) && this.ammo[this.activeWeapon] < cost) {
            this.callbacks.onEmptyWeapon?.(definition.label);
            return false;
        }
        this.lastShot = now;
        if (Number.isFinite(this.ammo[this.activeWeapon])) {
            this.ammo[this.activeWeapon] -= cost;
        }
        this.weaponKick = 1;
        this.muzzleLight.intensity = 12;
        this.muzzleFlash.material.opacity = 1;
        this.muzzleFlash.scale.setScalar(this.activeWeapon === "shotgun" ? 1.35 : 0.9);
        if (this.activeWeapon !== "flamethrower" || this.random() < 0.22) {
            this._spawnMuzzleSmoke();
        }
        this.callbacks.onWeaponSound?.(
            this.camera.position,
            definition.soundRadius ?? 14,
        );
        this.audio?.weaponShot(this.activeWeapon);

        for (let index = 0; index < definition.pellets; index += 1) {
            const direction = new THREE.Vector3(0, 0, -1)
                .applyQuaternion(this.camera.quaternion)
                .normalize();
            if (definition.spread) {
                direction.x += (this.random() - 0.5) * definition.spread;
                direction.y += (this.random() - 0.5) * definition.spread;
                direction.z += (this.random() - 0.5) * definition.spread;
                direction.normalize();
            }
            const position = this.camera.position.clone().addScaledVector(direction, 0.8);
            position.y -= 0.08;
            const geometry = getVisuals().getGeometry(
                `projectile-${this.activeWeapon}`,
                () => new THREE.SphereGeometry(definition.projectileRadius, 10, 8),
            );
            const material = new THREE.MeshStandardMaterial({
                color: definition.color,
                emissive: definition.color,
                emissiveIntensity: VISUALS.emissive.projectileIntensity,
                roughness: 0.12,
                transparent: this.activeWeapon === "flamethrower",
                opacity: this.activeWeapon === "flamethrower" ? 0.78 : 1,
                toneMapped: true,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(position);
            mesh.add(createGlowSprite(
                definition.color,
                this.activeWeapon === "flamethrower" ? 0.72 : 0.48,
                0.82,
            ));
            if (this.activeWeapon !== "flamethrower") {
                mesh.add(new THREE.PointLight(definition.color, 4, 3, 2));
            }
            this.scene.add(mesh);
            this.projectiles.push({
                mesh,
                previousPosition: position.clone(),
                velocity: direction.multiplyScalar(definition.projectileSpeed),
                life: definition.projectileLife,
                damage: definition.damage,
                radius: definition.projectileRadius,
                weapon: this.activeWeapon,
                burnDamage: definition.burnDamage || 0,
                burnDuration: definition.burnDuration || 0,
                dead: false,
            });
        }
        this._notifyWeapon();
        return true;
    }

    _spawnMuzzleSmoke() {
        const sprite = createSmokeSprite(this.activeWeapon === "shotgun" ? 0.42 : 0.28, 0.42);
        const position = this.weapon.localToWorld(this.muzzleLight.position.clone());
        sprite.position.copy(position);
        this.scene.add(sprite);
        const direction = new THREE.Vector3(0, 0, -1)
            .applyQuaternion(this.camera.quaternion)
            .multiplyScalar(0.7);
        direction.y += 0.28;
        this.visualEffects.push({
            object: sprite,
            velocity: direction,
            life: 0.65,
            update(delta) {
                this.life -= delta;
                this.object.position.addScaledVector(this.velocity, delta);
                this.object.scale.addScalar(delta * 0.24);
                this.object.material.opacity = Math.max(0, this.life / 0.65 * 0.42);
                return this.life > 0;
            },
            dispose() {
                disposeObject3D(this.object);
            },
        });
    }

    _updateVisualEffects(delta) {
        this.visualEffects = this.visualEffects.filter((effect) => {
            const alive = effect.update(delta);
            if (!alive) effect.dispose();
            return alive;
        });
    }

    _updateProjectiles(delta) {
        this.projectiles.forEach((projectile) => {
            if (projectile.dead) return;
            projectile.life -= delta;
            projectile.previousPosition.copy(projectile.mesh.position);
            const distance = projectile.velocity.length() * delta;
            const steps = Math.max(1, Math.ceil(distance / GAME_CONFIG.world.collisionSubstep));
            for (let step = 0; step < steps && !projectile.dead; step += 1) {
                projectile.mesh.position.addScaledVector(projectile.velocity, delta / steps);
                const { x, z } = projectile.mesh.position;
                const blockingCollider = this._blockingCollider(x, z, projectile.radius);
                if (blockingCollider?.type === "barrel") break;
                if (
                    projectile.life <= 0
                    || blockingCollider
                    || (this.bounds && (
                        x < this.bounds.minX || x > this.bounds.maxX
                        || z < this.bounds.minZ || z > this.bounds.maxZ
                    ))
                ) {
                    if (blockingCollider) {
                        this._spawnImpact(projectile.mesh.position, projectile.mesh.material.color);
                    }
                    projectile.dead = true;
                }
            }
        });
        this._removeDeadProjectiles();
    }

    _removeDeadProjectiles() {
        this.projectiles = this.projectiles.filter((projectile) => {
            if (!projectile.dead) return true;
            disposeObject3D(projectile.mesh);
            return false;
        });
    }

    _spawnImpact(position, color) {
        this.visualEffects.push(createParticleBurst(this.scene, {
            position,
            color,
            count: getVisuals().quality === "high" ? 9 : 4,
            speed: 3.5,
            life: 0.38,
            size: 0.09,
            gravity: 5,
            random: this.random,
        }));
    }

    damage(amount) {
        if (!this.active || this.godmode || amount <= 0) return;
        this.hp = Math.max(0, this.hp - amount);
        this.audio?.playerHurt();
        this.callbacks.onHealth?.(this.hp);
        this.callbacks.onDamage?.();
        if (this.hp <= 0) {
            this.active = false;
            this.callbacks.onDeath?.();
        }
    }

    heal(amount) {
        if (this.hp >= GAME_CONFIG.player.maxHp) return false;
        this.hp = Math.min(GAME_CONFIG.player.maxHp, this.hp + amount);
        this.audio?.pickup();
        this.callbacks.onHealth?.(this.hp);
        this.callbacks.onHeal?.();
        return true;
    }

    selectWeapon(type) {
        if (!WEAPONS[type] || !this.unlockedWeapons.has(type)) return false;
        this.activeWeapon = type;
        this._buildWeaponModel(type);
        this._notifyWeapon();
        return true;
    }

    cycleWeapon(direction) {
        const available = Object.keys(WEAPONS).filter((type) => this.unlockedWeapons.has(type));
        const current = available.indexOf(this.activeWeapon);
        const next = (current + direction + available.length) % available.length;
        this.selectWeapon(available[next]);
    }

    unlockWeapon(type) {
        if (!WEAPONS[type]) return false;
        const wasLocked = !this.unlockedWeapons.has(type);
        this.unlockedWeapons.add(type);
        if (wasLocked) {
            this.ammo[type] = Math.max(this.ammo[type] || 0, WEAPONS[type].ammo);
            this.selectWeapon(type);
        }
        return wasLocked;
    }

    addAmmo(type, amount = WEAPONS[type]?.ammoPickup || 0) {
        if (!WEAPONS[type] || !Number.isFinite(this.ammo[type])) return false;
        this.ammo[type] += amount;
        this._notifyWeapon();
        return true;
    }

    _notifyWeapon() {
        const definition = WEAPONS[this.activeWeapon];
        const ammo = this.ammo[this.activeWeapon];
        const ratio = Number.isFinite(ammo)
            ? Math.max(0, Math.min(1, ammo / Math.max(1, definition.ammo)))
            : 1;
        this.weapon?.traverse((part) => {
            if (part.userData.ammoIndicator !== undefined && part.material) {
                const active = part.userData.ammoIndicator < Math.ceil(ratio * 4);
                part.material.emissiveIntensity = active ? VISUALS.emissive.stripIntensity : 0.05;
                part.material.opacity = active ? 1 : 0.35;
                part.material.transparent = !active;
            }
        });
        this.callbacks.onWeapon?.(
            definition.label,
            ammo,
            this.activeWeapon,
        );
    }

    setGodmode(enabled) {
        this.godmode = Boolean(enabled);
    }

    addScore(amount) {
        this.score = Math.min(GAME_CONFIG.scoreMax, this.score + amount);
        this.callbacks.onScore?.(this.score);
    }

    clearProjectiles() {
        this.projectiles.forEach((projectile) => disposeObject3D(projectile.mesh));
        this.projectiles = [];
        this.visualEffects.forEach((effect) => effect.dispose());
        this.visualEffects = [];
    }

    dispose() {
        this.active = false;
        this.clearProjectiles();
        window.removeEventListener("keydown", this._onKeyDown);
        window.removeEventListener("keyup", this._onKeyUp);
        document.removeEventListener("mousemove", this._onMouseMove);
        document.removeEventListener("mousedown", this._onMouseDown);
        document.removeEventListener("mouseup", this._onMouseUp);
        this.canvas.removeEventListener("wheel", this._onWheel);
        disposeObject3D(this.weapon);
    }
}
