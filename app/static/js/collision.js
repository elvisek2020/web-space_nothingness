export function circleIntersectsAabb(x, z, radius, box) {
    const closestX = Math.max(box.minX, Math.min(x, box.maxX));
    const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
    const dx = x - closestX;
    const dz = z - closestZ;
    return dx * dx + dz * dz < radius * radius;
}

export function isInsideAnyCollider(position, radius, colliders) {
    return colliders.some((box) => circleIntersectsAabb(position.x, position.z, radius, box));
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
