import { describe, expect, it } from "vitest";
import { LEVEL_CONFIGS } from "../../app/static/js/config.js";
import {
    findFloorHoles,
    findWallBreaches,
    isOnWalkableFloor,
    sampleWalkableGrid,
} from "../../app/static/js/floor-walk.js";
import { buildStationLayout } from "../../app/static/js/station-layout.js";

describe("floor walkability", () => {
    it("marks ring corridor points walkable and hollow center not", () => {
        const layout = buildStationLayout({ modules: [{ angle: 0, type: "lab" }] });
        expect(isOnWalkableFloor(0, layout.ring.radius, layout)).toBe(true);
        expect(isOnWalkableFloor(0, 0, layout)).toBe(false);
    });

    it("finds dense walkable samples with zero analytical holes on all 9 layouts", () => {
        LEVEL_CONFIGS.forEach((config) => {
            const layout = buildStationLayout(config.layout || {});
            const result = findFloorHoles(layout, { step: 1.0, margin: 0.35 });
            expect(result.samples).toBeGreaterThan(80);
            expect(result.holes).toEqual([]);
        });
    });

    it("includes dock tunnels connected to modules", () => {
        const layout = buildStationLayout({
            modules: [{ angle: 0, type: "hangar" }],
        });
        const samples = sampleWalkableGrid(layout, 1.2, 0.2);
        const tunnelish = samples.filter((point) => {
            const r = Math.hypot(point.x, point.z);
            return r > layout.ring.radius + layout.params.corridorWidth / 2 + 1;
        });
        expect(tunnelish.length).toBeGreaterThan(5);
    });

    it("reports no radial wall breaches on ring samples for all levels", () => {
        LEVEL_CONFIGS.forEach((config) => {
            const layout = buildStationLayout(config.layout || {});
            const result = findWallBreaches(layout, { step: 1.6 });
            expect(result.breaches, config.name).toEqual([]);
        });
    });
});
