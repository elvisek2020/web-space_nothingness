import * as THREE from "three";
import {
    FEATURES,
    GAME_CONFIG,
    LEVEL_CONFIGS,
    LIGHTING,
    SPAWN_GRACE_SECONDS,
    SPAWN_SAFE_RADIUS,
} from "./config.js";
import { submitScore, refreshLeaderboards } from "./api.js";
import { GameAudio } from "./audio.js";
import { BarrelManager } from "./barrels.js";
import { isInsideAnyCollider } from "./collision.js";
import { EnemyManager } from "./enemies.js";
import { Hud } from "./hud.js";
import { LevelBuilder } from "./levels.js";
import { PickupManager } from "./pickups.js";
import { Player } from "./player.js";
import { RenderingPipeline } from "./rendering.js";
import { disposeVisuals, initializeVisuals } from "./visual-utils.js";
import {
    AirlockSystem,
    OxygenSystem,
    SelfDestructSystem,
    SurvivorManager,
    TurretSystem,
} from "./systems.js";

const parameters = new URLSearchParams(window.location.search);
const TEST_MODE = parameters.get("test") === "1";
const DEBUG_MODE = parameters.get("debug") === "1";
const canvas = document.getElementById("game-canvas");
const audio = new GameAudio();
const hud = new Hud(audio);
const clock = new THREE.Clock();
const audioForward = new THREE.Vector3(0, 0, -1);
const totalSurvivors = FEATURES.survivors.countByLevel.reduce((sum, count) => sum + count, 0);

let renderer = null;
let rendering = null;
let scene = null;
let camera = null;
let player = null;
let levelBuilder = null;
let enemyManager = null;
let pickupManager = null;
let barrelManager = null;
let airlockSystem = null;
let oxygenSystem = null;
let survivorManager = null;
let turretSystem = null;
let selfDestructSystem = null;
let world = null;
let levelIndex = 0;
let quality = localStorage.getItem("orion_quality") === "low" ? "low" : "high";
let brightness = Number(localStorage.getItem("orion_brightness")) || LIGHTING.brightness.default;
let gameRunning = false;
let sessionActive = false;
let transitioning = false;
let scoreSubmitted = false;
let rescuedSurvivors = 0;
let selfDestructActive = false;
let gameOverReason = "ORION-9 zůstává v karanténě.";
let lastTimeBonus = 0;
let debugFrames = 0;
let debugElapsed = 0;

function runtimeQuality() {
    return TEST_MODE ? "low" : quality;
}

function seededRandom(seed) {
    let value = seed % 2147483647;
    return () => {
        value = value * 16807 % 2147483647;
        return (value - 1) / 2147483646;
    };
}

export function showScreen(screenId) {
    document.querySelectorAll(".screen").forEach((screen) => screen.classList.add("hidden"));
    document.getElementById(screenId)?.classList.remove("hidden");
    document.body.classList.toggle("game-active", screenId === "game-screen");
}

function initRenderer() {
    if (renderer) return;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 180);
    camera.rotation.order = "YXZ";
    scene.add(camera);
    rendering = new RenderingPipeline(canvas, scene, camera, runtimeQuality(), TEST_MODE);
    renderer = rendering.renderer;
    initializeVisuals(renderer, runtimeQuality());
    applyBrightness();

    player = new Player(camera, scene, canvas, audio, {
        onHealth: (hp) => hud.setHealth(hp),
        onScore: (score) => hud.setScore(score),
        onDamage: () => hud.flashDamage(),
        onHeal: () => hud.flashHeal(),
        onDeath: () => finishRun(false),
        onWeapon: (label, ammo) => hud.setWeapon(label, ammo),
        onEmptyWeapon: () => hud.showMessage("MUNICE VYČERPÁNA", 850),
        onInteract: () => useInteraction(),
        onTurret: () => placeTurret(),
    });
    if (TEST_MODE) player.random = seededRandom(42);
    window.addEventListener("resize", resizeRenderer);
}

function applyBrightness() {
    const scale = brightness / 100;
    rendering?.setExposure(scale);
    levelBuilder?.setBrightness(scale);
    document.getElementById("brightness-value").textContent = `${brightness} %`;
}

