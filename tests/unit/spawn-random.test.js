import { describe, expect, it } from "vitest";
import { FIXED_TEST_SEED } from "../../app/static/js/config.js";
import { seededRandom } from "../../app/static/js/levels.js";

describe("random spawn placement", () => {
    it("uses deterministic seeded random for test mode seed", () => {
        const first = seededRandom(FIXED_TEST_SEED);
        const second = seededRandom(FIXED_TEST_SEED);
        const sequenceA = Array.from({ length: 8 }, () => first().toFixed(6));
        const sequenceB = Array.from({ length: 8 }, () => second().toFixed(6));
        expect(sequenceA).toEqual(sequenceB);
    });

    it("changes pseudo-random stream with different seeds", () => {
        const a = seededRandom(111);
        const b = seededRandom(222);
        const sequenceA = Array.from({ length: 8 }, () => a().toFixed(6));
        const sequenceB = Array.from({ length: 8 }, () => b().toFixed(6));
        expect(sequenceA.join("|")).not.toEqual(sequenceB.join("|"));
    });

    it("derives unique level seeds from fixed test base", () => {
        const seeds = Array.from({ length: 9 }, (_, index) => FIXED_TEST_SEED + index);
        expect(new Set(seeds).size).toBe(9);
    });
});
