/**
 * v5 station layout — octagonal ring (8 AABB segments), docks, modules, nav graph.
 * Single source of truth for geometry, navigation, and boss anchors.
 */

import { GAME_CONFIG, MIN_CEILING, STATION_DEFAULTS } from "./config.js";

const OPENING_WIDTH_RATIO = 0.72;
const OPENING_HEIGHT_RATIO = 0.78;
const HULL_OFFSET = 2.5;
const RING_SEGMENTS = 8;

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

function snapAngleToOctant(angle) {
    const step = Math.PI / 4;
    return Math.round(angle / step) * step;
}

/**
 * @param {object} levelLayout - config.layout from LEVEL_CONFIGS
 */
export function buildStationLayout(levelLayout = {}) {
    const params = {
        ...STATION_DEFAULTS,
        ...levelLayout,
        ringSegments: RING_SEGMENTS,
    };
    const modulesSpec = levelLayout.modules || [];
    const {
        ringRadius,
        corridorWidth,
        tunnelLength,
        tunnelWidth,
        moduleLength,
        moduleRadius,
        partitionDepth,
    } = params;

    const thetaStep = (Math.PI * 2) / RING_SEGMENTS;
    // Chord length of regular octagon with apothem ringRadius.
    const segmentLength = 2 * ringRadius * Math.tan(Math.PI / RING_SEGMENTS);
    const openingWidth = tunnelWidth * OPENING_WIDTH_RATIO;
    const openingHeight = MIN_CEILING * OPENING_HEIGHT_RATIO;
    const inner = ringRadius - corridorWidth / 2;
    const outer = ringRadius + corridorWidth / 2;

    const dockAngles = new Set(
        modulesSpec.map((spec) => snapAngleToOctant(spec.angle ?? 0)),
    );

    const segments = [];
    for (let index = 0; index < RING_SEGMENTS; index += 1) {
        const midAngle = index * thetaStep;
        const mid = pointAt(midAngle, ringRadius);
        const docked = [...dockAngles].some((angle) => {
            let delta = Math.abs(angle - midAngle);
            if (delta > Math.PI) delta = Math.PI * 2 - delta;
            return delta < 0.01;
        });
        segments.push({
            id: `ring-seg-${index}`,
            kind: "ring",
            index,
            midAngle,
            yaw: midAngle,
            cx: mid.x,
            cz: mid.z,
            length: segmentLength,
            width: corridorWidth,
            openEnds: true,
            openOuter: docked,
            openingWidth: docked ? openingWidth : 0,
            hasWindow: index % 2 === 1 && !docked,
        });
    }

    const tunnels = [];
    const modules = [];
    modulesSpec.forEach((spec, index) => {
        const angle = snapAngleToOctant(spec.angle ?? 0);
        const startR = outer - 0.15;
        const endR = startR + tunnelLength;
        const midR = (startR + endR) / 2;
        const tunnelMid = pointAt(angle, midR);
        const portalR = startR + partitionDepth;
        const portal = pointAt(angle, portalR);
        const centerR = outer + tunnelLength + moduleLength / 2 + 0.5;
        const center = pointAt(angle, centerR);
        const isBoss = Boolean(levelLayout.bossArena) && index === modulesSpec.length - 1;

        const tunnel = {
            id: `tunnel-${index}`,
            kind: "tunnel",
            moduleId: `module-${index}`,
            angle,
            yaw: angle,
            cx: tunnelMid.x,
            cz: tunnelMid.z,
            length: tunnelLength,
            width: tunnelWidth,
            startR,
            endR,
            midR,
            openEnds: true,
            openOuter: false,
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
            kind: "module",
            type: spec.type || "cargo",
            angle,
            yaw: angle,
            cx: center.x,
            cz: center.z,
            center: { x: center.x, y: GAME_CONFIG.player.height, z: center.z },
            centerR,
            length: moduleLength,
            width: moduleRadius * 2,
            radius: moduleRadius,
            portal: tunnel.opening,
            tunnelId: tunnel.id,
            isBoss,
            openEnds: false,
            openOuter: false,
            // Entry face toward tunnel: open the "inner" end (local -Z toward ring)
            openInnerEnd: true,
        });
    });

    const startAngle = (modulesSpec[0] ? snapAngleToOctant(modulesSpec[0].angle ?? 0) : 0) + Math.PI;
    const startR = ringRadius - corridorWidth * 0.1;
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
        pushNode(`nav-ring-${seg.index}`, "ring", seg.cx, seg.cz, { segmentId: seg.id });
    });
    pushNode("nav-start", "start", playerStart.x, playerStart.z);

    tunnels.forEach((tunnel) => {
        pushNode(`nav-${tunnel.id}-mid`, "tunnel", tunnel.cx, tunnel.cz, {
            tunnelId: tunnel.id,
            moduleId: tunnel.moduleId,
        });
        pushNode(`nav-${tunnel.id}-portal`, "portal", tunnel.opening.x, tunnel.opening.z, {
            tunnelId: tunnel.id,
            moduleId: tunnel.moduleId,
        });
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

    for (let index = 0; index < RING_SEGMENTS; index += 1) {
        link(`nav-ring-${index}`, `nav-ring-${(index + 1) % RING_SEGMENTS}`);
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
        architecture: "v5-octagon-aabb",
        ring: {
            radius: ringRadius,
            inner,
            outer,
            corridorWidth,
            segments,
            thetaStep,
            segmentLength,
            hullRadius: outer + HULL_OFFSET,
            ringSegments: RING_SEGMENTS,
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
    if (graph.ring.segments.length !== 8) errors.push("v5 ring must have 8 segments");
    if (graph.ring.outer <= graph.ring.inner) errors.push("invalid ring radii");
    if (graph.ring.segmentLength <= 0) errors.push("non-positive segment length");

    graph.modules.forEach((mod) => {
        if (!mod.portal || mod.portal.width <= 0 || mod.portal.height <= 0) {
            errors.push(`module ${mod.id} missing valid portal opening`);
        }
        const step = Math.PI / 4;
        const snapped = Math.round(mod.angle / step) * step;
        if (Math.abs(mod.angle - snapped) > 1e-6) {
            errors.push(`module ${mod.id} angle not a multiple of π/4`);
        }
    });

    graph.tunnels.forEach((tunnel) => {
        if (tunnel.length <= 0 || tunnel.width <= 0) {
            errors.push(`tunnel ${tunnel.id} has non-positive size`);
        }
    });

    const startId = "nav-start";
    const reachable = bfsReachable(graph, startId);
    graph.modules.forEach((mod) => {
        if (!reachable.has(`nav-${mod.id}`)) {
            errors.push(`module ${mod.id} not reachable from player start`);
        }
    });

    if (graph.hasBossArena) {
        if (!graph.bossAnchor) errors.push("bossArena requested but no bossAnchor module");
        else if (!reachable.has(`nav-${graph.bossAnchor.moduleId}`)) {
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

export { HULL_OFFSET, OPENING_WIDTH_RATIO, OPENING_HEIGHT_RATIO, RING_SEGMENTS };