function resizeRenderer() {
    if (!renderer || !camera) return;
    rendering.resize();
}

function clearLevel() {
    enemyManager?.dispose();
    pickupManager?.dispose();
    barrelManager?.dispose();
    airlockSystem?.dispose();
    survivorManager?.dispose();
    turretSystem?.dispose();
    selfDestructSystem?.dispose();
    levelBuilder?.dispose();
    player?.clearProjectiles();
    enemyManager = null;
    pickupManager = null;
    barrelManager = null;
    airlockSystem = null;
    oxygenSystem = null;
    survivorManager = null;
    turretSystem = null;
    selfDestructSystem = null;
    levelBuilder = null;
    world = null;
    selfDestructActive = false;
    document.body.classList.remove("self-destruct-active");
}

function setupLevel(index, freshRun = false, spawnEnemies = !TEST_MODE) {
    clearLevel();
    levelIndex = index;
    const config = LEVEL_CONFIGS[levelIndex];
    levelBuilder = new LevelBuilder(scene, config, runtimeQuality(), {
        seed: TEST_MODE ? 42 + levelIndex : undefined,
        debug: DEBUG_MODE,
    });
    world = levelBuilder.build();
    applyBrightness();

    if (freshRun) {
        rescuedSurvivors = 0;
        lastTimeBonus = 0;
        gameOverReason = "ORION-9 zůstává v karanténě.";
        player.reset(world.playerStart, world.colliders, world.bounds, 0);
        hud.reset();
    } else {
        player.setWorld(world.playerStart, world.colliders, world.bounds);
        player.active = true;
    }
    hud.setLevel(config.number, config.name);
    hud.setScore(player.score);
    hud.setSurvivors(rescuedSurvivors, totalSurvivors);
    hud.showMessage(`${config.name} · ${config.subtitle}`, 2400);

    barrelManager = new BarrelManager(
        scene,
        world.barrelPoints,
        world,
        runtimeQuality(),
        audio,
    );
    enemyManager = new EnemyManager(scene, config, world, runtimeQuality(), audio, {
        onCount: (count) => hud.setRemaining(count),
        onBoss: (name) => hud.showBoss(name),
        onComplete: () => completeLevel(),
    });
    if (spawnEnemies) enemyManager.start();
    else hud.setRemaining(0);

    pickupManager = new PickupManager(
        scene,
        world,
        config,
        runtimeQuality(),
        {
            onOxygenPickup: (amount) => oxygenSystem?.refill(amount),
            onTurretKit: () => turretSystem?.addKit(),
            onCollected: (kind) => hud.showMessage(`SEBRÁNO · ${kind.toUpperCase()}`, 850),
        },
        TEST_MODE ? seededRandom(90 + index) : Math.random,
    );
    airlockSystem = new AirlockSystem(scene, world.airlockPosition, audio, {
        onActivated: (killed) => hud.showMessage(`AIRLOCK · ${killed} CÍLŮ`, 1800),
    });
    oxygenSystem = new OxygenSystem(world.oxygenZone, audio, {
        onChange: (value, visible) => hud.setOxygen(value, FEATURES.oxygen.max, visible),
    });
    survivorManager = new SurvivorManager(scene, world.survivorPoints, audio, {
        onRescued: () => {
            rescuedSurvivors += 1;
            hud.setSurvivors(rescuedSurvivors, totalSurvivors);
            hud.showMessage("+250 · PŘEŽIVŠÍ ZACHRÁNĚN", 1200);
        },
    });
    turretSystem = new TurretSystem(scene, world, audio, {
        onHint: (message) => hud.setContextHint(message),
        onLifetime: (seconds) => hud.setTurret(seconds),
    });
    selfDestructSystem = new SelfDestructSystem(scene, world.escapePoint, audio, {
        onStart: (seconds) => {
            selfDestructActive = true;
            document.body.classList.add("self-destruct-active");
            hud.setSelfDestruct(seconds);
            hud.showMessage("UTEČ K ÚNIKOVÉMU MODULU!", 3000);
        },
        onTick: (seconds) => hud.setSelfDestruct(seconds),
        onEscaped: (bonus) => {
            lastTimeBonus = bonus;
            selfDestructActive = false;
            document.body.classList.remove("self-destruct-active");
            finishRun(true);
        },
        onExploded: () => {
            gameOverReason = "Stanice explodovala.";
            selfDestructActive = false;
            document.body.classList.remove("self-destruct-active");
        },
    });
}

