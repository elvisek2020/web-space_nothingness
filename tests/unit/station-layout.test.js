import { describe, expect, it } from "vitest";
import { LEVEL_CONFIGS, STATION_DEFAULTS } from "../../app/static/js/config.js";
import {
    bfsReachable,
    buildStationLayout,
    isInsideModuleBounds,
    validateStationLayout,
} from "../../app/static/js/station-layout.js";

describe("station layout graph", () => {
    it("validates all nine level layouts with reachable modules", () => {
        LEVEL_CONFIGS.forEach((config) => {
            const graph = buildStationLayout(config.layout || {});
            const result = validateStationLayout(graph);
            expect(result.ok, `${config.name}: ${result.errors.join("; ")}`).toBe(true);
            expect(result.moduleCount).toBe((config.layout?.modules || []).length);
            const reachable = bfsReachable(graph, "nav-start");
            graph.modules.forEach((mod) => {
                expect(reachable.has(`nav-${mod.id}`)).toBe(true);
            });
            if (config.layout?.bossArena) {
                expect(graph.bossAnchor).toBeTruthy();
                expect(graph.bossAnchor.moduleId).toBe(graph.modules.at(-1).id);
                expect(Math.hypot(graph.bossAnchor.x, graph.bossAnchor.z)).toBeGreaterThan(
                    STATION_DEFAULTS.ringRadius,
                );
            }
        });
    });

    it("defines positive portal openings for every dock", () => {
        const graph = buildStationLayout({
            modules: [{ type: "lab", angle: 0 }, { type: "lab", angle: Math.PI }],
            bossArena: true,
        });
        graph.tunnels.forEach((tunnel) => {
            expect(tunnel.opening.width).toBeGreaterThan(1);
            expect(tunnel.opening.height).toBeGreaterThan(3);
        });
        expect(isInsideModuleBounds(
            graph.modules[0].center.x,
            graph.modules[0].center.z,
            graph.modules[0],
        )).toBe(true);
    });

    it("keeps player start on the ring opposite the first module", () => {
        const graph = buildStationLayout({
            modules: [{ type: "cargo", angle: 0 }],
        });
        const r = Math.hypot(graph.playerStart.x, graph.playerStart.z);
        expect(r).toBeCloseTo(
            STATION_DEFAULTS.ringRadius - STATION_DEFAULTS.corridorWidth * 0.15,
            5,
        );
        expect(graph.playerStart.z).toBeLessThan(0);
    });
});
