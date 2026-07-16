/**
 * Collider shape (XZ plane):
 * - Optional yaw (radians around Y). yaw === 0 → classic AABB via min/max.
 * - halfW / halfD local half-extents; if omitted, derived from min/max.
 * - minX/maxX/minZ/maxZ always store a world AABB hull (broadphase / debug).
 */

export function colliderCenter(box) {
    return {
        x: box.cx ?? (box.minX + box.maxX) / 2,
        z: box.cz ?? (box.minZ + box.maxZ) / 2,
    };
}

export function colliderHalfExtents(box) {
    if (box.halfW != null && box.halfD != null) {
        return { halfW: box.halfW, halfD: box.halfD };
    }
    return {
        halfW: (box.maxX - box.minX) / 2,
        halfD: (box.maxZ - box.minZ) / 2,
    };
}

/** World AABB hull covering a yawed OBB (for spatial grids). */
export function worldAabbFromObb(cx, cz, halfW, halfD, yaw = 0) {
    const cos = Math.abs(Math.cos(yaw));
    const sin = Math.abs(Math.sin(yaw));
    const extentX = halfW * cos + halfD * sin;
    const extentZ = halfW * sin + halfD * cos;
    return {
        minX: cx - extentX,
        maxX: cx + extentX,
        minZ: cz - extentZ,
        maxZ: cz + extentZ,
    };
}

export function createCollider(fields) {
    const yaw = fields.yaw ?? 0;
    const cx = fields.cx ?? (fields.minX + fields.maxX) / 2;
    const cz = fields.cz ?? (fields.minZ + fields.maxZ) / 2;
    const halfW = fields.halfW ?? (fields.maxX - fields.minX) / 2;
    const halfD = fields.halfD ?? (fields.maxZ - fields.minZ) / 2;
    const hull = worldAabbFromObb(cx, cz, halfW, halfD, yaw);
    return {
        id: fields.id,
        type: fields.type,
        yaw,
        cx,
        cz,
        halfW,
        halfD,
        minX: hull.minX,
        maxX: hull.maxX,
        minZ: hull.minZ,
        maxZ: hull.maxZ,
    };
}

export function circleIntersectsAabb(x, z, radius, box) {
    const closestX = Math.max(box.minX, Math.min(x, box.maxX));
    const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
    const dx = x - closestX;
    const dz = z - closestZ;
    return dx * dx + dz * dz < radius * radius;
}

/** Circle vs oriented box (yaw around Y). Falls back to AABB when yaw ≈ 0. */
export function circleIntersectsObb(x, z, radius, box) {
    const yaw = box.yaw ?? 0;
    if (!yaw) return circleIntersectsAabb(x, z, radius, box);

    const { x: cx, z: cz } = colliderCenter(box);
    const { halfW, halfD } = colliderHalfExtents(box);
    const dx = x - cx;
    const dz = z - cz;
    // Inverse of Three.js Ry(yaw): local X/Z match mesh.rotation.y.
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const closestX = Math.max(-halfW, Math.min(localX, halfW));
    const closestZ = Math.max(-halfD, Math.min(localZ, halfD));
    const ox = localX - closestX;
    const oz = localZ - closestZ;
    return ox * ox + oz * oz < radius * radius;
}

export function circleIntersectsCollider(x, z, radius, box) {
    return circleIntersectsObb(x, z, radius, box);
}

export function isInsideAnyCollider(position, radius, colliders) {
    return colliders.some((box) => circleIntersectsObb(position.x, position.z, radius, box));
}

/** Hull shell is a void-escape safety net — exclude from normal walk/spawn collision. */
export function gameplayColliders(colliders) {
    return colliders.filter((box) => box.type !== "hull-shell");
}

export function clampToBounds(position, radius, bounds) {
    if (!bounds) return { x: position.x, z: position.z };
    return {
        x: Math.max(bounds.minX + radius, Math.min(position.x, bounds.maxX - radius)),
        z: Math.max(bounds.minZ + radius, Math.min(position.z, bounds.maxZ - radius)),
    };
}

export function resolveAxisSeparatedMove(position, delta, radius, colliders, bounds) {
    const result = { x: position.x, z: position.z };
    const nextX = { x: result.x + delta.x, z: result.z };
    if (!isInsideAnyCollider(nextX, radius, colliders)) result.x = nextX.x;
    const nextZ = { x: result.x, z: result.z + delta.z };
    if (!isInsideAnyCollider(nextZ, radius, colliders)) result.z = nextZ.z;
    return clampToBounds(result, radius, bounds);
}

export function moveWithSubsteps(
    position,
    delta,
    radius,
    colliders,
    bounds,
    maxStep = 0.12,
) {
    const distance = Math.hypot(delta.x, delta.z);
    const steps = Math.max(1, Math.ceil(distance / maxStep));
    const step = { x: delta.x / steps, z: delta.z / steps };
    let result = { x: position.x, z: position.z };
    for (let index = 0; index < steps; index += 1) {
        result = resolveAxisSeparatedMove(result, step, radius, colliders, bounds);
    }
    return result;
}

/** World → segment local (inverse of Three.js Ry(yaw) around transform origin). */
export function worldToLocal(wx, wz, transform) {
    const dx = wx - transform.x;
    const dz = wz - transform.z;
    const cos = Math.cos(transform.yaw);
    const sin = Math.sin(transform.yaw);
    return {
        x: dx * cos - dz * sin,
        z: dx * sin + dz * cos,
    };
}

export function localToWorld(lx, lz, transform) {
    const cos = Math.cos(transform.yaw);
    const sin = Math.sin(transform.yaw);
    return {
        x: transform.x + lx * cos + lz * sin,
        z: transform.z - lx * sin + lz * cos,
    };
}

function isInsideLocalAabbs(lx, lz, radius, localColliders) {
    return localColliders.some((box) => circleIntersectsAabb(lx, lz, radius, box));
}

/**
 * v5 movement: test each segment's local AABB colliders after inverse transform.
 * Also tests flat world colliders (yaw≈0 props like barrels) if provided.
 */
export function isInsideSegmentParts(position, radius, segmentParts, worldColliders = []) {
    if (worldColliders.length && isInsideAnyCollider(position, radius, worldColliders)) {
        return true;
    }
    return (segmentParts || []).some((part) => {
        const local = worldToLocal(position.x, position.z, part.transform);
        return isInsideLocalAabbs(local.x, local.z, radius, part.localColliders);
    });
}

export function resolveAxisSeparatedMoveSegments(
    position,
    delta,
    radius,
    segmentParts,
    worldColliders,
    bounds,
) {
    const blocked = (pos) => isInsideSegmentParts(pos, radius, segmentParts, worldColliders);
    const result = { x: position.x, z: position.z };
    const nextX = { x: result.x + delta.x, z: result.z };
    if (!blocked(nextX)) result.x = nextX.x;
    const nextZ = { x: result.x, z: result.z + delta.z };
    if (!blocked(nextZ)) result.z = nextZ.z;
    return clampToBounds(result, radius, bounds);
}

export function moveWithSegmentSubsteps(
    position,
    delta,
    radius,
    segmentParts,
    worldColliders,
    bounds,
    maxStep = 0.12,
) {
    const distance = Math.hypot(delta.x, delta.z);
    const steps = Math.max(1, Math.ceil(distance / maxStep));
    const step = { x: delta.x / steps, z: delta.z / steps };
    let result = { x: position.x, z: position.z };
    for (let index = 0; index < steps; index += 1) {
        result = resolveAxisSeparatedMoveSegments(
            result,
            step,
            radius,
            segmentParts,
            worldColliders,
            bounds,
        );
    }
    return result;
}
