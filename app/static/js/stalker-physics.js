export const STALKER_STATES = Object.freeze({
    PATROL: "patrol",
    WARNING: "warning",
    JUMP: "jump",
    GROUND: "ground",
    RETURN: "return",
});

export function calculateBallisticVelocity(start, target, duration, gravity) {
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new RangeError("Ballistic duration must be positive.");
    }
    return {
        x: (target.x - start.x) / duration,
        y: (target.y - start.y + 0.5 * gravity * duration * duration) / duration,
        z: (target.z - start.z) / duration,
    };
}

export function positionOnBallisticArc(start, velocity, elapsed, gravity) {
    const time = Math.max(0, elapsed);
    return {
        x: start.x + velocity.x * time,
        y: start.y + velocity.y * time - 0.5 * gravity * time * time,
        z: start.z + velocity.z * time,
    };
}