async function loadingSequence(freshRun) {
    if (TEST_MODE) {
        setupLevel(levelIndex, freshRun, false);
        transitioning = false;
        sessionActive = true;
        gameRunning = true;
        player.active = true;
        showScreen("game-screen");
        return;
    }
    showScreen("loading-screen");
    const progress = document.getElementById("loading-progress");
    const bar = document.getElementById("loading-progress-bar");
    const status = document.getElementById("loading-status");
    const stages = [
        [15, "Navazuji spojení s ORION-9"],
        [38, "Mapuji přepážky a tlakové uzávěry"],
        [64, "Nabíjím zbraňové systémy"],
        [82, "Kalibruji motion tracker"],
        [100, "Taktické systémy připraveny"],
    ];
    for (const [value, label] of stages) {
        status.textContent = label;
        bar.style.width = `${value}%`;
        progress.setAttribute("aria-valuenow", String(value));
        await new Promise((resolve) => window.setTimeout(resolve, 90));
    }
    setupLevel(levelIndex, freshRun);
    transitioning = false;
    sessionActive = true;
    showScreen("game-screen");
    requestGameLock();
}

async function startNewGame() {
    if (!TEST_MODE) await audio.unlock();
    initRenderer();
    scoreSubmitted = false;
    levelIndex = 0;
    transitioning = true;
    sessionActive = false;
    gameRunning = false;
    await loadingSequence(true);
}

async function continueToNextLevel() {
    levelIndex += 1;
    transitioning = true;
    gameRunning = false;
    await loadingSequence(false);
}

function requestGameLock() {
    if (TEST_MODE) {
        player.active = true;
        gameRunning = true;
        return;
    }
    canvas.focus();
    const result = canvas.requestPointerLock();
    if (result?.catch) {
        result.catch(() => {
            gameRunning = false;
            sessionActive = true;
            showScreen("pause-screen");
        });
    }
}

function completeLevel() {
    if (transitioning || selfDestructActive) return;
    if (levelIndex === LEVEL_CONFIGS.length - 1) {
        enemyManager.completed = true;
        selfDestructSystem.start(enemyManager);
        return;
    }
    transitioning = true;
    gameRunning = false;
    sessionActive = false;
    player.active = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    document.getElementById("level-score").textContent = String(player.score);
    document.getElementById("level-complete-copy").textContent =
        `${LEVEL_CONFIGS[levelIndex].name} je bez biologických cílů.`;
    showScreen("level-complete-screen");
}

async function finishRun(victory) {
    if (!player || (!sessionActive && !transitioning && !victory)) return;
    gameRunning = false;
    sessionActive = false;
    transitioning = true;
    player.active = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    const screenId = victory ? "victory-screen" : "gameover-screen";
    const scoreElement = document.getElementById(victory ? "victory-score" : "gameover-score");
    const statusElement = document.getElementById(
        victory ? "victory-save-status" : "gameover-save-status",
    );
    scoreElement.textContent = String(player.score);
    if (victory) {
        document.getElementById("victory-time-bonus").textContent = String(lastTimeBonus);
        document.getElementById("victory-survivors").textContent = `${rescuedSurvivors}/${totalSurvivors}`;
    } else {
        document.getElementById("gameover-reason").textContent = gameOverReason;
    }
    statusElement.textContent = "Odesílám záznam do terminálu…";
    showScreen(screenId);
    if (!scoreSubmitted) {
        scoreSubmitted = true;
        try {
            await submitScore({
                name: sessionStorage.getItem("player_name") || "Neznámý člen",
                score: player.score,
                level: levelIndex + 1,
            });
            statusElement.textContent = "Záznam byl bezpečně uložen.";
            refreshLeaderboards();
        } catch (error) {
            statusElement.textContent = error instanceof Error
                ? error.message
                : "Záznam se nepodařilo uložit.";
        }
    }
    transitioning = false;
}

