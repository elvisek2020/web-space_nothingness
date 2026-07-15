import { expect, test } from "@playwright/test";

const BARREL_COUNTS = [3, 3, 4, 4, 4, 5, 5, 5, 6];

async function openTestGame(page) {
    await page.addInitScript(() => sessionStorage.setItem("player_name", "E2E Posádka"));
    await page.goto("/?test=1");
    await page.evaluate(() => window.__game.waitReady());
    await expect(page.locator("#game-canvas")).toBeVisible();
}

test("production page does not expose test API", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => "__game" in window)).toBe(false);
    await page.evaluate(() => {
        const brightness = document.getElementById("brightness-slider");
        brightness.value = "135";
        brightness.dispatchEvent(new Event("input", { bubbles: true }));
        document.getElementById("quality-toggle").click();
    });
    await page.reload();
    expect(await page.locator("#brightness-slider").inputValue()).toBe("135");
    await expect(page.locator("#quality-toggle")).toHaveText("NÍZKÁ");
});

test("smoke and wall-pass audit on all nine levels", async ({ page }) => {
    test.setTimeout(120_000);
    const externalRequests = [];
    page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.hostname !== "127.0.0.1") externalRequests.push(request.url());
    });
    await openTestGame(page);
    const levelCount = await page.evaluate(() => window.__game.getLevelCount());
    expect(levelCount).toBe(9);
    await expect(page.locator("#level-value")).toContainText("/9");
    const testRenderer = await page.evaluate(() => window.__game.getRenderStats());
    expect(testRenderer.composer).toBe(false);
    expect(testRenderer.ssao).toBe(false);
    for (let level = 1; level <= levelCount; level += 1) {
        await page.evaluate((number) => window.__game.skipToLevel(number), level);
        const audit = await page.evaluate(() => {
            const bounds = window.__game.getBounds();
            const colliders = window.__game.getColliders();
            const escape = window.__game.getFeatures().escape;
            window.__game.setPlayerPos(bounds.maxX - 0.46, bounds.minZ + 2);
            window.__game.move("right", 2);
            return {
                bounds,
                position: window.__game.getPlayerPos(),
                colliders,
                barrelCount: window.__game.getFeatures().barrels.length,
                escape,
            };
        });
        expect(audit.position.x).toBeLessThanOrEqual(audit.bounds.maxX - 0.4);
        expect(audit.colliders.length).toBeGreaterThan(8);
        expect(audit.colliders.every((collider) => collider.id && collider.type)).toBe(true);
        expect(audit.barrelCount).toBe(BARREL_COUNTS[level - 1]);
        if (level === levelCount) {
            expect(audit.escape).toBeTruthy();
        }
    }
    expect(externalRequests).toEqual([]);
});

test("production high and low quality use configured composer profiles", async ({ page }) => {
    test.setTimeout(90_000);
    const startDebugGame = async () => {
        await page.goto("/?debug=1");
        await page.locator("#player-name").fill("Render QA");
        await page.locator("#join-btn").click();
        await page.locator("#start-btn").click();
        await expect(page.locator("#render-stats")).toContainText("COMPOSER", { timeout: 25_000 });
    };

    await startDebugGame();
    await expect(page.locator("#render-stats")).toContainText("SSAO ON");
    await expect(page.locator("#render-stats")).toContainText("SHADOW ON");

    await page.evaluate(() => localStorage.setItem("orion_quality", "low"));
    await startDebugGame();
    await expect(page.locator("#render-stats")).toContainText("SSAO OFF");
    await expect(page.locator("#render-stats")).toContainText("SHADOW OFF");
});

test("all levels enforce spawn safe radius and grace period", async ({ page }) => {
    test.setTimeout(120_000);
    await openTestGame(page);
    const levelCount = await page.evaluate(() => window.__game.getLevelCount());
    for (let level = 1; level <= levelCount; level += 1) {
        await page.evaluate(
            (number) => window.__game.skipToLevel(number, { spawnEnemies: true }),
            level,
        );
        const initial = await page.evaluate(() => ({
            hp: window.__game.getHP(),
            rules: window.__game.getSpawnRules(),
            enemies: window.__game.getEnemies(),
        }));
        expect(initial.enemies.length).toBeGreaterThan(0);
        expect(initial.enemies.every(
            (enemy) => enemy.distanceFromStart >= initial.rules.safeRadius,
        )).toBe(true);
        expect(initial.enemies.every((enemy) => !enemy.insideCollider)).toBe(true);
        await page.waitForTimeout((initial.rules.graceSeconds - 0.2) * 1000);
        expect(await page.evaluate(() => window.__game.getHP())).toBe(initial.hp);
    }
});

