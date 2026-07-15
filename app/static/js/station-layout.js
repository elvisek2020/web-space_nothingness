/**
 * Single source of truth for station geometry and navigation.
 * LevelBuilder, floor-walk, spawns and boss anchors all consume this graph.
 */

import { GAME_CONFIG, STATION_DEFAULTS } from "./config.js";

const OPENING_WIDTH_RATIO = 0.72;
const OPENING_HEIGHT_RATIO = 0.78;
const HULL_OFFSET = 2.5;

function pointAt(angle, radius) {
    return {
        x: Math.sin(angle) * radius,
        z: Math.cos(angle) * radius,
    };
}

function dist2(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
}

/**
 * @param {object} levelLayout - config.layout from LEVEL_CONFIGS
 * @returns {object} station layout graph
 */
export function buildStationLayout(levelLayout = {}) {
    const params = { ...STATION_DEFAULTS, ...levelLayout };
    const modulesSpec = levelLayout.modules || [];
    const {
        ringRadius,
        corridorWidth,
        ringSegments,
        tunnelLength,
        tunnelWidth,
        moduleLength,
        moduleRadius,
        partitionDepth,
    } = params;

    const inner = ringRadius - corridorWidth / 2;
    const outer = ringRadius + corridorWidth / 2;
    const thetaStep = (Math.PI * 2) / ringSegments;
    const arcLen = (Math.PI * 2 * ringRadius) / ringSegments;
    const openingWidth = tunnelWidth * OPENING_WIDTH_RATIO;
    const openingHeight = MIN_CEILING_SAFE() * OPENING_HEIGHT_RATIO;

    const segments = [];
    for (let index = 0; index < ringSegments; index += 1) {
        const thetaStart = index * thetaStep;
        const midAngle = thetaStart + thetaStep / 2;
        const mid = pointAt(midAngle, ringRadius);
        segments.push({
            id: `ring-seg-${index}`,
            index,
            thetaStart,
            thetaLength: thetaStep,
            midAngle,
            midX: mid.x,
            midZ: mid.z,
            arcLen,
            hasWindow: index % 3 === 1,
        });
    }

    const tunnels = [];
    const modules = [];
    modulesSpec.forEach((spec, index) => {
        const angle = spec.angle ?? 0;
        const startR = ringRadius + corridorWidth / 2 - 0.5;
        const endR = startR + tunnelLength;
        const midR = (startR + endR) / 2;
        const tunnelMid = pointAt(angle, midR);
        const portalR = startR + partitionDepth;
        const portal = pointAt(angle, portalR);
        const centerR = ringRadius + tunnelLength + moduleLength / 2 + 1;
        const center = pointAt(angle, centerR);
        const isBoss = Boolean(levelLayout.bossArena) && index === modulesSpec.length - 1;

        const tunnel = {
            id: `tunnel-${index}`,
            moduleId: `module-${index}`,
            angle,
            startR,
            endR,
            midR,
            width: tunnelWidth,
            length: tunnelLength,
            cx: tunnelMid.x,
            cz: tunnelMid.z,
            opening: {
                x: portal.x,
                z: portal.z,
                yaw: angle,
                width: openingWidth,
                height: openingHeight,
                depth: 0.55,
                radius: portalR,
            },
        };
        tunnels.push(tunnel);

        modules.push({
            id: `module-${index}`,
            type: spec.type || "cargo",
            angle,
            center: { x: center.x, y: GAME_CONFIG.player.height, z: center.z },
            centerR,
            length: moduleLength,
            radius: moduleRadius,
            portal: tunnel.opening,
            tunnelId: tunnel.id,
            isBoss,
        });
    });

    const startAngle = (modulesSpec[0]?.angle ?? 0) + Math.PI;
    const startR = ringRadius - corridorWidth * 0.15;
    const playerStart = {
        x: Math.sin(startAngle) * startR,
        y: GAME_CONFIG.player.height,
        z: Math.cos(startAngle) * startR,
    };

    const navNodes = [];
    const pushNode = (id, kind, x, z, meta = {}) => {
        navNodes.push({ id, kind, x, z, ...meta });
    };

    segments.forEach((seg) => {
        pushNode(`nav-ring-${seg.index}`, "ring", seg.midX, seg.midZ, { segmentId: seg.id });
    });
    pushNode("nav-start", "start", playerStart.x, playerStart.z);

    tunnels.forEach((tunnel) => {
        pushNode(`nav-${tunnel.id}-mid`, "tunnel", tunnel.cx, tunnel.cz, {
            tunnelId: tunnel.id,
            moduleId: tunnel.moduleId,
        });
        pushNode(
            `nav-${tunnel.id}-portal`,
            "portal",
            tunnel.opening.x,
            tunnel.opening.z,
            { tunnelId: tunnel.id, moduleId: tunnel.moduleId },
        );
    });

    modules.forEach((mod) => {
        pushNode(`nav-${mod.id}`, "module", mod.center.x, mod.center.z, {
            moduleId: mod.id,
            isBoss: mod.isBoss,
        });
    });

    const navEdges = [];
    const link = (a, b) => {
        navEdges.push([a, b]);
        navEdges.push([b, a]);
    };

    for (let index = 0; index < segments.length; index += 1) {
        link(`nav-ring-${index}`, `nav-ring-${(index + 1) % segments.length}`);
    }
    link("nav-start", nearestRingNodeId(navNodes, playerStart));

    tunnels.forEach((tunnel) => {
        const ringNode = nearestRingNodeId(navNodes, { x: tunnel.cx, z: tunnel.cz });
        link(ringNode, `nav-${tunnel.id}-mid`);
        link(`nav-${tunnel.id}-mid`, `nav-${tunnel.id}-portal`);
        link(`nav-${tunnel.id}-portal`, `nav-${tunnel.moduleId}`);
    });

    const bossModule = modules.find((mod) => mod.isBoss) || null;
    const bossAnchor = bossModule
        ? { x: bossModule.center.x, y: 0, z: bossModule.center.z, moduleId: bossModule.id }
        : null;

    const graph = {
        params,
        ring: {
            radius: ringRadius,
            inner,
            outer,
            corridorWidth,
            segments,
            thetaStep,
            arcLen,
            hullRadius: outer + HULL_OFFSET,
        },
        tunnels,
        modules,
        playerStart,
        navNodes,
        navEdges,
        bossAnchor,
        hasBossArena: Boolean(levelLayout.bossArena),
        openingWidth,
        openingHeight,
        hullOffset: HULL_OFFSET,
    };

    graph.validate = () => validateStationLayout(graph);
    graph.reachableFrom = (nodeId) => bfsReachable(graph, nodeId);
    graph.nearestNavNode = (x, z, filter = null) => nearestNavNode(graph, x, z, filter);
    return Object.freeze(graph);
}