function useInteraction() {
    if (airlockSystem?.interact(player, enemyManager)) return;
    hud.showMessage("ŽÁDNÁ INTERAKCE V DOSAHU", 650);
}

function placeTurret() {
    if (!turretSystem?.place(player)) hud.showMessage("VĚŽIČKU NELZE POLOŽIT", 700);
}

function updateContextHint() {
    if (airlockSystem?.isNear(player) && !airlockSystem.used) {
        hud.setContextHint("[E] AIRLOCK");
    } else if (turretSystem?.kits > 0 && !turretSystem.active) {
        hud.setContextHint(`[T] POLOŽIT VĚŽIČKU (${turretSystem.kits})`);
    } else {
        hud.setContextHint("");
    }
}

function pauseGame() {
    if (!sessionActive || transitioning) return;
    gameRunning = false;
    player.active = false;
    showScreen("pause-screen");
}

function resumeGame() {
    if (!sessionActive) return;
    player.active = true;
    showScreen("game-screen");
    requestGameLock();
}

function handlePointerLock() {
    if (TEST_MODE) return;
    if (document.pointerLockElement === canvas) {
        if (sessionActive && !transitioning) {
            player.active = true;
            gameRunning = true;
            clock.getDelta();
        }
    } else if (sessionActive && !transitioning) {
        pauseGame();
    }
}

function animate() {
    window.requestAnimationFrame(animate);
    if (!renderer || !scene || !camera) return;
    const delta = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;
    if (gameRunning) {
        camera.getWorldDirection(audioForward);
        audio.setListener(camera.position, audioForward);
        player.update(delta, elapsed);
        levelBuilder?.update(elapsed);
        enemyManager?.update(delta, elapsed, player);
        pickupManager?.update(delta, elapsed, player);
        barrelManager?.update(delta, player, enemyManager);
        airlockSystem?.update(delta);
        oxygenSystem?.update(delta, player);
        survivorManager?.update(player);
        turretSystem?.update(delta, enemyManager);
        selfDestructSystem?.update(delta, player);
        updateContextHint();
        hud.updateRadar(
            player,
            enemyManager?.getRadarEntities() || [],
            pickupManager?.getRadarEntities() || [],
            survivorManager?.getRadarEntities() || [],
            elapsed,
        );
    }
    rendering.render(delta);
    updateDebugStats(delta);
}

function updateDebugStats(delta) {
    if (!DEBUG_MODE || !rendering) return;
    debugFrames += 1;
    debugElapsed += delta;
    if (debugElapsed < 0.5) return;
    const fps = Math.round(debugFrames / debugElapsed);
    const stats = rendering.getStats();
    document.getElementById("render-stats").textContent = [
        `FPS ${String(fps).padStart(3, " ")}`,
        `${stats.quality.toUpperCase()} · ${stats.composer ? "COMPOSER" : "DIRECT"}`,
        `CALLS ${stats.calls} · TRI ${stats.triangles}`,
        `GEO ${stats.geometries} · TEX ${stats.textures}`,
        `SSAO ${stats.ssao ? "ON" : "OFF"} · SHADOW ${stats.shadows ? "ON" : "OFF"}`,
    ].join("\n");
    debugFrames = 0;
    debugElapsed = 0;
}

function showLoginError(message) {
    const error = document.getElementById("login-error");
    error.textContent = message;
    error.classList.add("show");
}

function login() {
    const input = document.getElementById("player-name");
    const name = input.value.trim();
    if (!name) {
        showLoginError("Zadej jméno člena posádky.");
        input.focus();
        return;
    }
    if (name.length > 20) {
        showLoginError("Jméno může mít nejvýše 20 znaků.");
        return;
    }
    sessionStorage.setItem("player_name", name);
    document.getElementById("login-error").classList.remove("show");
    showScreen("menu-screen");
}

