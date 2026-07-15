import { describe, expect, it } from "vitest";
import {
    circleIntersectsAabb,
    circleIntersectsObb,
    clampToBounds,
    createCollider,
    moveWithSubsteps,
    resolveAxisSeparatedMove,
    worldAabbFromObb,
} from "../../app/static/js/collision.js";

const wall = { minX: 1, maxX: 1.25, minZ: -2, maxZ: 2 };
const bounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };

describe("circle/AABB collision", () => {
    it("detects overlap and leaves separated circles free", () => {
        expect(circleIntersectsAabb(1.1, 0, 0.4, wall)).toBe(true);
        expect(circleIntersectsAabb(0, 0, 0.4, wall)).toBe(false);
    });

    it("clamps a position by radius", () => {
        expect(clampToBounds({ x: 9, z: -9 }, 0.5, bounds)).toEqual({ x: 4.5, z: -4.5 });
    });

    it("slides along a wall when one axis is blocked", () => {
        const result = resolveAxisSeparatedMove(
            { x: 0.5, z: 0 },
            { x: 0.4, z: 1 },
            0.25,
            [wall],
            bounds,
        );
        expect(result.x).toBe(0.5);
        expect(result.z).toBe(1);
    });

    it("prevents tunneling through a thin wall", () => {
        const result = moveWithSubsteps(
            { x: 0, z: 0 },
            { x: 3, z: 0 },
            0.25,
            [wall],
            bounds,
            0.1,
        );
        expect(result.x).toBeLessThan(1);
    });
});

describe("OBB collision", () => {
    it("rotated thin wall does not block corridor center via inflated AABB", () => {
        // Tangential wall on diagonal — world AABB hull is large, OBB stays thin.
        const wall45 = createCollider({
            id: "ring-outer",
            type: "ring-outer",
            cx: 16,
            cz: 16,
            halfW: 0.28,
            halfD: 4.5,
            yaw: Math.PI / 4,
        });
        const hull = worldAabbFromObb(16, 16, 0.28, 4.5, Math.PI / 4);
        expect(hull.maxX - hull.minX).toBeGreaterThan(5);
        // Point inward along the diagonal: free in OBB, inside inflated AABB hull.
        expect(circleIntersectsObb(11, 11, 0.4, wall45)).toBe(false);
        expect(circleIntersectsAabb(13.5, 13.5, 0.4, hull)).toBe(true);
    });

    it("detects contact against the local face of a yawed box", () => {
        const box = createCollider({
            id: "tunnel-wall",
            type: "tunnel-wall",
            cx: 0,
            cz: 10,
            halfW: 0.3,
            halfD: 3,
            yaw: Math.PI / 2,
        });
        // yaw=π/2: local Z aligns with world ±X, local X with world ∓Z.
        expect(circleIntersectsObb(0, 10, 0.35, box)).toBe(true);
        expect(circleIntersectsObb(0, 14, 0.35, box)).toBe(false);
        expect(circleIntersectsObb(2.5, 10, 0.35, box)).toBe(true);
    });
});
