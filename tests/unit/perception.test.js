import { describe, expect, it } from "vitest";
import {
    alertEnemiesBySound,
    buildColliderGrid,
    canEnemySeePlayer,
    hasLineOfSight,
} from "../../app/static/js/perception.js";

describe("enemy perception", () => {
    const colliders = [
        { id: "wall", type: "wall", minX: -1, maxX: 1, minZ: -10, maxZ: 10 },
    ];
    const spatial = { ...buildColliderGrid(colliders), colliders };

    it("blocks line of sight behind a partition", () => {
        const visible = hasLineOfSight({ x: -5, z: 0 }, { x: 5, z: 0 }, colliders, spatial);
        expect(visible).toBe(false);
        const clear = hasLineOfSight({ x: -5, z: 0 }, { x: -5, z: 8 }, colliders, spatial);
        expect(clear).toBe(true);
    });

    it("alerts enemies within hearing radius after a shot", () => {
        const enemies = [{
            dead: false,
            definition: { hearingRange: 18 },
            group: { position: { x: 4, z: 0, clone: () => ({ x: 4, z: 0 }) } },
            alertTimer: 0,
            aiState: "patrol",
        }];
        const alerted = alertEnemiesBySound(
            { x: 0, z: 0 },
            20,
            enemies,
            { x: 0, y: 1.7, z: 0, clone() { return { x: 0, y: 1.7, z: 0 }; } },
        );
        expect(alerted).toBe(1);
        expect(enemies[0].aiState).toBe("investigate");
    });

    it("does not see the player through cover", () => {
        const enemy = {
            definition: {
                visionRange: 30,
                visionAngleDeg: 120,
                radius: 0.8,
            },
            group: {
                position: { x: -6, z: 0 },
                rotation: { y: 0 },
            },
        };
        const player = {
            camera: { position: { x: 6, y: 1.7, z: 0 } },
        };
        expect(canEnemySeePlayer(enemy, player, colliders, spatial)).toBe(false);
    });
});
