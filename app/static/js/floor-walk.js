/**
 * Analytical walkable footprint for the torus station (no Three.js required).
 */

export function pointInOrientedBox(x, z, cx, cz, halfW, halfD, yaw) {
    const dx = x - cx;
    const dz = z - cz;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    return Math.abs(localX) <= halfW && Math.abs(localZ) <= halfD;
}

export function isOnWalkableFloor(x, z, layout) {
    const {
        ringRadius,
        corridorWidth,
        tunnelLength,
        tunnelWidth,
        moduleLength,
        moduleRadius,
        modules = [],
    } = layout;
    const r = Math.hypot(x, z);
    const inner = ringRadius - corridorWidth / 2;
    const outer = ringRadius + corridorWidth / 2;
    if (r >= inner - 0.05 && r <= outer + 0.05) return true;

    for (const moduleSpec of modules) {
        const angle = moduleSpec.angle ?? 0;
        const startR = ringRadius + corridorWidth / 2 - 0.5;
        const endR = startR + tunnelLength;
        const midR = (startR + endR) / 2;
        const tcx = Math.sin(angle) * midR;
        const tcz = Math.cos(angle) * midR;
        if (pointInOrientedBox(
            x,
            z,
            tcx,
            tcz,
            (tunnelWidth + 0.35) / 2,
            (tunnelLength + 1.1) / 2,
            angle,
        )) return true;

        const centerR = ringRadius + tunnelLength + moduleLength / 2 + 1;
        const mcx = Math.sin(angle) * centerR;
        const mcz = Math.cos(angle) * centerR;
        if (pointInOrientedBox(
            x,
            z,
            mcx,
            mcz,
            (moduleRadius * 2 + 0.4) / 2,
            (moduleLength + 0.8) / 2,
            angle,
        )) return true;
    }
    return false;
}

/** Dense sample of walkable XZ points for integrity / spawn tests. */
export function sampleWalkableGrid(layout, step = 0.75, margin = 0.35) {
    const {
        ringRadius,
        corridorWidth,
        tunnelLength,
        moduleLength,
        moduleRadius,
        modules = [],
    } = layout;
    const extent = ringRadius
        + corridorWidth / 2
        + tunnelLength
        + moduleLength
        + moduleRadius
        + 4;
    const points = [];
    for (let x = -extent; x <= extent; x += step) {
        for (let z = -extent; z <= extent; z += step) {
            if (!isOnWalkableFloor(x, z, layout)) continue;
            // Keep away from wall thickness so samples sit on real deck plates.
            if (!isOnWalkableFloor(x + margin, z, layout)) continue;
            if (!isOnWalkableFloor(x - margin, z, layout)) continue;
            if (!isOnWalkableFloor(x, z + margin, layout)) continue;
            if (!isOnWalkableFloor(x, z - margin, layout)) continue;
            points.push({ x, z });
        }
    }
    return points;
}

export function findFloorHoles(layout, options = {}) {
    const step = options.step ?? 0.85;
    const samples = sampleWalkableGrid(layout, step, options.margin ?? 0.4);
    const holes = samples.filter((point) => !isOnWalkableFloor(point.x, point.z, layout));
    return { samples: samples.length, holes };
}
