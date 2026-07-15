import * as THREE from "three";
import {
    CEILING_Y,
    FEATURES,
    FLOOR_Y,
    GAME_CONFIG,
    LIGHTING,
    MIN_CEILING,
    SPAWN_SAFE_RADIUS,
    STATION_DEFAULTS,
    VISUALS,
} from "./config.js";
import { createSmokeSprite, disposeObject3D, getVisuals } from "./visual-utils.js";

export function seededRandom(seed) {
    let value = seed % 2147483647;
    if (value <= 0) value += 2147483646;
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
        this.floorPoints = [];
        this.moduleCenters = [];
        this.random = seededRandom(options.seed ?? config.number * 9137);
        this.seed = options.seed ?? config.number * 9137;
        this.debug = Boolean(options.debug);
        this.layout = { ...STATION_DEFAULTS, ...(config.layout || {}) };
        this.animatedVisuals = [];
        this.ceilingY = CEILING_Y;
        this.floorY = FLOOR_Y;
        this.bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    }

    build() {
        this.scene.background = new THREE.Color(this.config.fog);
        this.scene.fog = new THREE.Fog(
            this.config.fog,
            this.quality === "high" ? LIGHTING.fog.high.near : LIGHTING.fog.low.near,
            this.quality === "high" ? LIGHTING.fog.high.far : LIGHTING.fog.low.far,
        );
        this.scene.add(this.group);
        this._buildTorusRing();
        (this.layout.modules || []).forEach((moduleSpec) => {
            this._buildDockTunnel(moduleSpec.angle);
            this._buildModule(moduleSpec.type, moduleSpec.angle);
        });
        if (this.layout.bossArena) this._buildBossDome();
        this._buildStartBay();
        this._buildLighting();
        this._buildStars();
        this._collectFloorPoints();
        this._createSpawnPoints();
        const features = this._buildFeatureGeometry();
        if (this.debug) this._buildColliderDebug();
        this._finalizeBounds();
        return {
            colliders: this.colliders,
            spawnPoints: this.spawnPoints,
            pickupPoints: this.pickupPoints,
            floorPoints: this.floorPoints,
            bounds: { ...this.bounds },
            playerStart: this._playerStart(),
            floorY: this.floorY,
            ceilingY: this.ceilingY,
            moduleCenters: this.moduleCenters.map((center) => center.clone()),
            seed: this.seed,
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

    _expandBounds(x, z, margin = 1) {
        this.bounds.minX = Math.min(this.bounds.minX, x - margin);
        this.bounds.maxX = Math.max(this.bounds.maxX, x + margin);
        this.bounds.minZ = Math.min(this.bounds.minZ, z - margin);
        this.bounds.maxZ = Math.max(this.bounds.maxZ, z + margin);
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

    _addCylindricalWalls(name, cx, cz, radius, length, angle, material, solid = true) {
        const segments = this.quality === "high" ? 10 : 8;
        const step = length / segments;
        for (let index = 0; index < segments; index += 1) {
            const localZ = -length / 2 + step * (index + 0.5);
            const x = cx + Math.sin(angle) * localZ;
            const z = cz + Math.cos(angle) * localZ;
            for (const side of [-1, 1]) {
                const wallX = x + Math.cos(angle) * side * radius;
                const wallZ = z - Math.sin(angle) * side * radius;
                this._box(
                    `${name}-wall`,
                    wallX,
                    MIN_CEILING / 2,
                    wallZ,
                    0.55,
                    MIN_CEILING,
                    step * 0.92,
                    material,
                    solid,
                );
            }
        }
    }

    _buildTorusRing() {
        const floor = this._texturedMaterial("floor", 4, 4, VISUALS.materials.floor);
        const wall = this._texturedMaterial("wall", 2, 2, VISUALS.materials.wall);
        const trim = this._material(this.config.accent, {
            emissive: this.config.accent,
            emissiveIntensity: VISUALS.emissive.stripIntensity * 0.55,
            ...VISUALS.materials.trim,
        });
        const { ringRadius, corridorWidth, ringSegments } = this.layout;
        const inner = ringRadius - corridorWidth / 2;
        const outer = ringRadius + corridorWidth / 2;
        const arcLen = (Math.PI * 2 * ringRadius) / ringSegments;

        for (let index = 0; index < ringSegments; index += 1) {
            const angle = (index / ringSegments) * Math.PI * 2;
            const cx = Math.sin(angle) * ringRadius;
            const cz = Math.cos(angle) * ringRadius;
            const nextAngle = ((index + 1) / ringSegments) * Math.PI * 2;
            const nx = Math.sin(nextAngle) * ringRadius;
            const nz = Math.cos(nextAngle) * ringRadius;
            const midX = (cx + nx) / 2;
            const midZ = (cz + nz) / 2;
            const segAngle = Math.atan2(nx - cx, nz - cz);
            this._box("ring-floor", midX, FLOOR_Y - 0.2, midZ, corridorWidth - 0.4, 0.45, arcLen * 1.05, floor, false);
            this._expandBounds(midX, midZ, corridorWidth);

            if (index % 3 === 1) {
                const window = new THREE.Mesh(
                    new THREE.PlaneGeometry(2.8, 2.2),
                    new THREE.MeshBasicMaterial({
                        color: 0x0b2538,
                        transparent: true,
                        opacity: 0.55,
                        side: THREE.DoubleSide,
                    }),
                );
                window.position.set(
                    Math.sin(angle) * (outer + 0.05),
                    MIN_CEILING * 0.55,
                    Math.cos(angle) * (outer + 0.05),
                );
                window.lookAt(0, window.position.y, 0);
                this.group.add(window);
            } else {
                this._box(
                    "ring-outer",
                    Math.sin(angle) * outer,
                    MIN_CEILING / 2,
                    Math.cos(angle) * outer,
                    0.55,
                    MIN_CEILING,
                    arcLen * 0.95,
                    wall,
                    true,
                );
            }

            this._box(
                "ring-inner",
                Math.sin(angle) * inner,
                MIN_CEILING / 2,
                Math.cos(angle) * inner,
                0.55,
                MIN_CEILING,
                arcLen * 0.95,
                wall,
                true,
            );
            this._box("ring-trim", midX, 0.35, midZ, 0.12, 0.12, arcLen * 0.9, trim, false);
        }

        this._box("ring-ceiling", 0, MIN_CEILING + 0.15, 0, outer * 2.2, 0.35, outer * 2.2, wall, false);
    }

    _buildDockTunnel(angle) {
        const wall = this._texturedMaterial("wall", 2, 2, VISUALS.materials.wall);
        const floor = this._texturedMaterial("floor", 2, 2, VISUALS.materials.floor);
        const { ringRadius, tunnelLength, tunnelWidth, partitionDepth } = this.layout;
        const startR = ringRadius + this.layout.corridorWidth / 2 - 0.5;
        const endR = startR + tunnelLength;
        const midR = (startR + endR) / 2;
        const cx = Math.sin(angle) * midR;
        const cz = Math.cos(angle) * midR;
        this._box("tunnel-floor", cx, FLOOR_Y - 0.18, cz, tunnelWidth, 0.4, tunnelLength, floor, false);
        this._addCylindricalWalls("tunnel", cx, cz, tunnelWidth / 2, tunnelLength, angle, wall, true);
        const partitionR = startR + partitionDepth;
        const px = Math.sin(angle) * partitionR;
        const pz = Math.cos(angle) * partitionR;
        this._box(
            "tunnel-partition",
            px,
            MIN_CEILING * 0.45,
            pz,
            tunnelWidth * 0.85,
            MIN_CEILING * 0.9,
            0.55,
            wall,
            true,
        );
        const portal = new THREE.Mesh(
            new THREE.RingGeometry(tunnelWidth * 0.32, tunnelWidth * 0.42, 16),
            this._material(this.config.accent, {
                emissive: this.config.accent,
                emissiveIntensity: 0.8,
            }),
        );
        portal.rotation.x = -Math.PI / 2;
        portal.position.set(px, MIN_CEILING * 0.52, pz);
        this.group.add(portal);
        this._expandBounds(cx, cz, tunnelWidth + 2);
    }

    _buildModule(type, angle) {
        const wall = this._texturedMaterial("wall", 2, 2, VISUALS.materials.wall);
        const floor = this._texturedMaterial("floor", 3, 3, VISUALS.materials.floor);
        const prop = this._texturedMaterial("crate", 1.5, 1.5, VISUALS.materials.crate);
        const { ringRadius, tunnelLength, moduleLength, moduleRadius } = this.layout;
        const centerR = ringRadius + tunnelLength + moduleLength / 2 + 1;
        const cx = Math.sin(angle) * centerR;
        const cz = Math.cos(angle) * centerR;
        this.moduleCenters.push(new THREE.Vector3(cx, GAME_CONFIG.player.height, cz));
        this._box("module-floor", cx, FLOOR_Y - 0.2, cz, moduleRadius * 2, 0.45, moduleLength, floor, false);
        this._addCylindricalWalls("module", cx, cz, moduleRadius, moduleLength, angle, wall, true);
        this._expandBounds(cx, cz, moduleRadius + 2);

        const rackCount = type === "cupola" ? 4 : 6;
        for (let index = 0; index < rackCount; index += 1) {
            const side = index % 2 ? 1 : -1;
            const offset = -moduleLength / 2 + 2 + index * (moduleLength / (rackCount + 1));
            const rx = cx + Math.sin(angle) * offset + Math.cos(angle) * side * (moduleRadius - 1.1);
            const rz = cz + Math.cos(angle) * offset - Math.sin(angle) * side * (moduleRadius - 1.1);
            this._box("module-rack", rx, 1.1, rz, 1.4, 2.2, 0.65, prop, true);
            this._box("module-rail", rx, 0.9, rz - side * 0.5, 0.08, 0.08, 1.2, wall, false);
        }

        if (type === "cupola" || type === "greenhouse") {
            for (let index = 0; index < 3; index += 1) {
                const px = cx + Math.cos(angle) * (moduleRadius - 0.2);
                const pz = cz - Math.sin(angle) * (moduleRadius - 0.2);
                const pane = new THREE.Mesh(
                    new THREE.PlaneGeometry(2.4, 2.8),
                    new THREE.MeshBasicMaterial({
                        color: 0x143248,
                        transparent: true,
                        opacity: 0.42,
                        side: THREE.DoubleSide,
                    }),
                );
                pane.position.set(px, MIN_CEILING * 0.55, pz + index * 0.01);
                pane.lookAt(cx, pane.position.y, cz);
                this.group.add(pane);
            }
            if (type === "cupola") {
                for (let index = 0; index < 4; index += 1) {
                    const panelAngle = angle + (index - 1.5) * 0.35;
                    const px = cx + Math.sin(panelAngle) * (centerR + 2.5);
                    const pz = cz + Math.cos(panelAngle) * (centerR + 2.5);
                    this._box("solar-panel", px, MIN_CEILING + 1.2, pz, 2.2, 0.08, 1.4, prop, false);
                }
            }
        }

        if (type === "reactor") this._addReactorCore(cx, cz);
        if (type === "hangar") this._addHangarShip(cx, cz);
        if (type === "lab" || type === "greenhouse") this._addLabTubes(cx, cz, angle);
    }

    _buildBossDome() {
        const dome = this._material(0x2a353c, {
            metalness: 0.7,
            roughness: 0.35,
            transparent: true,
            opacity: 0.22,
        });
        const radius = this.layout.ringRadius * 0.55;
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(radius, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
            dome,
        );
        mesh.position.y = MIN_CEILING;
        this.group.add(mesh);
    }

    _addReactorCore(cx, cz) {
        const coreMaterial = this._material(0xffffff, {
            emissive: 0xff203f,
            emissiveIntensity: 2.4,
            roughness: 0.2,
        });
        this._box("reactor-core", cx, 2.8, cz, 4.6, 5.6, 4.6, coreMaterial, true);
    }

    _addHangarShip(cx, cz) {
        const material = this._material(0x3a4651);
        const hull = new THREE.Mesh(new THREE.ConeGeometry(2.5, 10, 4), material);
        hull.rotation.x = Math.PI / 2;
        hull.rotation.z = Math.PI / 4;
        hull.position.set(cx, 1.5, cz + 3);
        this.group.add(hull);
        this.colliders.push({
            id: "hangar-ship",
            type: "ship",
            minX: cx - 5,
            maxX: cx + 5,
            minZ: cz - 2,
            maxZ: cz + 8,
        });
    }

    _addLabTubes(cx, cz, angle) {
        const glass = new THREE.MeshStandardMaterial({
            color: 0x75ddeb,
            transparent: true,
            opacity: 0.28,
            roughness: 0.12,
            metalness: 0.2,
        });
        for (const side of [-1, 1]) {
            const tx = cx + Math.cos(angle) * side * 2.5;
            const tz = cz - Math.sin(angle) * side * 2.5;
            const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 3.4, 10), glass);
            tube.position.set(tx, 1.7, tz);
            this.group.add(tube);
            this.colliders.push({
                id: `lab-tube-${side}`,
                type: "lab-tube",
                minX: tx - 1.2,
                maxX: tx + 1.2,
                minZ: tz - 1.2,
                maxZ: tz + 1.2,
            });
        }
    }

    _playerStart() {
        const angle = (this.layout.modules?.[0]?.angle ?? 0) + Math.PI;
        const r = this.layout.ringRadius - this.layout.corridorWidth * 0.15;
        return new THREE.Vector3(
            Math.sin(angle) * r,
            GAME_CONFIG.player.height,
            Math.cos(angle) * r,
        );
    }

    _buildStartBay() {
        const start = this._playerStart();
        const frame = this._material(0x263239, { metalness: 0.82, roughness: 0.3 });
        const marker = this._texturedMaterial("hazard", 2, 1, { metalness: 0.34, roughness: 0.58 });
        for (const side of [-1, 1]) {
            this._box("start-bay-side", start.x + side * 3.2, MIN_CEILING / 2, start.z, 0.18, MIN_CEILING * 0.95, 4.5, frame, false);
        }
        this._box("start-bay-canopy", start.x, MIN_CEILING - 0.35, start.z, 6.8, 0.2, 4.5, frame, false);
        for (const offset of [-2.4, 2.4]) {
            this._box("start-bay-marker", start.x + offset, 0.045, start.z, 0.55, 0.05, 0.9, marker, false);
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
        ambient.userData.baseIntensity = ambientIntensity;
        this.group.add(ambient);
        const hemisphere = new THREE.HemisphereLight(
            LIGHTING.hemisphere.sky,
            LIGHTING.hemisphere.ground,
            hemisphereIntensity,
        );
        hemisphere.userData.baseIntensity = hemisphereIntensity;
        this.group.add(hemisphere);

        const count = this.quality === "high" ? 10 : 6;
        for (let index = 0; index < count; index += 1) {
            const angle = (index / count) * Math.PI * 2;
            const r = this.layout.ringRadius + (index % 2 ? 4 : -2);
            const emergency = index % 4 === 2;
            const color = emergency ? 0xff243d : this.config.accent;
            const intensity = emergency
                ? LIGHTING.point.emergencyIntensity
                : LIGHTING.point.normalIntensity;
            const light = new THREE.PointLight(color, intensity, LIGHTING.point.range, 2);
            light.position.set(Math.sin(angle) * r, MIN_CEILING - 0.8, Math.cos(angle) * r);
            light.castShadow = this.quality === "high" && index < 2;
            light.userData.flicker = emergency ? 2.8 + index : 0;
            this.group.add(light);
        }

        const start = this._playerStart();
        const startLight = new THREE.PointLight(
            this.config.accent,
            LIGHTING.point.startIntensity,
            LIGHTING.point.startRange,
            2,
        );
        startLight.position.set(start.x, MIN_CEILING - 0.75, start.z);
        this.group.add(startLight);
    }

    _buildStars() {
        const starsGeometry = new THREE.BufferGeometry();
        const positions = [];
        for (let index = 0; index < 240; index += 1) {
            positions.push(
                (this.random() - 0.5) * 180,
                this.random() * 70 + MIN_CEILING,
                (this.random() - 0.5) * 180,
            );
        }
        starsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        this.group.add(new THREE.Points(
            starsGeometry,
            new THREE.PointsMaterial({ color: 0xd9f6ff, size: 0.16, sizeAttenuation: true }),
        ));
    }

    _collectFloorPoints() {
        const step = 2;
        for (let x = this.bounds.minX + 1; x <= this.bounds.maxX - 1; x += step) {
            for (let z = this.bounds.minZ + 1; z <= this.bounds.maxZ - 1; z += step) {
                if (!this._pointBlocked(x, z, 0.85)) {
                    this.floorPoints.push(new THREE.Vector3(x, 0, z));
                }
            }
        }
    }

    _pickRandomFloorPoints(count, minSpacing, constraints = {}) {
        const start = this._playerStart();
        const points = [];
        const pool = [...this.floorPoints];
        for (let index = pool.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(this.random() * (index + 1));
            [pool[index], pool[swap]] = [pool[swap], pool[index]];
        }
        pool.forEach((candidate) => {
            if (points.length >= count) return;
            if (Math.hypot(candidate.x - start.x, candidate.z - start.z) < SPAWN_SAFE_RADIUS) return;
            if (constraints.moduleOnly && !this._isInSideModule(candidate.x, candidate.z)) return;
            if (points.some((point) => Math.hypot(point.x - candidate.x, point.z - candidate.z) < minSpacing)) {
                return;
            }
            points.push(candidate.clone());
        });
        return points;
    }

    _isInSideModule(x, z) {
        return this.moduleCenters.some((center) => (
            Math.hypot(center.x - x, center.z - z) < this.layout.moduleRadius + 2
        ));
    }

    _createSpawnPoints() {
        this.spawnPoints = this._pickRandomFloorPoints(40, 3.5);
        this.pickupPoints = this._pickRandomFloorPoints(this.config.pickups, 4);
    }

    _buildFeatureGeometry() {
        const barrelPoints = this._pickRandomFloorPoints(
            FEATURES.barrels.countByLevel[this.config.number - 1],
            3,
        ).map((point) => new THREE.Vector3(point.x, 0.7, point.z));

        const airlockAngle = this.layout.modules?.[0]?.angle ?? 0;
        const airlockPosition = this.config.airlock
            ? new THREE.Vector3(
                Math.sin(airlockAngle) * (this.layout.ringRadius + 2),
                0,
                Math.cos(airlockAngle) * (this.layout.ringRadius + 2),
            )
            : null;
        if (airlockPosition) {
            this._box(
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
                }),
                true,
            ).userData.interaction = "airlock";
        }

        const oxygenZone = this.config.oxygenZone
            ? {
                minX: this.bounds.minX + 4,
                maxX: this.bounds.minX + 14,
                minZ: this.bounds.minZ + 4,
                maxZ: this.bounds.minZ + 14,
            }
            : null;

        const survivorCount = FEATURES.survivors.countByLevel[this.config.number - 1];
        const survivorPoints = this._pickRandomFloorPoints(survivorCount, 5, { moduleOnly: true })
            .map((point) => new THREE.Vector3(point.x, 0.9, point.z));

        const weaponCandidates = this._pickRandomFloorPoints(1, 0);
        const weaponPoint = this.config.weaponPickup && weaponCandidates[0]
            ? new THREE.Vector3(weaponCandidates[0].x, 0.7, weaponCandidates[0].z)
            : null;

        const ammoCandidates = this._pickRandomFloorPoints(this.config.ammoPickups.length, 4);
        const ammoPoints = this.config.ammoPickups.map((type, index) => ({
            type,
            position: ammoCandidates[index]
                ? new THREE.Vector3(ammoCandidates[index].x, 0.65, ammoCandidates[index].z)
                : new THREE.Vector3(0, 0.65, 0),
        }));

        const turretCandidates = this._pickRandomFloorPoints(1, 0);
        const turretKitPoint = this.config.turretKit && turretCandidates[0]
            ? new THREE.Vector3(turretCandidates[0].x, 0.65, turretCandidates[0].z)
            : null;

        const oxygenCandidates = this._pickRandomFloorPoints(1, 0);
        const oxygenPickupPoint = this.config.oxygenZone && oxygenCandidates[0]
            ? new THREE.Vector3(oxygenCandidates[0].x, 0.65, oxygenCandidates[0].z)
            : null;

        const start = this._playerStart();
        const escapePoint = this.config.number === 9
            ? new THREE.Vector3(start.x, 0, start.z)
            : null;

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
            bossArena: this.layout.bossArena
                ? { center: new THREE.Vector3(0, 0, 0), radius: this.layout.ringRadius * 0.45 }
                : null,
        };
    }

    _buildColliderDebug() {
        const material = new THREE.LineBasicMaterial({ color: 0xff35d3 });
        this.colliders.forEach((box) => {
            const width = box.maxX - box.minX;
            const depth = box.maxZ - box.minZ;
            const helper = new THREE.LineSegments(
                new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 2.2, depth)),
                material,
            );
            helper.position.set((box.minX + box.maxX) / 2, 1.1, (box.minZ + box.maxZ) / 2);
            this.group.add(helper);
        });
    }

    _pointBlocked(x, z, padding) {
        return this.colliders.some(
            (box) => x > box.minX - padding
                && x < box.maxX + padding
                && z > box.minZ - padding
                && z < box.maxZ + padding,
        );
    }

    _finalizeBounds() {
        const pad = GAME_CONFIG.player.radius + 0.5;
        this.bounds.minX += pad;
        this.bounds.maxX -= pad;
        this.bounds.minZ += pad;
        this.bounds.maxZ -= pad;
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