function initUi() {
    const savedName = sessionStorage.getItem("player_name");
    if (savedName) document.getElementById("player-name").value = savedName;
    const qualityToggle = document.getElementById("quality-toggle");
    qualityToggle.textContent = quality === "high" ? "VYSOKÁ" : "NÍZKÁ";
    qualityToggle.setAttribute("aria-pressed", String(quality === "high"));
    const brightnessSlider = document.getElementById("brightness-slider");
    brightness = Math.max(
        LIGHTING.brightness.min,
        Math.min(brightness, LIGHTING.brightness.max),
    );
    brightnessSlider.value = String(brightness);
    document.getElementById("brightness-value").textContent = `${brightness} %`;

    document.getElementById("main-title").addEventListener("click", () => window.location.reload());
    document.getElementById("join-btn").addEventListener("click", login);
    document.getElementById("player-name").addEventListener("keydown", (event) => {
        if (event.key === "Enter") login();
    });
    document.getElementById("start-btn").addEventListener("click", startNewGame);
    document.getElementById("resume-btn").addEventListener("click", resumeGame);
    document.getElementById("next-level-btn").addEventListener("click", continueToNextLevel);
    document.getElementById("retry-btn").addEventListener("click", startNewGame);
    document.getElementById("victory-retry-btn").addEventListener("click", startNewGame);
    qualityToggle.addEventListener("click", (event) => {
        quality = quality === "high" ? "low" : "high";
        localStorage.setItem("orion_quality", quality);
        event.currentTarget.textContent = quality === "high" ? "VYSOKÁ" : "NÍZKÁ";
        event.currentTarget.setAttribute("aria-pressed", String(quality === "high"));
        if (renderer) window.location.reload();
    });
    brightnessSlider.addEventListener("input", (event) => {
        brightness = Number(event.currentTarget.value);
        localStorage.setItem("orion_brightness", String(brightness));
        applyBrightness();
    });
    document.addEventListener("pointerlockchange", handlePointerLock);
    if (DEBUG_MODE) document.getElementById("render-stats").classList.remove("hidden");
    window.addEventListener("beforeunload", () => {
        disposeVisuals();
        rendering?.dispose();
    }, { once: true });
    if (window.matchMedia("(pointer: coarse)").matches && !TEST_MODE) {
        document.getElementById("mobile-warning").classList.remove("hidden");
    }
}

async function ensureTestGame(level = 1) {
    initRenderer();
    if (!world) {
        levelIndex = level - 1;
        setupLevel(levelIndex, true, false);
        sessionActive = true;
        gameRunning = true;
        transitioning = false;
        player.active = true;
        showScreen("game-screen");
    }
}