test("deterministic spawn seed in test mode", async ({ page }) => {
    await openTestGame(page);
    await page.evaluate(() => window.__game.skipToLevel(2, { spawnEnemies: true }));
    const first = await page.evaluate(() => ({
        seed: window.__game.getSpawnSeed(),
        positions: window.__game.getSpawnPositions(),
    }));
    await page.evaluate(() => window.__game.skipToLevel(2, { spawnEnemies: true }));
    const second = await page.evaluate(() => ({
        seed: window.__game.getSpawnSeed(),
        positions: window.__game.getSpawnPositions(),
    }));
    expect(first.seed).toBe(second.seed);
    expect(first.positions).toEqual(second.positions);
});

test("ceiling stalker warns, jumps to floor and respects colliders", async ({ page }) => {
    test.setTimeout(60_000);
    await openTestGame(page);
    await page.evaluate(() => window.__game.skipToLevel(2, { spawnEnemies: true }));
    const initial = await page.evaluate(() => {
        const stalker = window.__game.getEnemies()
            .find((enemy) => enemy.type === "CEILING_STALKER");
        return { stalker, rules: window.__game.getSpawnRules() };
    });
    expect(initial.stalker).toBeTruthy();
    expect(initial.stalker.state).toBe("patrol");
    expect(initial.stalker.position.y).toBeGreaterThan(3);
    expect(initial.stalker.insideCollider).toBe(false);
    await expect(page.locator(".radar-ceiling").first()).toBeVisible();

    const cycle = await page.evaluate(() => {
        window.__game.setGodmode(true);
        window.__game.tickGame(3.2); // clear spawn grace
        window.__game.provokeCeilingStalker();
        window.__game.tickGame(2.5); // warning → jump → ground
        const ground = window.__game.getEnemies().find((enemy) => (
            enemy.type === "CEILING_STALKER" && enemy.state === "ground"
        ));
        const minY = Math.min(
            ...window.__game.getEnemies()
                .filter((enemy) => enemy.type === "CEILING_STALKER")
                .map((enemy) => enemy.position.y),
        );
        return { minY, ground };
    });
    expect(cycle.minY).toBeGreaterThan(0);
    expect(cycle.ground).toBeTruthy();
    expect(cycle.ground.position.y).toBeLessThan(1.2);
});

