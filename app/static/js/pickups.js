import * as THREE from "three";
import { FEATURES, GAME_CONFIG, VISUALS, WEAPONS } from "./config.js";
import { createGlowSprite, disposeObject3D, getVisuals } from "./visual-utils.js";

export class PickupManager {
    constructor(scene, world, levelConfig, quality = "high", callbacks = {}, random = Math.random) {
        this.scene = scene;
        this.quality = quality;
        this.callbacks = callbacks;
        this.random = random;
        this.pickups = world.pickupPoints.map((position) => this._create(position, "health"));
        if (world.weaponPoint && levelConfig.weaponPickup) {
            this.pickups.push(this._create(world.weaponPoint, "weapon", levelConfig.weaponPickup));
        }
        world.ammoPoints.forEach(({ position, type }) => {
            this.pickups.push(this._create(position, "ammo", type));
        });
        if (world.oxygenPickupPoint) {
            this.pickups.push(this._create(world.oxygenPickupPoint, "oxygen"));
        }
        if (world.turretKitPoint) {
            this.pickups.push(this._create(world.turretKitPoint, "turret"));
        }
    }

    _create(position, kind, subtype = null) {
        const group = new THREE.Group();
        const colors = {
            health: 0x43ff81,
            weapon: subtype === "shotgun" ? 0xffb84d : 0xff5a28,
            ammo: subtype === "shotgun" ? 0xffca62 : 0xff6a2d,
            oxygen: 0x42aaff,
            turret: 0xffe15a,
        };
        const color = colors[kind];
        const caseMaps = getVisuals().textures.getMaps(
            kind === "ammo" ? "hazard" : "crate",
            1,
            1,
        );
        const caseMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            roughness: 0.36,
            metalness: 0.62,
            clearcoat: 0.32,
            ...caseMaps,
            emissive: 0x0e3f32,
            emissiveIntensity: 0.28,
        });
        const crossMaterial = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: VISUALS.emissive.stripIntensity,
            metalness: 0.5,
            roughness: 0.22,
        });
        if (kind === "weapon") {
            const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.25, 0.35), caseMaterial);
            group.add(body);
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 8), crossMaterial);
            barrel.rotation.z = Math.PI / 2;
            barrel.position.x = 0.65;
            group.add(barrel);
        } else if (kind === "oxygen") {
            group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), crossMaterial));
        } else if (kind === "turret") {
            group.add(new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 4), caseMaterial));
            const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.25), crossMaterial);
            top.position.y = 0.5;
            group.add(top);
        } else {
            group.add(new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.68, 0.75), caseMaterial));
            const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.48, 0.78), crossMaterial);
            vertical.position.z = 0.02;
            group.add(vertical);
            const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.18, 0.78), crossMaterial);
            horizontal.position.z = 0.02;
            group.add(horizontal);
        }
        if (this.quality === "high") {
            const light = new THREE.PointLight(color, 3.5, 5, 2);
            light.position.y = 0.5;
            group.add(light);
        }
        const glow = createGlowSprite(color, kind === "weapon" ? 1.8 : 1.25, 0.32);
        glow.position.y = 0.25;
        group.add(glow);
        group.position.copy(position);
        group.userData.phase = this.random() * Math.PI * 2;
        this.scene.add(group);
        return { group, kind, subtype, collected: false };
    }

    update(delta, elapsed, player) {
        this.pickups.forEach((pickup) => {
            if (pickup.collected) return;
            pickup.group.rotation.y += delta * 0.8;
            pickup.group.position.y = 0.72 + Math.sin(elapsed * 2.4 + pickup.group.userData.phase) * 0.12;
            const scale = 1 + Math.sin(elapsed * 3 + pickup.group.userData.phase) * 0.035;
            pickup.group.scale.setScalar(scale);
            if (pickup.group.position.distanceTo(player.camera.position) < GAME_CONFIG.pickup.radius
                && this._collect(pickup, player)) {
                pickup.collected = true;
                disposeObject3D(pickup.group);
            }
        });
    }

    _collect(pickup, player) {
        let collected = false;
        if (pickup.kind === "health") collected = player.heal(GAME_CONFIG.pickup.heal);
        if (pickup.kind === "weapon") collected = player.unlockWeapon(pickup.subtype);
        if (pickup.kind === "ammo") collected = player.addAmmo(
            pickup.subtype,
            WEAPONS[pickup.subtype].ammoPickup,
        );
        if (pickup.kind === "oxygen") {
            this.callbacks.onOxygenPickup?.(FEATURES.oxygen.pickupAmount);
            collected = true;
        }
        if (pickup.kind === "turret") {
            this.callbacks.onTurretKit?.();
            collected = true;
        }
        if (collected && pickup.kind !== "health") {
            player.audio?.pickup();
        }
        if (collected) {
            this.callbacks.onCollected?.(pickup.kind, pickup.subtype);
        }
        return collected;
    }

    getRadarEntities() {
        return this.pickups
            .filter((pickup) => !pickup.collected)
            .map((pickup) => ({ position: pickup.group.position }));
    }

    dispose() {
        this.pickups.forEach((pickup) => {
            if (!pickup.collected) disposeObject3D(pickup.group);
        });
        this.pickups = [];
    }
}
