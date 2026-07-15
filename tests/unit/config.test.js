import { describe, expect, it } from "vitest";
import {
    ENEMY_TYPES,
    FEATURES,
    GAME_CONFIG,
    LEVEL_CONFIGS,
    LIGHTING,
    SPAWN_GRACE_SECONDS,
    SPAWN_SAFE_RADIUS,
    VISUALS,
    WEAPONS,
} from "../../app/static/js/config.js";

describe("game configuration", () => {
    it("defines four readable level accents", () => {
        expect(LEVEL_CONFIGS).toHaveLength(4);
        expect(LEVEL_CONFIGS.map((level) => level.accent)).toEqual([
            0xff8736,
            0x56c7ff,
            0xffb13d,
            0xff4057,
        ]);
        expect(LIGHTING.brightness).toEqual({ min: 50, max: 150, default: 100 });
        expect(LIGHTING.fog.high.near).toBeGreaterThan(25);
    });

    it.each(Object.entries(WEAPONS))("%s has valid weapon parameters", (name, weapon) => {
        expect(weapon.label).toBeTruthy();
        expect(weapon.damage).toBeGreaterThan(0);
        expect(weapon.cooldown).toBeGreaterThan(0);
        expect(weapon.projectileSpeed).toBeGreaterThan(0);
        expect(weapon.pellets).toBeGreaterThan(0);
        if (name !== "pulse") expect(Number.isFinite(weapon.ammo)).toBe(true);
    });

    it.each(Object.entries(ENEMY_TYPES))("%s has complete combat config", (name, enemy) => {
        expect(enemy.label).toBeTruthy();
        expect(enemy.hp).toBeGreaterThan(0);
        expect(enemy.speed).toBeGreaterThan(0);
        expect(enemy.damage).toBeGreaterThan(0);
        expect(enemy.radius).toBeGreaterThan(0);
        expect(enemy.score).toBeGreaterThan(0);
        expect(name).not.toContain("undefined");
    });

    it("defines deterministic pickup and feature progression", () => {
        expect(LEVEL_CONFIGS[1].weaponPickup).toBe("shotgun");
        expect(LEVEL_CONFIGS[2].weaponPickup).toBe("flamethrower");
        expect(LEVEL_CONFIGS[2].ammoPickups).toContain("flamethrower");
        expect(FEATURES.barrels.countByLevel).toEqual([3, 4, 4, 5]);
        expect(FEATURES.survivors.countByLevel).toEqual([1, 1, 2, 2]);
        expect(FEATURES.turret.lifetime).toBeGreaterThan(FEATURES.airlock.duration);
        expect(FEATURES.selfDestruct.duration).toBe(60);
        expect(GAME_CONFIG.world.collisionSubstep).toBeLessThan(GAME_CONFIG.player.radius);
    });

    it("defines distinct render quality budgets", () => {
        expect(VISUALS.quality.high.ssao).toBe(true);
        expect(VISUALS.quality.low.ssao).toBe(false);
        expect(VISUALS.quality.high.msaaSamples).toBe(4);
        expect(VISUALS.quality.high.textureSize)
            .toBeGreaterThan(VISUALS.quality.low.textureSize);
        expect(VISUALS.quality.high.bloomThreshold).toBeGreaterThanOrEqual(0.9);
        expect(VISUALS.emissive.eyeIntensity)
            .toBeGreaterThan(VISUALS.quality.high.bloomThreshold);
    });

    it("defines safe starts and only ceiling stalkers in former flyer mixes", () => {
        expect(SPAWN_SAFE_RADIUS).toBe(15);
        expect(SPAWN_GRACE_SECONDS).toBe(3);
        expect(ENEMY_TYPES.flyer).toBeUndefined();
        expect(ENEMY_TYPES.CEILING_STALKER.ceilingStalker).toBe(true);
        expect(ENEMY_TYPES.CEILING_STALKER.detectionRange)
            .toBeLessThan(SPAWN_SAFE_RADIUS);
        expect(LEVEL_CONFIGS[1].enemies.CEILING_STALKER).toBeGreaterThan(0);
        expect(LEVEL_CONFIGS[3].enemies.CEILING_STALKER).toBeGreaterThan(0);
        expect(JSON.stringify(LEVEL_CONFIGS)).not.toContain("flyer");
    });
});
