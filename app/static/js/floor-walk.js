/**
 * Analytical walkable footprint + integrity probes for v5 octagon station.
 */

import { buildStationLayout } from "./station-layout.js";
import { worldToLocal } from "./collision.js";

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

    for (const seg of graph.ring.segments) {
        const local = worldToLocal(x, z, { x: seg.cx, z: seg.cz, yaw: seg.yaw });
        if (
            Math.abs(local.x) <= seg.length / 2 + 0.12
            && Math.abs(local.z) <= seg.width / 2 + 0.12
        ) {
            return true;
        }
    }

    for (const tunnel of graph.tunnels) {
        if (pointInOrientedBox(
            x,
            z,
            tunnel.cx,
            tunnel.cz,
            tunnel.width / 2 + 0.2,
            tunnel.length / 2 + 0.35,
            tunnel.yaw,
        )) {
            return true;
        }
    }

    for (const mod of graph.modules) {
        if (pointInOrientedBox(
            x,
            z,
            mod.center.x,
            mod.center.z,
            mod.radius + 0.25,
            mod.length / 2 + 0.4,
            mod.angle,
        )) {
            return true;
        }
    }

    return false;
}

export function sampleWalkableGrid(graph, step, margin) {
    const samples = [];
    const extent = graph.ring.hullRadius + 8;
    for (let x = -extent; x <= extent; x += step) {
        for (let z = -extent; z <= extent; z += step) {
            if (isOnWalkableFloor(x, z, graph)) {
                samples.push({ x, z });
            }
        }
    }
    // Ensure we also sample nav nodes
    graph.navNodes.forEach((node) => {
        if (isOnWalkableFloor(node.x, node.z, graph)) {
            samples.push({ x: node.x, z: node.z });
        }
    });
    return samples;
}

export function findFloorHoles(layout, options = {}) {
    const graph = layout?.ring ? layout : buildStationLayout(layout || {});
    const step = options.step ?? 1.1;
    const margin = options.margin ?? 0.35;
    const samples = sampleWalkableGrid(graph, step, margin);
    const holes = [];
    // Analytical: any sample already on walkable is fine; holes = nav points not walkable
    graph.navNodes.forEach((node) => {
        if (node.kind === "start") return;
        if (!isOnWalkableFloor(node.x, node.z, graph)) {
            holes.push({ x: node.x, z: node.z, reason: "nav-not-walkable" });
        }
    });
    return { samples: samples.length, holes };
}

/**
 * From walkable ring points cast outward. Dock wedges are excluded (tunnel continues).
 * Non-dock samples must hit the outer wall band before the hull.
 */
export function findWallBreaches(layout, options = {}) {
    const graph = layout?.ring ? layout : buildStationLayout(layout || {});
    const step = options.step ?? 1.6;
    const samples = sampleWalkableGrid(graph, step, 0.45);
    const breaches = [];
    const hull = graph.ring.hullRadius;

    const nearDock = (point) => graph.tunnels.some((tunnel) => {
        let delta = Math.abs(Math.atan2(point.x, point.z) - tunnel.angle);
        if (delta > Math.PI) delta = Math.PI * 2 - delta;
        return delta < graph.ring.thetaStep * 0.55;
    });

    samples.forEach((point) => {
        const r0 = Math.hypot(point.x, point.z) || 1;
        if (r0 < graph.ring.inner - 0.3 || r0 > graph.ring.outer + 0.3) return;
        if (nearDock(point)) return;

        const dirX = point.x / r0;
        const dirZ = point.z / r0;
        let escaped = true;
        for (let distance = 0.4; distance <= hull + 1; distance += 0.35) {
            const x = point.x + dirX * distance;
            const z = point.z + dirZ * distance;
            const rr = Math.hypot(x, z);
            if (rr >= graph.ring.outer - 0.25 && rr <= graph.ring.outer + 1.1) {
                escaped = false;
                break;
            }
            if (rr > hull) break;
        }
        if (escaped) breaches.push(point);
    });

    return { samples: samples.length, breaches };
}
