import * as THREE from "three";
import { FEATURES, GAME_CONFIG, VISUALS } from "./config.js";
import { isInsideAnyCollider } from "./collision.js";
import {
    createGlowSprite,
    disposeObject3D,
} from "./visual-utils.js";

export class AirlockSystem {
    constructor(scene, position, audio, callbacks = {}) {
        this.scene = scene;
        this.position = position;
        this.audio = audio;
        this.callbacks = callbacks;
        this.used = false;
        this.activeRemaining = 0;
        this.particles = null;
    }

    isNear(player) {
        return Boolean(
            this.position
            && player.camera.position.distanceTo(this.position) <= FEATURES.airlock.interactionRadius,
        );
    }

    interact(player, enemyManager) {
        if (!this.isNear(player) || this.used) return false;
        this.used = true;
        this.activeRemaining = FEATURES.airlock.duration;
        const killed = enemyManager.killInRadius(
            this.position,
            FEATURES.airlock.suctionRadius,
            "airlock",
        );
        player.addScore(killed * FEATURES.airlock.scoreBonus);
        this.audio?.decompression();
        this._createWind();
        this.callbacks.onActivated?.(killed);
        return true;
    }

    _createWind() {
        const geometry = new THREE.BufferGeometry();
        const positions = [];
        for (let index = 0; index < 90; index += 1) {
            positions.push(
                this.position.x + (Math.random() - 0.5) * 12,
                Math.random() * 4,
                this.position.z + (Math.random() - 0.5) * 12,
            );
        }
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        this.particles = new THREE.Points(
            geometry,
            new THREE.PointsMaterial({
                color: 0xc8efff,
                size: 0.09,
                transparent: true,
                opacity: 0.7,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            }),
        );
        this.scene.add(this.particles);
    }

    update(delta) {
        if (this.activeRemaining <= 0) return;
        this.activeRemaining -= delta;
        if (this.particles) {
            const positions = this.particles.geometry.attributes.position;
            for (let index = 0; index < positions.count; index += 1) {
                positions.setX(index, positions.getX(index) + delta * 7);
            }
            positions.needsUpdate = true;
        }
        if (this.activeRemaining <= 0 && this.particles) {
            this.scene.remove(this.particles);
            this.particles.geometry.dispose();
            this.particles.material.dispose();
            this.particles = null;
        }
    }

    dispose() {
        if (this.particles) {
            this.scene.remove(this.particles);
            this.particles.geometry.dispose();
            this.particles.material.dispose();
        }
    }
}

export class OxygenSystem {
    constructor(zone, audio, callbacks = {}) {
        this.zone = zone;
        this.audio = audio;
        this.callbacks = callbacks;
        this.oxygen = FEATURES.oxygen.max;
        this.inZone = false;
        this.warningTimer = 0;
    }

    update(delta, player) {
        if (!this.zone) return;
        const { x, z } = player.camera.position;
        this.inZone = x >= this.zone.minX && x <= this.zone.maxX
            && z >= this.zone.minZ && z <= this.zone.maxZ;
        if (this.inZone) {
            this.oxygen = Math.max(0, this.oxygen - delta);
            if (this.oxygen <= 0) player.damage(FEATURES.oxygen.damagePerSecond * delta);
            if (this.oxygen <= FEATURES.oxygen.warningThreshold) {
                this.warningTimer -= delta;
                if (this.warningTimer <= 0) {
                    this.warningTimer = 0.8;
                    this.audio?.oxygenWarning();
                }
            }
        } else {
            this.oxygen = Math.min(
                FEATURES.oxygen.max,
                this.oxygen + FEATURES.oxygen.refillRate * delta,
            );
        }
        this.callbacks.onChange?.(this.oxygen, this.inZone);
    }

    refill(amount = FEATURES.oxygen.pickupAmount) {
        this.oxygen = Math.min(FEATURES.oxygen.max, this.oxygen + amount);
        this.callbacks.onChange?.(this.oxygen, this.inZone);
    }
}

export class SurvivorManager {
    constructor(scene, positions, audio, callbacks = {}) {
        this.scene = scene;
        this.audio = audio;
        this.callbacks = callbacks;
        this.total = positions.length;
        this.rescued = 0;
        this.survivors = positions.map((position, index) => this._create(position, index));
    }