test("renderer resources stay bounded across repeated level rebuilds", async ({ page }) => {
    await openTestGame(page);
    const result = await page.evaluate(async () => {
        await window.__game.skipToLevel(1);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const before = window.__game.getRenderStats();
        for (let index = 0; index < 3; index += 1) {
            await window.__game.skipToLevel(2);
            await window.__game.skipToLevel(1);
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const after = window.__game.getRenderStats();
        const benchmark = await window.__game.benchmark({ frames: 20 });
        return { before, after, benchmark };
    });
    expect(result.after.geometries).toBeLessThanOrEqual(result.before.geometries + 8);
    expect(result.after.textures).toBeLessThanOrEqual(result.before.textures + 16);
    expect(result.benchmark.fps).toBeGreaterThan(1);
    expect(Number.isFinite(result.benchmark.p95Ms)).toBe(true);
});

test("weapon pickups, ammo and explosive barrels", async ({ page }) => {
    await openTestGame(page);
    await page.evaluate(() => window.__game.skipToLevel(2));
    const weapon = await page.evaluate(() => window.__game.getPickups()
        .find((pickup) => pickup.kind === "weapon"));
    expect(weapon.subtype).toBe("shotgun");
    await page.evaluate(({ x, z }) => window.__game.setPlayerPos(x, z), weapon.position);
    await expect.poll(() => page.evaluate(() => window.__game.getState().weapon)).toBe("shotgun");

    const exploded = await page.evaluate(() => window.__game.shootBarrel(0));
    expect(exploded).toBe(true);
    await expect.poll(() => page.evaluate(
        () => window.__game.getFeatures().barrels[0].exploded,
    )).toBe(true);
});

test("real keyboard input moves player in ring and module", async ({ page }) => {
    test.setTimeout(60_000);
    await openTestGame(page);
    const startBlocked = await page.evaluate(() => window.__game.isPlayerStartBlocked());
    expect(startBlocked).toBe(false);

    const moveWithKey = async (code) => {
        const before = await page.evaluate(() => window.__game.getPlayerPos());
        await page.keyboard.down(code);
        await page.waitForTimeout(220);
        await page.keyboard.up(code);
        await page.waitForTimeout(50);
        const after = await page.evaluate(() => window.__game.getPlayerPos());
        const distance = Math.hypot(after.x - before.x, after.z - before.z);
        expect(distance, `expected movement for ${code}`).toBeGreaterThan(0.35);
        return after;
    };

    await moveWithKey("KeyW");
    await moveWithKey("KeyS");
    await moveWithKey("KeyA");
    await moveWithKey("KeyD");

    const modulePos = await page.evaluate(() => {
        const start = window.__game.getPlayerStart();
        const angle = Math.atan2(start.x, start.z) + Math.PI;
        const r = 20 + 7 + 6;
        return { x: Math.sin(angle) * r, z: Math.cos(angle) * r };
    });
    await page.evaluate(({ x, z }) => window.__game.setPlayerPos(x, z), modulePos);
    await moveWithKey("KeyW");
});

test("floor integrity has no holes on all nine levels", async ({ page }) => {
    test.setTimeout(120_000);
    await openTestGame(page);
    const levelCount = await page.evaluate(() => window.__game.getLevelCount());
    for (let level = 1; level <= levelCount; level += 1) {
        await page.evaluate((number) => window.__game.skipToLevel(number), level);
        const result = await page.evaluate(() => window.__game.checkFloorIntegrity({
            step: 1.1,
            margin: 0.35,
        }));
        expect(result.samples, `level ${level} samples`).toBeGreaterThan(60);
        expect(result.holes, `level ${level} holes`).toEqual([]);
        expect(await page.evaluate(() => window.__game.isPlayerStartBlocked())).toBe(false);
        const walls = await page.evaluate(() => window.__game.checkWallIntegrity({ step: 1.6 }));
        expect(walls.breaches, `level ${level} wall breaches`).toEqual([]);
        const validation = await page.evaluate(() => window.__game.getLayoutValidation());
        expect(validation.ok, `level ${level} layout`).toBe(true);
        expect(await page.evaluate(() => (
            window.__game.getColliders().some((collider) => collider.type === "ring-trim")
        ))).toBe(false);
        expect(await page.evaluate(() => (
            window.__game.getColliders().some((collider) => collider.type === "hull-shell")
        ))).toBe(true);
    }
});

test("enemies never remain stuck inside colliders across seeds", async ({ page }) => {
    test.setTimeout(120_000);
    await openTestGame(page);
    const levelCount = await page.evaluate(() => window.__game.getLevelCount());
    for (let level = 1; level <= levelCount; level += 1) {
        for (let wave = 0; wave < 3; wave += 1) {
            await page.evaluate(
                (number) => window.__game.skipToLevel(number, { spawnEnemies: true }),
                level,
            );
            await page.evaluate(() => window.__game.rescueStuckEnemies());
            const enemies = await page.evaluate(() => window.__game.getEnemies());
            expect(enemies.every((enemy) => !enemy.insideCollider), `L${level} wave ${wave}`).toBe(true);
        }
    }
});

test("player can walk from ring into every module and back", async ({ page }) => {
    test.setTimeout(180_000);
    await openTestGame(page);
    const levelCount = await page.evaluate(() => window.__game.getLevelCount());
    for (let level = 1; level <= levelCount; level += 1) {
        await page.evaluate((number) => window.__game.skipToLevel(number), level);
        const modules = await page.evaluate(() => window.__game.getModules());
        for (const mod of modules) {
            const path = await page.evaluate((moduleId) => {
                const nodes = window.__game.getNavNodes();
                const portal = nodes.find((node) => node.kind === "portal" && node.moduleId === moduleId);
                const tunnel = nodes.find((node) => node.kind === "tunnel" && node.id.includes(moduleId.replace("module", "tunnel")));
                const ringNear = nodes
                    .filter((node) => node.kind === "ring")
                    .sort((a, b) => {
                        const da = Math.hypot(a.x - portal.x, a.z - portal.z);
                        const db = Math.hypot(b.x - portal.x, b.z - portal.z);
                        return da - db;
                    })[0];
                const moduleNode = nodes.find((node) => node.kind === "module" && node.moduleId === moduleId);
                return { ringNear, tunnel, portal, moduleNode };
            }, mod.id);
            expect(path.portal, `portal ${mod.id}`).toBeTruthy();
            expect(path.ringNear, `ring near ${mod.id}`).toBeTruthy();

            await page.evaluate(({ x, z }) => window.__game.setPlayerPos(x, z), path.ringNear);
            if (path.tunnel) {
                await page.evaluate(({ x, z }) => window.__game.walkToward(x, z, 4), path.tunnel);
            }
            await page.evaluate(({ x, z }) => window.__game.walkToward(x, z, 4), path.portal);
            await page.evaluate(({ x, z }) => window.__game.walkToward(x, z, 5), path.moduleNode || mod.center);
            const inside = await page.evaluate((id) => window.__game.isInsideModule(id), mod.id);
            expect(inside, `entered ${mod.id} on level ${level}`).toBe(true);

            await page.evaluate(({ x, z }) => window.__game.walkToward(x, z, 4), path.portal);
            if (path.tunnel) {
                await page.evaluate(({ x, z }) => window.__game.walkToward(x, z, 4), path.tunnel);
            }
            await page.evaluate(({ x, z }) => window.__game.walkToward(x, z, 4), path.ringNear);
            const backOnRing = await page.evaluate(() => {
                const pos = window.__game.getPlayerPos();
                const r = Math.hypot(pos.x, pos.z);
                return r > 15 && r < 25;
            });
            expect(backOnRing, `returned from ${mod.id}`).toBe(true);
        }
    }
});

test("clearing wave spawns reachable boss with HUD warning", async ({ page }) => {
    test.setTimeout(120_000);
    await openTestGame(page);
    // Level 3 has bossArena + praetorian
    await page.evaluate(() => window.__game.skipToLevel(3, { spawnEnemies: true }));
    await page.evaluate(() => window.__game.setGodmode(true));
    const cleared = await page.evaluate(() => window.__game.clearLivingEnemies());
    expect(cleared.bossSpawned).toBe(true);
    await expect(page.locator("#boss-warning")).toBeVisible({ timeout: 5000 });
    const boss = await page.evaluate(() => window.__game.getBossState());
    expect(boss.bosses.length).toBeGreaterThan(0);
    expect(boss.bosses.every((item) => !item.insideCollider)).toBe(true);
    expect(boss.arena).toBeTruthy();
    expect(Math.hypot(boss.arena.x, boss.arena.z)).toBeGreaterThan(20);
    await page.evaluate(({ x, z }) => {
        const moduleId = window.__game.getBossState().arena?.moduleId;
        const nodes = window.__game.getNavNodes();
        const portal = nodes.find((node) => node.kind === "portal" && node.moduleId === moduleId);
        const tunnel = nodes.find((node) => node.kind === "tunnel" && node.moduleId === moduleId);
        const ringNear = nodes
            .filter((node) => node.kind === "ring")
            .sort((a, b) => Math.hypot(a.x - portal.x, a.z - portal.z) - Math.hypot(b.x - portal.x, b.z - portal.z))[0];
        window.__game.setPlayerPos(ringNear.x, ringNear.z);
        if (tunnel) window.__game.walkToward(tunnel.x, tunnel.z, 4);
        window.__game.walkToward(portal.x, portal.z, 4);
        window.__game.walkToward(x, z, 5);
    }, {
        x: boss.arena.x,
        z: boss.arena.z,
    });
    const nearBoss = await page.evaluate(() => {
        const pos = window.__game.getPlayerPos();
        const arena = window.__game.getBossState().arena;
        return Math.hypot(pos.x - arena.x, pos.z - arena.z) < 10;
    });
    expect(nearBoss).toBe(true);
});

test("sustained shooting reuses pooled projectiles with zero frame allocations", async ({ page }) => {
    test.setTimeout(60_000);
    await openTestGame(page);
    // Prefill pools and let projectiles expire before measuring.
    await page.evaluate(() => {
        for (let index = 0; index < 24; index += 1) {
            window.__game.shoot(index * 0.05);
        }
    });
    await page.waitForTimeout(2200);
    await page.evaluate(() => window.__game.resetFrameAllocations());
    const allocationSamples = await page.evaluate(async () => {
        const samples = [];
        for (let index = 0; index < 16; index += 1) {
            window.__game.resetFrameAllocations();
            window.__game.shoot(performance.now() / 1000 + index * 0.25);
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
            samples.push(window.__game.getFrameAllocations());
        }
        return samples;
    });
    const warmSamples = allocationSamples.slice(2);
    expect(Math.max(...warmSamples)).toBe(0);
});

test("airlock, oxygen, turret and survivors", async ({ page }) => {
    test.setTimeout(90_000);
    await openTestGame(page);
    await page.evaluate(() => window.__game.skipToLevel(3));
    const features3 = await page.evaluate(() => window.__game.getFeatures());
    await page.evaluate(({ x, z }) => window.__game.setPlayerPos(x, z), features3.airlock);
    await page.evaluate(() => window.__game.interact());
    expect(await page.evaluate(() => window.__game.getState().airlockUsed)).toBe(true);

    await page.evaluate(() => window.__game.skipToLevel(5));
    const features = await page.evaluate(() => window.__game.getFeatures());
    const oxygenBefore = await page.evaluate(() => window.__game.getState().oxygen);
    const zoneCenter = {
        x: (features.oxygenZone.minX + features.oxygenZone.maxX) / 2,
        z: (features.oxygenZone.minZ + features.oxygenZone.maxZ) / 2,
    };
    await page.evaluate(({ x, z }) => window.__game.setPlayerPos(x, z), zoneCenter);
    await page.waitForTimeout(1100);
    expect(await page.evaluate(() => window.__game.getState().oxygen)).toBeLessThan(oxygenBefore);

    const turretPickup = await page.evaluate(() => window.__game.getPickups()
        .find((pickup) => pickup.kind === "turret"));
    await page.evaluate(({ x, z }) => window.__game.setPlayerPos(x, z), turretPickup.position);
    await expect.poll(() => page.evaluate(() => window.__game.getState().turretKits)).toBe(1);
    await page.evaluate(() => {
        const start = window.__game.getPlayerStart();
        window.__game.setPlayerPos(start.x, start.z);
    });
    await page.evaluate(() => window.__game.placeTurret());
    expect(await page.evaluate(() => window.__game.getState().turretActive)).toBe(true);

    const survivor = (await page.evaluate(() => window.__game.getFeatures().survivors))[0];
    await page.evaluate(({ x, z }) => window.__game.setPlayerPos(x, z), survivor);
    await expect.poll(() => page.evaluate(
        () => window.__game.getState().rescuedSurvivors,
    )).toBeGreaterThan(0);
});

test("self-destruction escape awards victory bonus", async ({ page }) => {
    test.setTimeout(60_000);
    await openTestGame(page);
    await page.evaluate(() => window.__game.skipToLevel(9));
    await page.evaluate(() => window.__game.startSelfDestruct());
    expect(await page.evaluate(() => window.__game.getState().selfDestruct)).toBe(true);
    const escape = await page.evaluate(() => window.__game.getFeatures().escape);
    await page.evaluate(({ x, z }) => window.__game.setPlayerPos(x, z), escape);
    await expect(page.locator("#victory-screen")).toBeVisible();
    await expect(page.locator("#victory-time-bonus")).not.toHaveText("0");
});

test("forceGameOver stores score in isolated leaderboard", async ({ page, request }) => {
    await openTestGame(page);
    await page.evaluate(() => window.__game.forceGameOver());
    await expect(page.locator("#gameover-screen")).toBeVisible();
    const response = await request.get("/partials/leaderboard");
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("E2E Posádka");
});
