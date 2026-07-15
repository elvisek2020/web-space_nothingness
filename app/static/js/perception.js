import * as THREE from "three";
import { PERCEPTION } from "./config.js";
import { circleIntersectsObb } from "./collision.js";

const TWO_PI = Math.PI * 2;

export function buildColliderGrid(colliders, cellSize = 6) {
    const grid = new Map();
    colliders.forEach((box) => {
        const minCellX = Math.floor(box.minX / cellSize);
        const maxCellX = Math.floor(box.maxX / cellSize);
        const minCellZ = Math.floor(box.minZ / cellSize);
        const maxCellZ = Math.floor(box.maxZ / cellSize);
        for (let cx = minCellX; cx <= maxCellX; cx += 1) {
            for (let cz = minCellZ; cz <= maxCellZ; cz += 1) {
                const key = `${cx},${cz}`;
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(box);
            }
        }
    });
    return { grid, cellSize };
}

export function nearbyColliders(x, z, spatial, radius = 8) {
    if (!spatial?.grid) return spatial?.colliders || [];
    const { grid, cellSize } = spatial;
    const minCellX = Math.floor((x - radius) / cellSize);
    const maxCellX = Math.floor((x + radius) / cellSize);
    const minCellZ = Math.floor((z - radius) / cellSize);
    const maxCellZ = Math.floor((z + radius) / cellSize);
    const result = [];
    const seen = new Set();
    for (let cx = minCellX; cx <= maxCellX; cx += 1) {
        for (let cz = minCellZ; cz <= maxCellZ; cz += 1) {
            const items = grid.get(`${cx},${cz}`) || [];
            items.forEach((box) => {
                if (!seen.has(box.id)) {
                    seen.add(box.id);
                    result.push(box);
                }
            });
        }
    }
    return result;
}

function normalizeAngle(angle) {
    let value = angle;
    while (value > Math.PI) value -= TWO_PI;
    while (value < -Math.PI) value += TWO_PI;
    return value;
}

export function hasLineOfSight(from, to, colliders, spatial = null) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.05) return true;
    const steps = Math.max(1, Math.ceil(distance / PERCEPTION.rayStep));
    const stepX = dx / steps;
    const stepZ = dz / steps;
    const probeRadius = 0.2;
    for (let index = 1; index <= steps; index += 1) {
        const x = from.x + stepX * index;
        const z = from.z + stepZ * index;
        const localColliders = spatial
            ? nearbyColliders(x, z, spatial, 4)
            : colliders;
        if (localColliders.some((box) => circleIntersectsObb(x, z, probeRadius, box))) {
            return false;
        }
    }
    return true;
}

export function isWithinVisionCone(enemy, playerPosition, forwardYaw) {
    const definition = enemy.definition;
    const visionRange = definition.visionRange ?? definition.detectionRange ?? 20;
    const toPlayer = {
        x: playerPosition.x - enemy.group.position.x,
        z: playerPosition.z - enemy.group.position.z,
    };
    const distance = Math.hypot(toPlayer.x, toPlayer.z);
    if (distance > visionRange) return false;
    const angleToPlayer = Math.atan2(toPlayer.x, toPlayer.z);
    const enemyYaw = enemy.group.rotation.y;
    const delta = Math.abs(normalizeAngle(angleToPlayer - enemyYaw));
    const halfFov = THREE.MathUtils.degToRad((definition.visionAngleDeg ?? 110) / 2);
    return delta <= halfFov;
}

export function canEnemySeePlayer(enemy, player, colliders, spatial = null) {
    const playerPosition = player.camera.position;
    const definition = enemy.definition;
    const eyeY = definition.ceilingStalker
        ? definition.ceilingY
        : definition.radius * 0.72 + 0.4;
    const from = {
        x: enemy.group.position.x,
        z: enemy.group.position.z,
        y: eyeY,
    };
    const to = {
        x: playerPosition.x,
        z: playerPosition.z,
        y: playerPosition.y - 0.2,
    };
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const range = definition.visionRange ?? definition.detectionRange ?? 20;
    if (distance > range) return false;
    if (!definition.ceilingStalker && !isWithinVisionCone(enemy, playerPosition, enemy.group.rotation.y)) {
        return false;
    }
    return hasLineOfSight(from, to, colliders, spatial);
}

export function alertEnemiesBySound(origin, radius, enemies, playerPosition) {
    let alerted = 0;
    enemies.forEach((enemy) => {
        if (enemy.dead) return;
        const hearing = enemy.definition.hearingRange ?? 14;
        const effectiveRadius = Math.max(radius, hearing * 0.65);
        const distance = Math.hypot(
            enemy.group.position.x - origin.x,
            enemy.group.position.z - origin.z,
        );
        if (distance <= effectiveRadius) {
            enemy.alerted = true;
            enemy.alertTimer = PERCEPTION.soundAlertDuration;
            enemy.lastKnownPosition = playerPosition.clone();
            enemy.aiState = "investigate";
            alerted += 1;
        }
    });
    return alerted;
}
