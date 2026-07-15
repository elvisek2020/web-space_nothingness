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

export function clampBallisticY(y, floorY, ceilingY, radius = 0) {
    const minY = floorY + radius;
    const maxY = ceilingY - radius * 0.5;
    return Math.max(minY, Math.min(maxY, y));
}

export function limitArcPeak(startY, targetY, duration, gravity, ceilingY, margin = 0.6) {
    const midTime = duration / 2;
    const peak = startY + ((targetY - startY + 0.5 * gravity * duration * duration) / duration) * midTime
        - 0.5 * gravity * midTime * midTime;
    const maxPeak = ceilingY - margin;
    if (peak <= maxPeak) {
        return { duration, adjustedTargetY: targetY };
    }
    const adjustedTargetY = Math.min(targetY, maxPeak - 0.5);
    return { duration, adjustedTargetY };
}

export function bossGroundY(radius, floorY = 0) {
    return floorY + radius * 0.72;
}

export function clampBossJumpY(baseY, jumpPhase, amplitude, floorY, ceilingY, radius) {
    const raw = baseY + Math.sin(jumpPhase * Math.PI * 2) * amplitude;
    return clampBallisticY(raw, floorY, ceilingY, radius);
}