function exposeTestApi() {
    if (!TEST_MODE) return;
    window.__game = {
        async waitReady() {
            await ensureTestGame();
            return true;
        },
        getState() {
            return {
                levelIndex,
                levelNumber: levelIndex + 1,
                hp: player?.hp ?? 0,
                score: player?.score ?? 0,
                active: gameRunning,
                godmode: player?.godmode ?? false,
                bounds: world ? { ...world.bounds } : null,
                colliderCount: world?.colliders.length || 0,
                enemyCount: enemyManager?.enemies.filter((enemy) => !enemy.dead).length || 0,
                selfDestruct: selfDestructSystem?.active || false,
                oxygen: oxygenSystem?.oxygen ?? null,
                airlockUsed: airlockSystem?.used || false,
                rescuedSurvivors,
                weapon: player?.activeWeapon || null,
                unlockedWeapons: player ? [...player.unlockedWeapons] : [],
                ammo: player ? { ...player.ammo } : {},
                turretActive: Boolean(turretSystem?.active),
                turretKits: turretSystem?.kits || 0,
            };
        },
        getPlayerPos() {
            return { x: player.camera.position.x, z: player.camera.position.z };
        },
        setPlayerPos(x, z) {
            const radius = GAME_CONFIG.player.radius;
            player.camera.position.x = Math.max(
                world.bounds.minX + radius,
                Math.min(x, world.bounds.maxX - radius),
            );
            player.camera.position.z = Math.max(
                world.bounds.minZ + radius,
                Math.min(z, world.bounds.maxZ - radius),
            );
        },
        move(direction, seconds) {
            const vectors = {
                forward: [0, -1],
                back: [0, 1],
                left: [-1, 0],
                right: [1, 0],
            };
            const vector = vectors[direction];
            if (!vector) throw new Error("Unknown direction");
            const steps = Math.ceil(seconds * 60);
            for (let index = 0; index < steps; index += 1) {
                player.moveBy(
                    vector[0] * GAME_CONFIG.player.speed / 60,
                    vector[1] * GAME_CONFIG.player.speed / 60,
                );
            }
            return this.getPlayerPos();
        },
        getHP: () => player.hp,
        setGodmode: (enabled) => player.setGodmode(enabled),
        async skipToLevel(number, options = {}) {
            if (number < 1 || number > 4) throw new Error("Level must be 1-4");
            await ensureTestGame();
            setupLevel(number - 1, false, Boolean(options.spawnEnemies));
            sessionActive = true;
            gameRunning = true;
            player.active = true;
            return this.getState();
        },
        isInsideAnyCollider(position) {
            return isInsideAnyCollider(position, GAME_CONFIG.player.radius, world.colliders);
        },
        getColliders: () => world.colliders.map((collider) => ({ ...collider })),
        getBounds: () => ({ ...world.bounds }),
        getSpawnRules: () => ({
            safeRadius: SPAWN_SAFE_RADIUS,
            graceSeconds: SPAWN_GRACE_SECONDS,
            graceRemaining: enemyManager?.graceRemaining || 0,
            playerStart: world
                ? { x: world.playerStart.x, z: world.playerStart.z }
                : null,
        }),
        getEnemies: () => (enemyManager?.enemies || [])
            .filter((enemy) => !enemy.dead)
            .map((enemy) => {
                const position = enemy.group.position;
                return {
                    type: enemy.type,
                    state: enemy.stalkerState || null,
                    position: { x: position.x, y: position.y, z: position.z },
                    distanceFromStart: Math.hypot(
                        position.x - world.playerStart.x,
                        position.z - world.playerStart.z,
                    ),
                    insideCollider: isInsideAnyCollider(
                        position,
                        enemy.radius * 0.75,
                        world.colliders,
                    ),
                };
            }),
        async forceGameOver() {
            sessionActive = true;
            await finishRun(false);
        },
        getPickups: () => pickupManager.pickups
            .filter((pickup) => !pickup.collected)
            .map((pickup) => ({
                kind: pickup.kind,
                subtype: pickup.subtype,
                position: { x: pickup.group.position.x, z: pickup.group.position.z },
            })),
        getFeatures: () => ({
            airlock: world.airlockPosition
                ? { x: world.airlockPosition.x, z: world.airlockPosition.z }
                : null,
            oxygenZone: world.oxygenZone ? { ...world.oxygenZone } : null,
            barrels: barrelManager.getState(),
            survivors: survivorManager.getRadarEntities().map((item) => ({
                x: item.position.x,
                z: item.position.z,
            })),
            escape: world.escapePoint
                ? { x: world.escapePoint.x, z: world.escapePoint.z }
                : null,
        }),
        interact: () => useInteraction(),
        placeTurret: () => placeTurret(),
        shootBarrel(index = 0) {
            const barrel = barrelManager.barrels[index];
            if (!barrel || barrel.exploded) return false;
            barrelManager._explode(barrel, player, enemyManager);
            return true;
        },
        startSelfDestruct() {
            selfDestructSystem.start(enemyManager);
        },
        getRenderStats() {
            return rendering?.getStats() || null;
        },
        benchmark(options = {}) {
            const frameCount = Math.max(10, Math.min(300, options.frames || 60));
            return new Promise((resolve) => {
                const samples = [];
                let previous = performance.now();
                const sample = (now) => {
                    samples.push(now - previous);
                    previous = now;
                    if (samples.length < frameCount) {
                        window.requestAnimationFrame(sample);
                        return;
                    }
                    const sorted = [...samples].sort((a, b) => a - b);
                    const averageMs = samples.reduce((sum, value) => sum + value, 0)
                        / samples.length;
                    resolve({
                        frames: samples.length,
                        averageMs,
                        fps: 1000 / averageMs,
                        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
                        render: rendering.getStats(),
                    });
                };
                window.requestAnimationFrame(sample);
            });
        },
    };
}

initUi();
exposeTestApi();
animate();