    _create(position, index) {
        const group = new THREE.Group();
        const suit = new THREE.MeshPhysicalMaterial({
            color: 0x3876ae,
            emissive: 0x145c9a,
            emissiveIntensity: 0.5,
            metalness: 0.42,
            roughness: 0.35,
            clearcoat: 0.45,
        });
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 4, 8), suit);
        body.position.y = 0.65;
        group.add(body);
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, 8, 6),
            new THREE.MeshStandardMaterial({ color: 0xd8b39a }),
        );
        head.position.y = 1.45;
        group.add(head);
        const visor = new THREE.Mesh(
            new THREE.SphereGeometry(0.19, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.55),
            new THREE.MeshStandardMaterial({
                color: 0x8de8ff,
                emissive: 0x39bfff,
                emissiveIntensity: VISUALS.emissive.displayIntensity,
                metalness: 0.6,
                roughness: 0.15,
            }),
        );
        visor.position.set(0, 1.48, -0.13);
        visor.rotation.x = Math.PI;
        group.add(visor);
        const pack = new THREE.Mesh(
            new THREE.BoxGeometry(0.42, 0.64, 0.22),
            suit,
        );
        pack.position.set(0, 0.9, 0.3);
        group.add(pack);
        group.position.copy(position);
        group.name = `survivor-${index}`;
        this.scene.add(group);
        return { group, rescued: false };
    }

    update(player) {
        this.survivors.forEach((survivor) => {
            if (survivor.rescued) return;
            survivor.group.lookAt(
                player.camera.position.x,
                survivor.group.position.y,
                player.camera.position.z,
            );
            if (survivor.group.position.distanceTo(player.camera.position)
                <= FEATURES.survivors.rescueRadius) {
                survivor.rescued = true;
                this.rescued += 1;
                player.addScore(FEATURES.survivors.score);
                this.audio?.survivorTeleport();
                this._teleportEffect(survivor.group.position);
                disposeObject3D(survivor.group);
                this.callbacks.onRescued?.(this.rescued, this.total);
            }
        });
    }

    _teleportEffect(position) {
        const light = new THREE.PointLight(0x48aaff, 14, 8, 2);
        light.position.copy(position);
        this.scene.add(light);
        window.setTimeout(() => this.scene.remove(light), 350);
    }

    getRadarEntities() {
        return this.survivors
            .filter((survivor) => !survivor.rescued)
            .map((survivor) => ({ position: survivor.group.position }));
    }

    dispose() {
        this.survivors.forEach((survivor) => {
            if (!survivor.rescued) disposeObject3D(survivor.group);
        });
    }
}

export class TurretSystem {
    constructor(scene, world, audio, callbacks = {}) {
        this.scene = scene;
        this.world = world;
        this.audio = audio;
        this.callbacks = callbacks;
        this.kits = 0;
        this.active = null;
    }

    addKit() {
        this.kits += 1;
        this.callbacks.onHint?.(`[T] VĚŽIČKA (${this.kits})`);
    }

    place(player) {
        if (this.kits <= 0 || this.active) return false;
        const forward = new THREE.Vector3(0, 0, -1)
            .applyQuaternion(player.camera.quaternion);
        forward.y = 0;
        forward.normalize();
        const position = player.camera.position.clone().addScaledVector(
            forward,
            FEATURES.turret.placementDistance,
        );
        if (isInsideAnyCollider(position, 0.6, this.world.colliders)) return false;
        const group = this._createModel();
        group.position.set(position.x, 0, position.z);
        this.scene.add(group);
        const collider = {
            id: "active-turret",
            type: "turret",
            minX: position.x - 0.55,
            maxX: position.x + 0.55,
            minZ: position.z - 0.55,
            maxZ: position.z + 0.55,
        };
        this.world.colliders.push(collider);
        this.active = {
            group,
            collider,
            remaining: FEATURES.turret.lifetime,
            ammo: FEATURES.turret.ammo,
            cooldown: 0,
        };
        this.kits -= 1;
        return true;
    }

