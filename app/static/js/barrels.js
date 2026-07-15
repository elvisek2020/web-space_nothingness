import * as THREE from "three";
import { FEATURES, VISUALS } from "./config.js";
import {
    createGlowSprite,
    createParticleBurst,
    createShockwave,
    createSmokeSprite,
    disposeObject3D,
    getVisuals,
} from "./visual-utils.js";

export class BarrelManager {
    constructor(scene, positions, world, quality, audio) {
        this.scene = scene;
        this.world = world;
        this.quality = quality;
        this.audio = audio;
        this.barrels = positions.map((position, index) => this._create(position, index));
        this.effects = [];
        this.chainTimers = new Set();
        this.disposed = false;
    }

    _create(position, index) {
        const group = new THREE.Group();
        const maps = getVisuals().textures.getMaps("barrel", 2, 1);
        const shell = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            ...VISUALS.materials.barrel,
            ...maps,
            emissive: 0x3a0005,
            emissiveIntensity: 0.45,
            envMapIntensity: 0.95,
        });
        const hazardMaps = getVisuals().textures.getMaps("hazard", 3, 1);
        const band = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 0.68,
            roughness: 0.34,
            ...hazardMaps,
        });
        group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 1.35, 20), shell));
        for (const y of [-0.42, 0.42]) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.065, 8, 20), band);
            ring.rotation.x = Math.PI / 2;
            ring.position.y = y;
            group.add(ring);
        }
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.035, 8, 20), band);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.69;
        group.add(rim);
        group.position.copy(position);
        this.scene.add(group);
        const collider = {
            id: `barrel-${index}`,
            type: "barrel",
            minX: position.x - 0.5,
            maxX: position.x + 0.5,
            minZ: position.z - 0.5,
            maxZ: position.z + 0.5,
        };
        this.world.colliders.push(collider);
        return { group, collider, hp: FEATURES.barrels.hp, exploded: false };
    }

    update(delta, player, enemyManager) {
        player.projectiles.forEach((projectile) => {
            if (projectile.dead) return;
            const barrel = this.barrels.find(
                (item) => {
                    if (item.exploded) return false;
                    const closest = new THREE.Line3(
                        projectile.previousPosition || projectile.mesh.position,
                        projectile.mesh.position,
                    ).closestPointToPoint(item.group.position, true, new THREE.Vector3());
                    return closest.distanceTo(item.group.position) < projectile.radius + 0.65;
                },
            );
            if (!barrel) return;
            projectile.dead = true;
            barrel.hp -= projectile.damage;
            if (barrel.hp <= 0) this._explode(barrel, player, enemyManager);
        });
        this._updateEffects(delta);
    }

    _explode(barrel, player, enemyManager) {
        if (barrel.exploded || this.disposed) return;
        barrel.exploded = true;
        const position = barrel.group.position.clone();
        disposeObject3D(barrel.group);
        this.world.colliders.splice(this.world.colliders.indexOf(barrel.collider), 1);
        this.audio?.explosion();
        if (position.distanceTo(player.camera.position) <= FEATURES.barrels.explosionRadius) {
            const falloff = 1 - position.distanceTo(player.camera.position)
                / FEATURES.barrels.explosionRadius;
            player.damage(FEATURES.barrels.playerDamage * falloff);
        }
        const killed = enemyManager.damageInRadius(
            position,
            FEATURES.barrels.explosionRadius,
            FEATURES.barrels.damage,
            "barrel",
        );
        if (killed > 0) player.addScore(killed * FEATURES.barrels.bonusScore);
        this.barrels.forEach((other) => {
            if (!other.exploded && other.group.position.distanceTo(position) <= FEATURES.barrels.chainRadius) {
                const timer = window.setTimeout(() => {
                    this.chainTimers.delete(timer);
                    this._explode(other, player, enemyManager);
                }, 120);
                this.chainTimers.add(timer);
            }
        });
        this._createExplosion(position);
    }

    _createExplosion(position) {
        const light = new THREE.PointLight(0xff5a24, 22, 13, 2);
        light.position.copy(position);
        this.scene.add(light);
        const count = this.quality === "high"
            ? VISUALS.particles.explosionHigh
            : VISUALS.particles.explosionLow;
        this.effects.push(createParticleBurst(this.scene, {
            position,
            color: 0xff7a2f,
            count,
            speed: 10,
            life: 0.9,
            size: 0.24,
            gravity: 2,
        }));
        this.effects.push(createShockwave(this.scene, position));

        const fireGroup = new THREE.Group();
        const smokeCount = this.quality === "high"
            ? VISUALS.particles.smokeHigh
            : VISUALS.particles.smokeLow;
        const pieces = [];
        for (let index = 0; index < smokeCount; index += 1) {
            const smoke = index < Math.ceil(smokeCount * 0.35)
                ? createGlowSprite(index % 2 ? 0xffbf43 : 0xff4b1f, 0.8 + Math.random(), 0.8)
                : createSmokeSprite(0.7 + Math.random() * 0.8, 0.5);
            smoke.position.copy(position);
            smoke.position.add(new THREE.Vector3(
                (Math.random() - 0.5) * 1.1,
                Math.random() * 0.8,
                (Math.random() - 0.5) * 1.1,
            ));
            fireGroup.add(smoke);
            pieces.push({
                sprite: smoke,
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.8,
                    1.1 + Math.random() * 2.2,
                    (Math.random() - 0.5) * 0.8,
                ),
            });
        }
        this.scene.add(fireGroup);
        this.effects.push({
            object: fireGroup,
            pieces,
            light,
            life: 1.4,
            update(delta) {
                this.life -= delta;
                this.light.intensity = Math.max(0, this.life * 17);
                this.pieces.forEach(({ sprite, velocity }, index) => {
                    sprite.position.addScaledVector(velocity, delta);
                    sprite.scale.addScalar(delta * (index % 3 ? 0.6 : 1.3));
                    sprite.material.opacity = Math.max(0, this.life / 1.4 * (index % 3 ? 0.5 : 0.8));
                });
                return this.life > 0;
            },
            dispose() {
                disposeObject3D(this.object);
                this.light.removeFromParent();
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

    getState() {
        return this.barrels.map((barrel) => ({
            position: { x: barrel.group.position.x, z: barrel.group.position.z },
            exploded: barrel.exploded,
        }));
    }

    dispose() {
        this.disposed = true;
        this.chainTimers.forEach((timer) => window.clearTimeout(timer));
        this.chainTimers.clear();
        this.barrels.forEach((barrel) => {
            if (!barrel.exploded) disposeObject3D(barrel.group);
            const index = this.world.colliders.indexOf(barrel.collider);
            if (index >= 0) this.world.colliders.splice(index, 1);
        });
        this.effects.forEach((effect) => effect.dispose());
        this.effects = [];
    }
}
