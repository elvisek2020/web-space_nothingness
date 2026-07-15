import * as THREE from "three";
import {
    FEATURES,
    GAME_CONFIG,
    LIGHTING,
    SPAWN_SAFE_RADIUS,
    VISUALS,
} from "./config.js";
import { createSmokeSprite, disposeObject3D, getVisuals } from "./visual-utils.js";

function seededRandom(seed) {
    let value = seed % 2147483647;
    return () => {
        value = (value * 16807) % 2147483647;
        return (value - 1) / 2147483646;
    };
}

export class LevelBuilder {
    constructor(scene, config, quality = "high", options = {}) {
        this.scene = scene;
        this.config = config;
        this.quality = quality;
        this.group = new THREE.Group();
        this.group.name = `level-${config.number}`;
        this.colliders = [];
        this.spawnPoints = [];
        this.pickupPoints = [];
        this.random = seededRandom(options.seed || config.number * 9137);
        this.debug = Boolean(options.debug);
        this.width = config.size[0];
        this.depth = config.size[1];
        this.animatedVisuals = [];
    }

    build() {
        this.scene.background = new THREE.Color(this.config.fog);
        this.scene.fog = new THREE.Fog(
            this.config.fog,
            this.quality === "high" ? LIGHTING.fog.high.near : LIGHTING.fog.low.near,
            this.quality === "high" ? LIGHTING.fog.high.far : LIGHTING.fog.low.far,
        );
        this.scene.add(this.group);
        this._buildShell();
        this._buildStartBay();
        this._buildArchitecturalDetails();
        this._buildLighting();
        this._buildProps();
        const features = this._buildFeatureGeometry();
        this._buildWindowsAndStars();
        this._createSpawnPoints();
        if (this.debug) this._buildColliderDebug();
        return {
            colliders: this.colliders,
            spawnPoints: this.spawnPoints,
            pickupPoints: this.pickupPoints,
            bounds: {
                minX: -this.width / 2 + 1,
                maxX: this.width / 2 - 1,
                minZ: -this.depth / 2 + 1,
                maxZ: this.depth / 2 - 1,
            },
            playerStart: this._playerStart(),
            ...features,
        };
    }

    _material(color, options = {}) {
        return new THREE.MeshStandardMaterial({
            color,
            roughness: options.roughness ?? 0.72,
            metalness: options.metalness ?? 0.48,
            envMapIntensity: options.envMapIntensity ?? 0.72,
            emissive: options.emissive ?? 0x000000,
            emissiveIntensity: options.emissiveIntensity ?? 0,
            map: options.map ?? null,
            roughnessMap: options.roughnessMap ?? null,
            normalMap: options.normalMap ?? null,
            normalScale: options.normalMap ? new THREE.Vector2(0.45, 0.45) : undefined,
        });
    }

    _texturedMaterial(kind, repeatX, repeatY, options = {}) {
        const maps = getVisuals().textures.getMaps(
            kind,
            repeatX,
            repeatY,
            options.accent ?? this.config.accent,
        );
        const defaults = VISUALS.materials[kind] || {};
        return this._material(options.color ?? 0xffffff, {
            ...defaults,
            ...options,
            ...maps,
        });
    }

