/**
 * Analytical walkable footprint + wall integrity probes for the torus station.
 */

import { buildStationLayout } from "./station-layout.js";

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
    const graph = layout?.ring && layout?.modules && layout?.tunnels
        ? layout
        : buildStationLayout(layout || {});
    const { ring, tunnels, modules } = graph;
    const r = Math.hypot(x, z);
    if (r >= ring.inner - 0.05 && r <= ring.outer + 0.05) return true;

    for (const tunnel of tunnels) {
        if (pointInOrientedBox(
            x,
            z,
            tunnel.cx,
            tunnel.cz,
            (tunnel.width + 0.35) / 2,
            (tunnel.length + 1.1) / 2,
            tunnel.angle,
        )) return true;
    }

    for (const mod of modules) {
        if (pointInOrientedBox(
            x,
            z,
            mod.center.x,
            mod.center.z,
            (mod.radius * 2 + 0.4) / 2,
            (mod.length + 0.8) / 2,
            mod.angle,
        )) return true;
    }
    return false;
}

/** Dense sample of walkable XZ points for integrity / spawn tests. */
export function sampleWalkableGrid(layout, step = 0.75, margin = 0.35) {
    const graph = layout?.ring ? layout : buildStationLayout(layout || {});
    const { ring, params } = graph;
    const extent = ring.radius
        + params.corridorWidth / 2
        + params.tunnelLength
        + params.moduleLength
        + params.moduleRadius
        + 4;
    const points = [];
    for (let x = -extent; x <= extent; x += step) {
        for (let z = -extent; z <= extent; z += step) {
            if (!isOnWalkableFloor(x, z, graph)) continue;
            if (!isOnWalkableFloor(x + margin, z, graph)) continue;
            if (!isOnWalkableFloor(x - margin, z, graph)) continue;
            if (!isOnWalkableFloor(x, z + margin, graph)) continue;
            if (!isOnWalkableFloor(x, z - margin, graph)) continue;
            points.push({ x, z });
        }
    }
    return points;
}

export function findFloorHoles(layout, options = {}) {
    const step = options.step ?? 0.85;
    const graph = layout?.ring ? layout : buildStationLayout(layout || {});
    const samples = sampleWalkableGrid(graph, step, options.margin ?? 0.4);
    const holes = samples.filter((point) => !isOnWalkableFloor(point.x, point.z, graph));
    return { samples: samples.length, holes };
}

/**
 * Horizontal outward probes: from walkable points cast toward exterior.
 * Each probe must hit a ring/module/tunnel wall band before escaping past hull.
 */
export function findWallBreaches(layout, options = {}) {
    const graph = layout?.ring ? layout : buildStationLayout(layout || {});
    const step = options.step ?? 1.4;
    const samples = sampleWalkableGrid(graph, step, 0.45);
    const breaches = [];
    const hull = graph.ring.hullRadius;

    samples.forEach((point) => {
        const r = Math.hypot(point.x, point.z) || 1;
        // Outward radial direction from station center through the sample.
        const dirX = point.x / r;
        const dirZ = point.z / r;
        let escaped = true;
        for (let distance = 0.4; distance <= hull + 1; distance += 0.35) {
            const x = point.x + dirX * distance;
            const z = point.z + dirZ * distance;
            const rr = Math.hypot(x, z);
            // Crossing outer wall band (ring) or leaving a dock/module into sealed space.
            if (rr >= graph.ring.outer - 0.15 && rr <= graph.ring.outer + 0.9) {
                escaped = false;
                break;
            }
            // Still inside a tunnel/module footprint counts as contained.
            if (isOnWalkableFloor(x, z, graph) && rr < graph.ring.outer) {
                continue;
            }
            if (rr > hull) break;
        }
        if (escaped && Math.hypot(point.x, point.z) <= graph.ring.outer + 0.5) {
            // Only flag ring-corridor samples that can escape radially.
            if (Math.hypot(point.x, point.z) >= graph.ring.inner - 0.2
                && Math.hypot(point.x, point.z) <= graph.ring.outer + 0.2) {
                breaches.push(point);
            }
        }
    });

    return { samples: samples.length, breaches };
}
