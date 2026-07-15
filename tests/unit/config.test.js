import { describe, expect, it } from "vitest";
import {
    ENEMY_TYPES,
    FEATURES,
    GAME_CONFIG,
    LEVEL_CONFIGS,
    LEVEL_COUNT,
    LIGHTING,
    MIN_CEILING,
    PERCEPTION,
    SPAWN_GRACE_SECONDS,
    SPAWN_SAFE_RADIUS,
    VISUALS,
    WEAPONS,
} from "../../app/static/js/config.js";

describe("game configuration", () => {
    it("defines nine station sectors with readable accents", () => {
        expect(LEVEL_CONFIGS).toHaveLength(LEVEL_COUNT);
        expect(LEVEL_COUNT).toBe(9);
        expect(LEVEL_CONFIGS[0].name).toContain("DOKOVACÍ");
        expect(LEVEL_CONFIGS[8].boss).toBe("queen");
        expect(MIN_CEILING).toBeGreaterThanOrEqual(6);
        expect(LIGHTING.brightness).toEqual({ min: 50, max: 150, default: 100 });
    });

    it.each(Object.entries(WEAPONS))("%s has valid weapon parameters", (name, weapon) => {
        expect(weapon.label).toBeTruthy();
        expect(weapon.damage).toBeGreaterThan(0);
        expect(weapon.cooldown).toBeGreaterThan(0);
        expect(weapon.projectileSpeed).toBeGreaterThan(0);
        expect(weapon.pellets).toBeGreaterThan(0);
        expect(weapon.soundRadius).toBeGreaterThan(0);
        if (name !== "pulse") expect(Number.isFinite(weapon.ammo)).toBe(true);
        if (name === "shotgun") expect(weapon.soundRadius).toBeGreaterThan(WEAPONS.flamethrower.soundRadius);
    });

    it.each(Object.entries(ENEMY_TYPES))("%s has complete combat config", (name, enemy) => {
        expect(enemy.label).toBeTruthy();
        expect(enemy.hp).toBeGreaterThan(0);
        expect(enemy.speed).toBeGreaterThan(0);
        expect(enemy.damage).toBeGreaterThan(0);
        expect(enemy.radius).toBeGreaterThan(0);
        expect(enemy.score).toBeGreaterThan(0);
        expect(enemy.visionRange || enemy.detectionRange).toBeGreaterThan(0);
    });

    it("defines deterministic pickup and feature progression", () => {
        expect(LEVEL_CONFIGS[1].weaponPickup).toBe("shotgun");
        expect(LEVEL_CONFIGS[3].weaponPickup).toBe("flamethrower");
        expect(LEVEL_CONFIGS[2].airlock).toBe(true);
        expect(LEVEL_CONFIGS[8].boss).toBe("queen");
        expect(FEATURES.barrels.countByLevel).toHaveLength(9);
        expect(FEATURES.survivors.countByLevel).toHaveLength(9);
        expect(FEATURES.selfDestruct.duration).toBe(60);
        expect(GAME_CONFIG.world.collisionSubstep).toBeLessThan(GAME_CONFIG.player.radius);
        expect(PERCEPTION.loseSightSeconds).toBeGreaterThan(0);
    });

    it("defines distinct render quality budgets", () => {
        expect(VISUALS.quality.high.ssao).toBe(true);
        expect(VISUALS.quality.low.ssao).toBe(false);
        expect(VISUALS.quality.high.pixelRatio).toBeLessThanOrEqual(2);
        expect(VISUALS.quality.high.textureSize)
            .toBeGreaterThan(VISUALS.quality.low.textureSize);
    });

    it("defines safe starts and ceiling stalkers instead of flyers", () => {
        expect(SPAWN_SAFE_RADIUS).toBe(15);
        expect(SPAWN_GRACE_SECONDS).toBe(3);
        expect(ENEMY_TYPES.flyer).toBeUndefined();
        expect(ENEMY_TYPES.CEILING_STALKER.ceilingStalker).toBe(true);
        expect(LEVEL_CONFIGS[1].enemies.CEILING_STALKER).toBeGreaterThan(0);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toContain("flyer");
    });
});
