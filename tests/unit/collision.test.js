import { describe, expect, it } from "vitest";
import {
    circleIntersectsAabb,
    clampToBounds,
    moveWithSubsteps,
    resolveAxisSeparatedMove,
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