    _box(name, x, y, z, width, height, depth, material, solid = true) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        mesh.name = name;
        mesh.position.set(x, y, z);
        mesh.castShadow = this.quality === "high";
        mesh.receiveShadow = true;
        this.group.add(mesh);
        if (solid) {
            this.colliders.push({
                id: `${name}-${this.colliders.length}`,
                type: name,
                minX: x - width / 2,
                maxX: x + width / 2,
                minZ: z - depth / 2,
                maxZ: z + depth / 2,
            });
        }
        return mesh;
    }

    _playerStart() {
        return new THREE.Vector3(0, GAME_CONFIG.player.height, this.depth / 2 - 5);
    }

    _buildShell() {
        const wallX = this._texturedMaterial("wall", this.width / 8, 1.5, VISUALS.materials.wall);
        const wallZ = this._texturedMaterial("wall", this.depth / 8, 1.5, VISUALS.materials.wall);
        const floor = this._texturedMaterial(
            "floor",
            this.width / 7,
            this.depth / 7,
            VISUALS.materials.floor,
        );
        const trim = this._material(0x39464d, {
            emissive: this.config.accent,
            emissiveIntensity: VISUALS.emissive.stripIntensity,
            ...VISUALS.materials.trim,
        });
        const deckSeam = this._material(0x222d33, {
            metalness: 0.74,
            roughness: 0.54,
        });

        this._box("deck", 0, -0.25, 0, this.width, 0.5, this.depth, floor, false);
        this._box("ceiling", 0, 5.5, 0, this.width, 0.4, this.depth, wallZ, false);
        this._box("wall-left", -this.width / 2, 2.6, 0, 0.6, 5.5, this.depth, wallZ, true);
        this._box("wall-right", this.width / 2, 2.6, 0, 0.6, 5.5, this.depth, wallZ, true);
        this._box("wall-north", 0, 2.6, -this.depth / 2, this.width, 5.5, 0.6, wallX, true);
        this._box("wall-south", 0, 2.6, this.depth / 2, this.width, 5.5, 0.6, wallX, true);

        for (let z = -this.depth / 2 + 3; z < this.depth / 2; z += 6) {
            this._box("deck-seam", 0, 0.02, z, this.width - 1, 0.04, 0.08, deckSeam, false);
        }
        for (const side of [-1, 1]) {
            for (let z = -this.depth / 2 + 4; z < this.depth / 2; z += 8) {
                this._box("wall-rib", side * (this.width / 2 - 0.45), 2.6, z, 0.35, 5.2, 0.6, trim, false);
            }
            this._box(
                "orientation-stripe",
                side * (this.width / 2 - 0.34),
                1.25,
                0,
                0.08,
                0.38,
                this.depth - 2,
                trim,
                false,
            );
        }
    }

    _buildStartBay() {
        const start = this._playerStart();
        const frame = this._material(0x263239, {
            metalness: 0.82,
            roughness: 0.3,
            envMapIntensity: 0.95,
        });
        const inset = this._material(0x3a474e, {
            metalness: 0.62,
            roughness: 0.5,
        });
        const marker = this._texturedMaterial("hazard", 2, 1, {
            metalness: 0.34,
            roughness: 0.58,
        });
        const halfWidth = 3.4;
        const bayDepth = 5;

        for (const side of [-1, 1]) {
            this._box(
                "start-bay-side",
                side * halfWidth,
                2.55,
                start.z,
                0.18,
                4.9,
                bayDepth,
                frame,
                false,
            );
        }
        this._box(
            "start-bay-back",
            0,
            2.55,
            this.depth / 2 - 0.64,
            halfWidth * 2,
            4.9,
            0.16,
            inset,
            false,
        );
        this._box(
            "start-bay-canopy",
            0,
            5.02,
            start.z,
            halfWidth * 2,
            0.2,
            bayDepth,
            frame,
            false,
        );
        for (const x of [-2.9, 2.9]) {
            this._box(
                "start-bay-marker",
                x,
                0.045,
                start.z - bayDepth * 0.42,
                0.55,
                0.05,
                0.9,
                marker,
                false,
            );
        }
    }

    _buildArchitecturalDetails() {
        const frame = this._material(0x303b41, {
            metalness: 0.8,
            roughness: 0.3,
            envMapIntensity: 0.95,
        });
        const cable = this._material(0x182126, {
            metalness: 0.72,
            roughness: 0.42,
        });
        const glow = this._material(0xd8fff8, {
            emissive: this.config.accent,
            emissiveIntensity: VISUALS.emissive.stripIntensity,
            metalness: 0.35,
            roughness: 0.2,
        });
        const hazard = this._texturedMaterial("hazard", 2, 1, {
            metalness: 0.3,
            roughness: 0.5,
        });

        for (const side of [-1, 1]) {
            this._box(
                "wall-lower-rail",
                side * (this.width / 2 - 0.38),
                0.42,
                0,
                0.24,
                0.45,
                this.depth - 1,
                frame,
                false,
            );
            this._box(
                "wall-upper-rail",
                side * (this.width / 2 - 0.38),
                4.82,
                0,
                0.24,
                0.34,
                this.depth - 1,
                frame,
                false,
            );
        }

        const beamStep = this.quality === "high" ? 7 : 12;
        for (let z = -this.depth / 2 + 4; z < this.depth / 2 - 3; z += beamStep) {
            this._box("ceiling-beam", 0, 5.18, z, this.width - 1.1, 0.28, 0.34, frame, false);
            for (const x of [-this.width * 0.32, this.width * 0.32]) {
                this._box("recessed-light", x, 5.01, z, 3.3, 0.06, 0.3, glow, false);
            }
        }

        for (const side of [-1, 1]) {
            const tray = this._box(
                "cable-tray",
                side * (this.width * 0.33),
                4.88,
                0,
                0.58,
                0.16,
                this.depth - 3,
                cable,
                false,
            );
            tray.rotation.z = side * 0.02;
        }

        const grateZ = [-this.depth * 0.22, this.depth * 0.08];
        grateZ.forEach((z) => {
            for (let x = -2.7; x <= 2.7; x += 0.45) {
                this._box("floor-grate", x, 0.045, z, 0.17, 0.08, 7, frame, false);
            }
        });

        for (const z of [-this.depth / 2 + 0.7, this.depth / 2 - 0.7]) {
            for (const side of [-1, 1]) {
                this._box("door-frame", side * 4.2, 2.7, z, 0.7, 5.2, 0.5, hazard, false);
                this._box("door-beacon", side * 3.7, 4.65, z * 0.999, 0.3, 0.3, 0.18, glow, false);
            }
            this._box("door-header", 0, 5.05, z, 9, 0.55, 0.5, frame, false);
        }

        const greebleCount = this.quality === "high" ? 18 : 8;
        for (let index = 0; index < greebleCount; index += 1) {
            const side = index % 2 ? 1 : -1;
            const z = -this.depth / 2 + 5 + (index / greebleCount) * (this.depth - 10);
            this._box(
                "wall-greeble",
                side * (this.width / 2 - 0.62),
                1.3 + (index % 4) * 0.72,
                z,
                0.22,
                0.3 + (index % 3) * 0.14,
                0.6 + (index % 2) * 0.35,
                index % 5 === 0 ? glow : cable,
                false,
            );
        }

        const ventCount = this.quality === "high" ? 5 : 2;
        for (let index = 0; index < ventCount; index += 1) {
            const side = index % 2 ? 1 : -1;
            const sprite = createSmokeSprite(1.1 + (index % 3) * 0.25, 0.18);
            sprite.position.set(
                side * (this.width / 2 - 0.78),
                3.2,
                -this.depth * 0.34 + index * (this.depth * 0.68 / Math.max(1, ventCount - 1)),
            );
            this.group.add(sprite);
            this.animatedVisuals.push({
                sprite,
                baseY: sprite.position.y,
                phase: index * 1.37,
            });
        }
    }

    _buildLighting() {
        const ambientIntensity = this.quality === "high"
            ? LIGHTING.ambient.intensityHigh
            : LIGHTING.ambient.intensityLow;
        const hemisphereIntensity = this.quality === "high"
            ? LIGHTING.hemisphere.intensityHigh
            : LIGHTING.hemisphere.intensityLow;
        const ambient = new THREE.AmbientLight(LIGHTING.ambient.color, ambientIntensity);
        ambient.name = "base-ambient";
        ambient.userData.baseIntensity = ambientIntensity;
        this.group.add(ambient);
        const hemisphere = new THREE.HemisphereLight(
            LIGHTING.hemisphere.sky,
            LIGHTING.hemisphere.ground,
            hemisphereIntensity,
        );
        hemisphere.name = "base-hemisphere";
        hemisphere.userData.baseIntensity = hemisphereIntensity;
        this.group.add(hemisphere);
        const count = this.quality === "high" ? 8 : 5;
        for (let index = 0; index < count; index += 1) {
            const z = -this.depth / 2 + ((index + 1) * this.depth) / (count + 1);
            const emergency = index % 4 === 2;
            const color = emergency ? 0xff243d : this.config.accent;
            const intensity = emergency
                ? LIGHTING.point.emergencyIntensity
                : LIGHTING.point.normalIntensity;
            const light = new THREE.PointLight(color, intensity, LIGHTING.point.range, 2);
            light.position.set(index % 2 ? -this.width * 0.24 : this.width * 0.24, 4.7, z);
            light.castShadow = this.quality === "high" && index < 3;
            light.userData.flicker = emergency ? 2.8 + index : 0;
            this.group.add(light);
            const fixture = new THREE.Mesh(
                new THREE.BoxGeometry(3.5, 0.12, 0.35),
                this._material(0xffffff, {
                    emissive: color,
                    emissiveIntensity: VISUALS.emissive.fixtureIntensity,
                    metalness: 0.2,
                    roughness: 0.18,
                }),
            );
            fixture.position.copy(light.position).y = 5.22;
            this.group.add(fixture);
        }

        const start = this._playerStart();
        const startLight = new THREE.PointLight(
            this.config.accent,
            LIGHTING.point.startIntensity,
            LIGHTING.point.startRange,
            2,
        );
        startLight.name = "start-bay-light";
        startLight.position.set(0, 4.75, start.z);
        startLight.castShadow = this.quality === "high";
        this.group.add(startLight);
        const startFixture = new THREE.Mesh(
            new THREE.BoxGeometry(3.8, 0.12, 0.7),
            this._material(0xffffff, {
                emissive: this.config.accent,
                emissiveIntensity: VISUALS.emissive.fixtureIntensity,
                metalness: 0.2,
                roughness: 0.18,
            }),
        );
        startFixture.name = "start-bay-fixture";
        startFixture.position.set(0, 5.2, start.z);
        this.group.add(startFixture);
    }

    _buildProps() {
        const layouts = {
            cargo: [
                [-12, -14, 4, 3, 4], [10, -10, 5, 2.8, 3.4], [-8, 8, 3.5, 4, 3.5],
                [12, 13, 6, 3, 3], [0, -2, 4, 3.4, 4],
            ],
            lab: [
                [-14, -13, 8, 2, 3], [13, -13, 7, 2, 3], [-13, 3, 8, 2, 3],
                [13, 4, 7, 2, 3], [0, -4, 3, 3, 3], [0, 14, 10, 1.5, 2],
            ],
            hangar: [
                [-18, -18, 7, 4, 5], [18, -15, 7, 4, 5], [-16, 13, 5, 5, 4],
                [17, 16, 6, 4, 5], [0, -7, 12, 2, 3],
            ],
            reactor: [
                [-18, -18, 5, 5, 5], [18, -18, 5, 5, 5], [-18, 18, 5, 5, 5],
                [18, 18, 5, 5, 5], [0, -14, 8, 2, 3], [0, 14, 8, 2, 3],
            ],
        };
        const propMaterial = this._texturedMaterial(
            "crate",
            2,
            1,
            VISUALS.materials.crate,
        );
        const hazardMaterial = this._texturedMaterial("hazard", 2, 1, {
            emissive: this.config.accent,
            emissiveIntensity: 0.18,
            metalness: 0.32,
            roughness: 0.5,
        });
        layouts[this.config.props].forEach(([x, z, width, height, depth], index) => {
            this._box("obstacle", x, height / 2, z, width, height, depth, propMaterial, true);
            if (this.config.props === "cargo") {
                this._box(
                    "crate-band",
                    x,
                    height * 0.65,
                    z + depth / 2 + 0.02,
                    width * 0.85,
                    0.16,
                    0.08,
                    hazardMaterial,
                    false,
                );
            }
        });

        if (this.config.props === "lab") this._addLabDetails();
        if (this.config.props === "hangar") this._addHangarDetails();
        if (this.config.props === "reactor") this._addReactor();
        this._addPipesAndTerminals();
    }

    _addLabDetails() {
        const glass = new THREE.MeshStandardMaterial({
            color: 0x75ddeb,
            transparent: true,
            opacity: 0.28,
            roughness: 0.12,
            metalness: 0.2,
        });
        for (const x of [-8, 8]) {
            const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3.8, 10), glass);
            tube.position.set(x, 1.9, 11);
            this.group.add(tube);
            this.colliders.push({
                id: `lab-tube-${x}`,
                type: "lab-tube",
                minX: x - 1.3,
                maxX: x + 1.3,
                minZ: 9.7,
                maxZ: 12.3,
            });
        }
    }

    _addHangarDetails() {
        const ship = new THREE.Group();
        const material = this._material(0x3a4651);
        const hull = new THREE.Mesh(new THREE.ConeGeometry(2.5, 10, 4), material);
        hull.rotation.x = Math.PI / 2;
        hull.rotation.z = Math.PI / 4;
        ship.add(hull);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(10, 0.25, 2.6), material);
        wing.position.z = 1.4;
        ship.add(wing);
        ship.position.set(0, 1.5, 18);
        this.group.add(ship);
        this.colliders.push({
            id: "hangar-ship",
            type: "ship",
            minX: -5,
            maxX: 5,
            minZ: 13,
            maxZ: 23,
        });
    }

    _addReactor() {
        const reactor = new THREE.Group();
        const coreMaterial = this._material(0xffffff, {
            emissive: 0xff203f,
            emissiveIntensity: 2.4,
            roughness: 0.2,
        });
        const core = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 8, 16), coreMaterial);
        core.position.y = 2.8;
        reactor.add(core);
        for (let ring = 0; ring < 3; ring += 1) {
            const torus = new THREE.Mesh(
                new THREE.TorusGeometry(4 + ring * 1.6, 0.22, 8, 24),
                this._material(0x4d5960, { emissive: 0xff4057, emissiveIntensity: 0.35 }),
            );
            torus.rotation.x = Math.PI / 2;
            torus.position.y = 1.2 + ring * 1.2;
            reactor.add(torus);
        }
        reactor.position.z = 0;
        this.group.add(reactor);
        this.colliders.push({
            id: "reactor-core",
            type: "reactor",
            minX: -3.1,
            maxX: 3.1,
            minZ: -3.1,
            maxZ: 3.1,
        });
    }

    _addPipesAndTerminals() {
        const pipeMaterial = this._material(0x4b5960);
        for (const side of [-1, 1]) {
            const pipe = new THREE.Mesh(
                new THREE.CylinderGeometry(0.22, 0.22, this.depth - 4, 8),
                pipeMaterial,
            );
            pipe.rotation.x = Math.PI / 2;
            pipe.position.set(side * (this.width / 2 - 0.9), 4.1, 0);
            this.group.add(pipe);
        }
        for (let z = -this.depth / 2 + 7; z < this.depth / 2 - 4; z += 13) {
            const screen = this._box(
                "terminal",
                -this.width / 2 + 0.65,
                2,
                z,
                0.25,
                1.7,
                2.1,
                this._material(0x0d171c),
                true,
            );
            const terminalMaps = getVisuals().textures.getMaps(
                "terminal",
                1,
                1,
                this.config.accent,
            );
            const display = new THREE.Mesh(
                new THREE.PlaneGeometry(1.3, 0.8),
                this._material(0xffffff, {
                    ...terminalMaps,
                    emissive: this.config.accent,
                    emissiveIntensity: VISUALS.emissive.displayIntensity,
                    metalness: 0.15,
                    roughness: 0.22,
                }),
            );
            display.rotation.y = Math.PI / 2;
            display.position.set(screen.position.x + 0.14, 2.15, z);
            this.group.add(display);
        }
    }

    _buildFeatureGeometry() {
        const barrelPoints = [];
        const barrelCount = FEATURES.barrels.countByLevel[this.config.number - 1];
        const candidates = [
            [-this.width * 0.28, -this.depth * 0.18],
            [this.width * 0.3, -this.depth * 0.05],
            [-this.width * 0.25, this.depth * 0.2],
            [this.width * 0.22, this.depth * 0.31],
            [0, -this.depth * 0.32],
        ];
        candidates.slice(0, barrelCount).forEach(([x, z]) => {
            const offsets = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3], [5, 3], [-5, -3]];
            const available = offsets
                .map(([offsetX, offsetZ]) => [x + offsetX, z + offsetZ])
                .find(([candidateX, candidateZ]) => (
                    !this._pointBlocked(candidateX, candidateZ, 1.2)
                    && barrelPoints.every(
                        (point) => Math.hypot(point.x - candidateX, point.z - candidateZ) > 2,
                    )
                ));
            if (available) barrelPoints.push(new THREE.Vector3(available[0], 0.7, available[1]));
        });

        const airlockPosition = this.config.airlock
            ? new THREE.Vector3(this.width / 2 - 1.5, 0, -this.depth * 0.28)
            : null;
        if (airlockPosition) {
            const panel = this._box(
                "airlock-panel",
                airlockPosition.x,
                1.25,
                airlockPosition.z,
                0.55,
                2.5,
                2.2,
                this._texturedMaterial("hazard", 1, 4, {
                    emissive: 0x39ff72,
                    emissiveIntensity: 0.55,
                    metalness: 0.68,
                    roughness: 0.32,
                }),
                true,
            );
            panel.userData.interaction = "airlock";
        }

        const oxygenZone = this.config.oxygenZone
            ? {
                minX: -this.width * 0.42,
                maxX: -this.width * 0.16,
                minZ: -this.depth * 0.42,
                maxZ: -this.depth * 0.14,
            }
            : null;
        if (oxygenZone) {
            const breach = new THREE.PointLight(0x4ab7ff, 5, 12, 2);
            breach.position.set(
                (oxygenZone.minX + oxygenZone.maxX) / 2,
                3.5,
                (oxygenZone.minZ + oxygenZone.maxZ) / 2,
            );
            breach.userData.flicker = 8;
            this.group.add(breach);
        }

        const survivorPoints = [
            new THREE.Vector3(-this.width * 0.36, 0.9, this.depth * 0.28),
            new THREE.Vector3(this.width * 0.35, 0.9, -this.depth * 0.35),
        ].slice(0, FEATURES.survivors.countByLevel[this.config.number - 1]);

        const weaponPoint = this.config.weaponPickup
            ? new THREE.Vector3(this.width * 0.22, 0.7, -this.depth * 0.22)
            : null;
        const ammoPoints = this.config.ammoPickups.map(
            (type, index) => ({
                type,
                position: new THREE.Vector3(
                    (index % 2 ? 1 : -1) * this.width * 0.31,
                    0.65,
                    this.depth * (0.08 + index * 0.1),
                ),
            }),
        );
        const turretKitPoint = this.config.turretKit
            ? new THREE.Vector3(this.width * 0.32, 0.65, this.depth * 0.32)
            : null;
        const oxygenPickupPoint = this.config.oxygenZone
            ? new THREE.Vector3(this.width * 0.3, 0.65, -this.depth * 0.32)
            : null;
        const escapePoint = this.config.number === 4
            ? new THREE.Vector3(this.width * 0.14, 0, this.depth / 2 - 3.8)
            : null;
        if (escapePoint) {
            const routeMaterial = this._texturedMaterial("hazard", 1, 2, {
                color: 0xa9d5b8,
                metalness: 0.38,
                roughness: 0.52,
            });
            for (let z = -this.depth / 2 + 5; z < escapePoint.z - 2; z += 5) {
                this._box(
                    "escape-route",
                    escapePoint.x,
                    0.035,
                    z,
                    0.75,
                    0.06,
                    2.2,
                    routeMaterial,
                    false,
                );
            }
        }

        return {
            barrelPoints,
            airlockPosition,
            oxygenZone,
            survivorPoints,
            weaponPoint,
            ammoPoints,
            turretKitPoint,
            oxygenPickupPoint,
            escapePoint,
        };
    }

    _buildColliderDebug() {
        const material = new THREE.LineBasicMaterial({ color: 0xff35d3 });
        this.colliders.forEach((box) => {
            const width = box.maxX - box.minX;
            const depth = box.maxZ - box.minZ;
            const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 2.2, depth));
            const helper = new THREE.LineSegments(geometry, material);
            helper.position.set((box.minX + box.maxX) / 2, 1.1, (box.minZ + box.maxZ) / 2);
            helper.name = `debug-${box.id}`;
            this.group.add(helper);
        });
        const boundsGeometry = new THREE.EdgesGeometry(
            new THREE.BoxGeometry(this.width - 2, 0.08, this.depth - 2),
        );
        const boundsHelper = new THREE.LineSegments(
            boundsGeometry,
            new THREE.LineBasicMaterial({ color: 0x35ff8b }),
        );
        boundsHelper.position.y = 0.08;
        boundsHelper.name = "debug-world-bounds";
        this.group.add(boundsHelper);
    }

    _buildWindowsAndStars() {
        const starsGeometry = new THREE.BufferGeometry();
        const positions = [];
        for (let index = 0; index < 240; index += 1) {
            positions.push(
                (this.random() - 0.5) * 150,
                this.random() * 60 + 3,
                (this.random() - 0.5) * 150,
            );
        }
        starsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        const stars = new THREE.Points(
            starsGeometry,
            new THREE.PointsMaterial({ color: 0xd9f6ff, size: 0.16, sizeAttenuation: true }),
        );
        this.group.add(stars);

        const windowMaterial = new THREE.MeshBasicMaterial({
            color: 0x0b2538,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
        });
        for (const z of [-this.depth * 0.28, this.depth * 0.12]) {
            const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.4), windowMaterial);
            windowMesh.rotation.y = Math.PI / 2;
            windowMesh.position.set(this.width / 2 - 0.31, 3, z);
            this.group.add(windowMesh);
        }
    }

    _createSpawnPoints() {
        const edgeMargin = 4;
        const start = this._playerStart();
        const targetCount = 32;
        const maxAttempts = 160;
        for (let index = 0; index < maxAttempts && this.spawnPoints.length < targetCount; index += 1) {
            const x = (this.random() - 0.5) * (this.width - edgeMargin * 2);
            const z = (this.random() - 0.5) * (this.depth - edgeMargin * 2);
            const distanceFromStart = Math.hypot(x - start.x, z - start.z);
            if (
                distanceFromStart >= SPAWN_SAFE_RADIUS
                && !this._pointBlocked(x, z, 1.6)
                && z < this.depth / 2 - 9
            ) {
                this.spawnPoints.push(new THREE.Vector3(x, 0, z));
            }
        }
        const candidates = [
            [-this.width * 0.35, -this.depth * 0.3],
            [this.width * 0.35, -this.depth * 0.25],
            [-this.width * 0.34, this.depth * 0.08],
            [this.width * 0.34, this.depth * 0.22],
            [0, -this.depth * 0.38],
            [0, this.depth * 0.3],
        ];
        this.pickupPoints = candidates
            .filter(([x, z]) => !this._pointBlocked(x, z, 1.2))
            .slice(0, this.config.pickups)
            .map(([x, z]) => new THREE.Vector3(x, 0.65, z));
    }

    _pointBlocked(x, z, padding) {
        return this.colliders.some(
            (box) => x > box.minX - padding
                && x < box.maxX + padding
                && z > box.minZ - padding
                && z < box.maxZ + padding,
        );
    }

    update(elapsed) {
        this.group.children.forEach((child) => {
            if (child.isPointLight && child.userData.flicker) {
                child.intensity = LIGHTING.point.flickerBase
                    + Math.sin(elapsed * child.userData.flicker * 9)
                        * LIGHTING.point.flickerAmplitude;
            }
        });
        this.animatedVisuals.forEach(({ sprite, baseY, phase }) => {
            const cycle = (elapsed * 0.32 + phase) % 1;
            sprite.position.y = baseY + cycle * 1.6;
            sprite.material.opacity = Math.sin(cycle * Math.PI) * 0.2;
            sprite.scale.setScalar(0.8 + cycle * 1.25);
        });
    }

    setBrightness(scale) {
        this.group.traverse((child) => {
            if ((child.isAmbientLight || child.isHemisphereLight) && child.userData.baseIntensity) {
                child.intensity = child.userData.baseIntensity * scale;
            }
        });
    }

    dispose() {
        disposeObject3D(this.group);
        this.scene.fog = null;
    }
}
