import { describe, expect, it } from "vitest";
import { LEVEL_CONFIGS } from "../../app/static/js/config.js";
import {
    buildStationLayout,
    isInsideModuleBounds,
    RING_SEGMENTS,
} from "../../app/static/js/station-layout.js";
import { findFloorHoles, findWallBreaches, isOnWalkableFloor } from "../../app/static/js/floor-walk.js";

describe("v5 station-layout octagon", () => {
    it("uses 8 ring segments and validates all nine levels", () => {
        LEVEL_CONFIGS.forEach((config) => {
            const graph = buildStationLayout(config.layout);
            expect(graph.ring.segments.length).toBe(RING_SEGMENTS);
            expect(graph.architecture).toBe("v5-octagon-aabb");
            const result = graph.validate();
            expect(result.ok, `${config.name}: ${result.errors.join("; ")}`).toBe(true);
            expect(result.moduleCount).toBe(config.layout.modules.length);
        });
    });

    it("snaps dock angles to π/4 multiples and keeps BFS reachability", () => {
        const graph = buildStationLayout({
            modules: [
                { type: "cargo", angle: 0 },
                { type: "cargo", angle: Math.PI },
            ],
            bossArena: true,
        });
        expect(graph.bossAnchor).toBeTruthy();
        expect(graph.reachableFrom("nav-start").has("nav-module-1")).toBe(true);
        expect(isInsideModuleBounds(
            graph.modules[1].center.x,
            graph.modules[1].center.z,
            graph.modules[1],
        )).toBe(true);
    });

    it("marks ring and modules walkable with no floor holes", () => {
        LEVEL_CONFIGS.forEach((config) => {
            const graph = buildStationLayout(config.layout);
            const mid = graph.ring.segments[0];
            expect(isOnWalkableFloor(mid.cx, mid.cz, graph)).toBe(true);
            expect(isOnWalkableFloor(0, 0, graph)).toBe(false);
            const floors = findFloorHoles(graph, { step: 1.2 });
            expect(floors.holes, config.name).toEqual([]);
            expect(floors.samples).toBeGreaterThan(40);
        });
    });

    it("reports no ring wall breaches on walkable samples", () => {
        LEVEL_CONFIGS.forEach((config) => {
            const graph = buildStationLayout(config.layout);
            const walls = findWallBreaches(graph, { step: 1.8 });
            expect(walls.breaches, config.name).toEqual([]);
        });
    });
});
