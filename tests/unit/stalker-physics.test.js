import { describe, expect, it } from "vitest";
import {
    calculateBallisticVelocity,
    positionOnBallisticArc,
    STALKER_STATES,
} from "../../app/static/js/stalker-physics.js";

describe("ceiling stalker ballistics", () => {
    it("lands on the requested target at the configured time", () => {
        const start = { x: -3, y: 4.45, z: 6 };
        const target = { x: 8, y: 0.59, z: -5 };
        const duration = 0.65;
        const gravity = 18;
        const velocity = calculateBallisticVelocity(
            start,
            target,
            duration,
            gravity,
        );
        const landing = positionOnBallisticArc(
            start,
            velocity,
            duration,
            gravity,
        );

        expect(landing.x).toBeCloseTo(target.x, 8);
        expect(landing.y).toBeCloseTo(target.y, 8);
        expect(landing.z).toBeCloseTo(target.z, 8);
        expect(positionOnBallisticArc(start, velocity, duration / 2, gravity).y)
            .toBeLessThanOrEqual(start.y);
    });

    it("exports the complete state cycle and rejects invalid duration", () => {
        expect(Object.values(STALKER_STATES)).toEqual([
            "patrol",
            "warning",
            "jump",
            "ground",
            "return",
        ]);
        expect(() => calculateBallisticVelocity({}, {}, 0, 18)).toThrow(RangeError);
    });
});