    _createModel() {
        const group = new THREE.Group();
        const metal = new THREE.MeshPhysicalMaterial({
            color: 0x5d6870,
            metalness: 0.88,
            roughness: 0.24,
            clearcoat: 0.3,
        });
        for (let index = 0; index < 3; index += 1) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 1.2, 6), metal);
            const angle = index * Math.PI * 2 / 3;
            leg.rotation.z = 0.45;
            leg.rotation.y = angle;
            leg.position.set(Math.cos(angle) * 0.28, 0.48, Math.sin(angle) * 0.28);
            group.add(leg);
        }
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.32, 0.48), metal);
        head.position.y = 1.05;
        head.name = "turret-head";
        group.add(head);
        for (const side of [-1, 1]) {
            const barrel = new THREE.Mesh(
                new THREE.CylinderGeometry(0.055, 0.07, 0.82, 10),
                metal,
            );
            barrel.rotation.x = Math.PI / 2;
            barrel.position.set(side * 0.2, 1.05, -0.56);
            group.add(barrel);
        }
        const muzzle = new THREE.PointLight(0xffe15a, 0, 5, 2);
        muzzle.position.set(0, 0, -0.55);
        head.add(muzzle);
        const sensor = createGlowSprite(0xffe15a, 0.36, 0.75);
        sensor.position.set(0, 0.08, -0.28);
        head.add(sensor);
        group.userData.muzzle = muzzle;
        return group;
    }

    update(delta, enemyManager) {
        if (!this.active) {
            this.callbacks.onLifetime?.(0);
            return;
        }
        this.active.remaining -= delta;
        this.active.cooldown -= delta;
        const target = enemyManager.getNearest(
            this.active.group.position,
            FEATURES.turret.range,
        );
        if (target) {
            this.active.group.lookAt(
                target.group.position.x,
                this.active.group.position.y,
                target.group.position.z,
            );
            if (this.active.cooldown <= 0 && this.active.ammo > 0) {
                enemyManager.damageEnemy(target, FEATURES.turret.damage, "turret");
                this.active.cooldown = FEATURES.turret.cooldown;
                this.active.ammo -= 1;
                this.active.group.userData.muzzle.intensity = 12;
                this.audio?.turretShot();
            }
        }
        this.active.group.userData.muzzle.intensity = Math.max(
            0,
            this.active.group.userData.muzzle.intensity - delta * 80,
        );
        this.callbacks.onLifetime?.(this.active.remaining);
        if (this.active.remaining <= 0 || this.active.ammo <= 0) this._remove();
    }

    _remove() {
        if (!this.active) return;
        disposeObject3D(this.active.group);
        const index = this.world.colliders.indexOf(this.active.collider);
        if (index >= 0) this.world.colliders.splice(index, 1);
        this.active = null;
        this.callbacks.onLifetime?.(0);
    }

    dispose() {
        this._remove();
    }
}

export class SelfDestructSystem {
    constructor(scene, escapePoint, audio, callbacks = {}) {
        this.scene = scene;
        this.escapePoint = escapePoint;
        this.audio = audio;
        this.callbacks = callbacks;
        this.active = false;
        this.remaining = FEATURES.selfDestruct.duration;
        this.graceRemaining = 0;
        this.module = null;
    }

    start(enemyManager) {
        if (this.active || !this.escapePoint) return;
        this.active = true;
        this.remaining = FEATURES.selfDestruct.duration;
        this.graceRemaining = 0.5;
        this.audio?.selfDestructAlarm();
        this._createEscapeModule();
        for (let index = 0; index < FEATURES.selfDestruct.finalCrawlers; index += 1) {
            enemyManager.spawn("crawler", new THREE.Vector3(
                (index - 2) * 2.5,
                0,
                this.escapePoint.z - 7 - index * 2,
            ));
        }
        this.callbacks.onStart?.(this.remaining);
    }

    _createEscapeModule() {
        const group = new THREE.Group();
        const hull = new THREE.Mesh(
            new THREE.CylinderGeometry(1.8, 2.4, 4, 10),
            new THREE.MeshPhysicalMaterial({
                color: 0xc7d2d8,
                emissive: 0x35ff8b,
                emissiveIntensity: 1.1,
                metalness: 0.82,
                roughness: 0.22,
                clearcoat: 0.35,
            }),
        );
        hull.rotation.x = Math.PI / 2;
        hull.position.y = 1.6;
        group.add(hull);
        const beacon = new THREE.PointLight(0x35ff8b, 14, 18, 2);
        beacon.position.y = 2.2;
        group.add(beacon);
        const portalGlow = createGlowSprite(0x35ff8b, 4.8, 0.34);
        portalGlow.position.y = 1.8;
        group.add(portalGlow);
        group.position.copy(this.escapePoint);
        this.scene.add(group);
        this.module = group;
    }

    update(delta, player) {
        if (!this.active) return;
        this.remaining -= delta;
        this.graceRemaining = Math.max(0, this.graceRemaining - delta);
        this.callbacks.onTick?.(this.remaining);
        if (
            this.graceRemaining <= 0
            && player.camera.position.distanceTo(this.escapePoint) <= FEATURES.selfDestruct.escapeRadius
        ) {
            this.active = false;
            const bonus = Math.ceil(this.remaining) * FEATURES.selfDestruct.scorePerSecond;
            player.addScore(bonus);
            this.callbacks.onEscaped?.(bonus);
        } else if (this.remaining <= 0) {
            this.active = false;
            this.callbacks.onExploded?.();
            player.damage(GAME_CONFIG.player.maxHp * 2);
        }
    }

    dispose() {
        if (this.module) {
            disposeObject3D(this.module);
        }
    }
}