function MIN_CEILING_SAFE() {
    // Avoid circular import of MIN_CEILING; keep in sync with config (6.5).
    return 6.5;
}

function nearestRingNodeId(navNodes, point) {
    let best = null;
    let bestDist = Infinity;
    navNodes.forEach((node) => {
        if (node.kind !== "ring") return;
        const d = dist2(node, point);
        if (d < bestDist) {
            bestDist = d;
            best = node.id;
        }
    });
    return best || "nav-ring-0";
}

export function nearestNavNode(graph, x, z, filter = null) {
    let best = null;
    let bestDist = Infinity;
    graph.navNodes.forEach((node) => {
        if (filter && !filter(node)) return;
        const d = dist2(node, { x, z });
        if (d < bestDist) {
            bestDist = d;
            best = node;
        }
    });
    return best;
}

export function bfsReachable(graph, startId) {
    const adj = new Map();
    graph.navEdges.forEach(([a, b]) => {
        if (!adj.has(a)) adj.set(a, []);
        adj.get(a).push(b);
    });
    const seen = new Set([startId]);
    const queue = [startId];
    while (queue.length) {
        const current = queue.shift();
        (adj.get(current) || []).forEach((next) => {
            if (seen.has(next)) return;
            seen.add(next);
            queue.push(next);
        });
    }
    return seen;
}

export function validateStationLayout(graph) {
    const errors = [];
    if (!graph.ring.segments.length) errors.push("ring has no segments");
    if (graph.ring.outer <= graph.ring.inner) errors.push("invalid ring radii");
    if (graph.ring.arcLen <= 0) errors.push("non-positive arc length");

    graph.modules.forEach((mod) => {
        if (!mod.portal || mod.portal.width <= 0 || mod.portal.height <= 0) {
            errors.push(`module ${mod.id} missing valid portal opening`);
        }
        if (mod.length <= 0 || mod.radius <= 0) {
            errors.push(`module ${mod.id} has non-positive size`);
        }
    });

    graph.tunnels.forEach((tunnel) => {
        if (tunnel.length <= 0 || tunnel.width <= 0) {
            errors.push(`tunnel ${tunnel.id} has non-positive size`);
        }
        if (tunnel.opening.width <= 0) {
            errors.push(`tunnel ${tunnel.id} opening width invalid`);
        }
    });

    const reachable = bfsReachable(graph, "nav-start");
    graph.modules.forEach((mod) => {
        if (!reachable.has(`nav-${mod.id}`)) {
            errors.push(`module ${mod.id} not reachable from player start`);
        }
    });

    if (graph.hasBossArena && !graph.bossAnchor) {
        errors.push("bossArena requested but no bossAnchor module");
    }
    if (graph.bossAnchor) {
        const bossNode = `nav-${graph.bossAnchor.moduleId}`;
        if (!reachable.has(bossNode)) {
            errors.push("bossAnchor not reachable from player start");
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        reachableCount: reachable.size,
        moduleCount: graph.modules.length,
    };
}

export function isInsideModuleBounds(x, z, mod) {
    const dx = x - mod.center.x;
    const dz = z - mod.center.z;
    const cos = Math.cos(mod.angle);
    const sin = Math.sin(mod.angle);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    return Math.abs(localX) <= mod.radius + 0.2 && Math.abs(localZ) <= mod.length / 2 + 0.4;
}

export { HULL_OFFSET, OPENING_WIDTH_RATIO, OPENING_HEIGHT_RATIO };
