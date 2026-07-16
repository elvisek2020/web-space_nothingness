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
import { createCollider, isInsideSegmentParts } from "./collision.js";
import { isOnWalkableFloor } from "./floor-walk.js";
import { buildStationLayout } from "./station-layout.js";
import {
    buildSegmentGeometryAndColliders,
    emitWorldColliders,
    placeSegment,
} from "./station-segment.js";
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
        this.segmentParts = [];
        this.propColliders = [];
        this.spawnPoints = [];
        this.pickupPoints = [];
        this.floorPoints = [];
        this.floorMeshes = [];
        this.moduleCenters = [];
        this.random = seededRandom(options.seed ?? config.number * 9137);
        this.seed = options.seed ?? config.number * 9137;
        this.debug = Boolean(options.debug);
        this.station = buildStationLayout(config.layout || {});
        this.layout = {
            ...STATION_DEFAULTS,
            ...(config.layout || {}),
            modules: this.station.modules.map((mod) => ({
                type: mod.type,
                angle: mod.angle,
            })),
        };
        this.animatedVisuals = [];
        this.ceilingY = CEILING_Y;
        this.floorY = FLOOR_Y;
        this.bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        this.layoutValidation = null;
    }

    build() {
        this.scene.background = new THREE.Color(this.config.fog);
        this.scene.fog = new THREE.Fog(
            this.config.fog,
            this.quality === "high" ? LIGHTING.fog.high.near : LIGHTING.fog.low.near,
            this.quality === "high" ? LIGHTING.fog.high.far : LIGHTING.fog.low.far,
        );
        this.scene.add(this.group);
        this.layoutValidation = this.station.validate();
        if (this.debug) {
            console.info("[ORION-9] station layout validation", this.layoutValidation);
            if (!this.layoutValidation.ok) {
                console.warn("[ORION-9] layout errors", this.layoutValidation.errors);
            }
        }
        this._buildRingSegments();
        this.station.tunnels.forEach((tunnel) => this._buildTunnel(tunnel));
        this.station.modules.forEach((mod) => this._buildModule(mod));
        if (this.station.hasBossArena) this._buildBossDome();
        this._buildHullShell();
        this._buildStartBay();
        this._buildLighting();
        this._buildStars();
        this._collectFloorPoints();
        this._createSpawnPoints();
        const features = this._buildFeatureGeometry();
        if (this.debug) {
            this._buildColliderDebug();
            this._buildNavDebug();
        }
        this._finalizeBounds();
        const playerStart = this._playerStart();
        return {
            colliders: this.colliders,
            segmentParts: this.segmentParts,
            spawnPoints: this.spawnPoints,
            pickupPoints: this.pickupPoints,
            floorPoints: this.floorPoints,
            floorMeshes: this.floorMeshes,
            layout: { ...this.layout, modules: this.layout.modules },
            layoutGraph: this.station,
            navNodes: this.station.navNodes.map((node) => ({ ...node })),
            layoutValidation: this.layoutValidation,
            bounds: { ...this.bounds },
            playerStart,
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

    _segmentMaterials() {
        return {
            floor: this._texturedMaterial("floor", 4, 4, VISUALS.materials.floor),
            wall: this._texturedMaterial("wall", 2, 2, VISUALS.materials.wall),
            ceiling: this._texturedMaterial("wall", 2, 2, VISUALS.materials.wall),
        };
    }

    _expandBounds(x, z, margin = 1) {
        this.bounds.minX = Math.min(this.bounds.minX, x - margin);
        this.bounds.maxX = Math.max(this.bounds.maxX, x + margin);
        this.bounds.minZ = Math.min(this.bounds.minZ, z - margin);
        this.bounds.maxZ = Math.max(this.bounds.maxZ, z + margin);
    }

    _box(name, x, y, z, width, height, depth, material, solid = true, yaw = 0) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        mesh.name = name;
        mesh.position.set(x, y, z);
        mesh.rotation.y = yaw;
        mesh.castShadow = this.quality === "high";
        mesh.receiveShadow = true;
        this.group.add(mesh);
        if (solid) {
            const collider = createCollider({
                id: `${name}-${this.colliders.length}`,
                type: name,
                cx: x,
                cz: z,
                halfW: width / 2,
                halfD: depth / 2,
                yaw: 0,
            });
            this.propColliders.push(collider);
            this.colliders.push(collider);
        }
        return mesh;
    }

    _addPropCollider(type, cx, cz, halfW, halfD) {
        const collider = createCollider({
            id: `${type}-${this.propColliders.length}`,
            type,
            cx,
            cz,
            halfW,
            halfD,
            yaw: 0,
        });
        this.propColliders.push(collider);
        this.colliders.push(collider);
        return collider;
    }

    _localToWorld(lx, lz, transform) {
        const cos = Math.cos(transform.yaw);
        const sin = Math.sin(transform.yaw);
        return {
            x: transform.x + lx * cos + lz * sin,
            z: transform.z - lx * sin + lz * cos,
        };
    }

    _buildAndPlaceSegment(def, transform) {
        const built = buildSegmentGeometryAndColliders({
            ...def,
            materials: this._segmentMaterials(),
        });
        const placed = placeSegment(built, transform, this.group);
        this.segmentParts.push(placed);
        emitWorldColliders(placed, def.id).forEach((collider) => {
            this.colliders.push(collider);
        });
        this._expandBounds(transform.x, transform.z, (def.width ?? 4) + 2);
        return placed;
    }

    _collectSegmentFloors(placed) {
        placed.group.traverse((child) => {
            if (child.isMesh && child.name === "seg-floor") {
                child.userData.walkable = true;
                this.floorMeshes.push(child);
            }
        });
    }

    _buildRingSegments() {
        const kick = this._material(this.config.accent, {
            emissive: this.config.accent,
            emissiveIntensity: VISUALS.emissive.stripIntensity * 0.4,
            ...VISUALS.materials.trim,
        });
        const wall = this._segmentMaterials().wall;

        this.station.ring.segments.forEach((seg) => {
            const placed = this._buildAndPlaceSegment({
                id: seg.id,
                orientation: "tangential",
                length: seg.length,
                width: seg.width,
                openEnds: seg.openEnds,
                openOuter: seg.openOuter,
                openingWidth: seg.openingWidth,
            }, { x: seg.cx, z: seg.cz, yaw: seg.yaw });

            this._collectSegmentFloors(placed);

            if (seg.hasWindow) {
                this._addRingWindow(seg, wall);
            }

            const { outer } = this.station.ring;
            this._box(
                "ring-kick-outer",
                Math.sin(seg.midAngle) * (outer - 0.15),
                0.12,
                Math.cos(seg.midAngle) * (outer - 0.15),
                seg.length * 0.9,
                0.18,
                0.08,
                kick,
                false,
                seg.yaw,
            );
            this._box(
                "ring-kick-inner",
                Math.sin(seg.midAngle) * (this.station.ring.inner + 0.15),
                0.12,
                Math.cos(seg.midAngle) * (this.station.ring.inner + 0.15),
                seg.length * 0.9,
                0.18,
                0.08,
                kick,
                false,
                seg.yaw,
            );
        });
    }

    _addRingWindow(seg, wall) {
        const { outer } = this.station.ring;
        const yaw = seg.midAngle;
        this._box(
            "ring-outer-sill",
            Math.sin(yaw) * (outer + 0.2),
            0.55,
            Math.cos(yaw) * (outer + 0.2),
            seg.length * 1.02,
            1.1,
            0.55,
            wall,
            false,
            yaw,
        );
        this._box(
            "ring-outer-header",
            Math.sin(yaw) * (outer + 0.2),
            MIN_CEILING - 0.55,
            Math.cos(yaw) * (outer + 0.2),
            seg.length * 1.02,
            1.1,
            0.55,
            wall,
            false,
            yaw,
        );
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
            Math.sin(yaw) * (outer + 0.05),
            MIN_CEILING * 0.55,
            Math.cos(yaw) * (outer + 0.05),
        );
        window.lookAt(0, window.position.y, 0);
        this.group.add(window);
    }

    _buildTunnel(tunnel) {
        this._buildAndPlaceSegment({
            id: tunnel.id,
            orientation: "radial",
            length: tunnel.length,
            width: tunnel.width,
            openInnerEnd: true,
            openOuterEnd: true,
        }, { x: tunnel.cx, z: tunnel.cz, yaw: tunnel.yaw });

        const { opening } = tunnel;
        const portal = new THREE.Mesh(
            new THREE.RingGeometry(opening.width * 0.38, opening.width * 0.48, 16),
            this._material(this.config.accent, {
                emissive: this.config.accent,
                emissiveIntensity: 0.8,
            }),
        );
        portal.rotation.y = opening.yaw;
        portal.position.set(opening.x, opening.height * 0.52, opening.z);
        this.group.add(portal);
    }

    _buildModule(mod) {
        const wall = this._texturedMaterial("wall", 2, 2, VISUALS.materials.wall);
        const prop = this._texturedMaterial("crate", 1.5, 1.5, VISUALS.materials.crate);
        const { type, angle, center, length, radius, centerR } = mod;
        const cx = center.x;
        const cz = center.z;
        this.moduleCenters.push(new THREE.Vector3(cx, GAME_CONFIG.player.height, cz));

        this._buildAndPlaceSegment({
            id: mod.id,
            orientation: "radial",
            length: mod.length,
            width: mod.width,
            openInnerEnd: true,
            openOuterEnd: false,
            openingWidth: mod.portal?.width ?? this.station.openingWidth,
        }, { x: mod.cx, z: mod.cz, yaw: mod.yaw });

        const transform = { x: mod.cx, z: mod.cz, yaw: mod.yaw };
        const rackCount = type === "cupola" ? 4 : 6;
        for (let index = 0; index < rackCount; index += 1) {
            const side = index % 2 ? 1 : -1;
            const localZ = -length / 2 + 2 + index * (length / (rackCount + 1));
            const localX = side * (radius - 1.1);
            const world = this._localToWorld(localX, localZ, transform);
            this._box("module-rack", world.x, 1.1, world.z, 1.4, 2.2, 0.65, prop, true, angle);
            const railWorld = this._localToWorld(localX, localZ - side * 0.5, transform);
            this._box("module-rail", railWorld.x, 0.9, railWorld.z, 0.08, 0.08, 1.2, wall, false, angle);
        }

        if (type === "cupola" || type === "greenhouse") {
            for (let index = 0; index < 3; index += 1) {
                const px = cx + Math.cos(angle) * (radius - 0.2);
                const pz = cz - Math.sin(angle) * (radius - 0.2);
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
                    this._box("solar-panel", px, MIN_CEILING + 1.2, pz, 2.2, 0.08, 1.4, prop, false, panelAngle);
                }
            }
        }

        if (type === "reactor") this._addReactorCore(cx, cz);
        if (type === "hangar") this._addHangarShip(cx, cz, angle);
        if (type === "lab" || type === "greenhouse") this._addLabTubes(cx, cz, angle);
    }

    _buildBossDome() {
        const anchor = this.station.bossAnchor;
        if (!anchor) return;
        const bossMod = this.station.modules.find((mod) => mod.id === anchor.moduleId);
        const dome = this._material(0x2a353c, {
            metalness: 0.7,
            roughness: 0.35,
            transparent: true,
            opacity: 0.22,
        });
        const radius = (bossMod?.radius ?? 5.5) * 1.35;
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(radius, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
            dome,
        );
        mesh.position.set(anchor.x, MIN_CEILING, anchor.z);
        this.group.add(mesh);
    }

    _buildHullShell() {
        const wall = this._material(0x111111, { transparent: true, opacity: 0 });
        const { segments, hullRadius, segmentLength } = this.station.ring;
        segments.forEach((seg) => {
            const hx = Math.sin(seg.midAngle) * hullRadius;
            const hz = Math.cos(seg.midAngle) * hullRadius;
            this._box(
                "hull-shell",
                hx,
                MIN_CEILING / 2,
                hz,
                segmentLength * 1.05,
                MIN_CEILING + 1,
                0.7,
                wall,
                false,
                0,
            );
            this.colliders.push(createCollider({
                id: `hull-shell-${seg.index}`,
                type: "hull-shell",
                cx: hx,
                cz: hz,
                halfW: (segmentLength * 1.05) / 2,
                halfD: 0.35,
                yaw: 0,
            }));
        });
    }

    _addReactorCore(cx, cz) {
        const coreMaterial = this._material(0xffffff, {
            emissive: 0xff203f,
            emissiveIntensity: 2.4,
            roughness: 0.2,
        });
        this._box("reactor-core", cx, 2.8, cz, 4.6, 5.6, 4.6, coreMaterial, true);
    }

    _addHangarShip(cx, cz, angle = 0) {
        const material = this._material(0x3a4651);
        const hull = new THREE.Mesh(new THREE.ConeGeometry(2.5, 10, 4), material);
        hull.rotation.x = Math.PI / 2;
        hull.rotation.z = Math.PI / 4;
        hull.rotation.y = angle;
        const ox = cx + Math.sin(angle) * 3;
        const oz = cz + Math.cos(angle) * 3;
        hull.position.set(ox, 1.5, oz);
        this.group.add(hull);
        this._addPropCollider("ship", ox, oz, 3.2, 4.5);
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
            this._addPropCollider("lab-tube", tx, tz, 1.2, 1.2);
        }
    }

    _playerStart() {
        const start = this.station.playerStart;
        return new THREE.Vector3(start.x, start.y, start.z);
    }

    _buildStartBay() {
        const start = this._playerStart();
        const angle = (this.station.modules[0]?.angle ?? 0) + Math.PI;
        const frame = this._material(0x263239, { metalness: 0.82, roughness: 0.3 });
        const marker = this._texturedMaterial("hazard", 2, 1, { metalness: 0.34, roughness: 0.58 });
        for (const side of [-1, 1]) {
            this._box(
                "start-bay-side",
                start.x + Math.cos(angle) * side * 3.2,
                MIN_CEILING / 2,
                start.z - Math.sin(angle) * side * 3.2,
                0.18,
                MIN_CEILING * 0.95,
                4.5,
                frame,
                false,
                angle,
            );
        }
        this._box("start-bay-canopy", start.x, MIN_CEILING - 0.35, start.z, 6.8, 0.2, 4.5, frame, false, angle);
        for (const offset of [-2.4, 2.4]) {
            this._box(
                "start-bay-marker",
                start.x + Math.cos(angle) * offset,
                0.045,
                start.z - Math.sin(angle) * offset,
                0.55,
                0.05,
                0.9,
                marker,
                false,
                angle,
            );
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
            const r = this.station.ring.radius + (index % 2 ? 4 : -2);
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
                if (!isOnWalkableFloor(x, z, { ...this.layout, modules: this.layout.modules || [] })) {
                    continue;
                }
                if (!this._pointBlocked(x, z, 1.1)) {
                    this.floorPoints.push(new THREE.Vector3(x, 0, z));
                }
            }
        }
    }

    _isOnRingDeck(x, z) {
        const r = Math.hypot(x, z);
        const { inner, outer } = this.station.ring;
        if (r < inner + 0.25 || r > outer - 0.25) return false;
        return !this._isNearDock(x, z, 0.75);
    }

    _isNearDock(x, z, widthScale = 1.1) {
        const angle = Math.atan2(x, z);
        const r = Math.hypot(x, z);
        return this.station.tunnels.some((tunnel) => {
            let delta = Math.abs(angle - tunnel.angle);
            if (delta > Math.PI) delta = Math.PI * 2 - delta;
            const halfAngular = Math.atan2(tunnel.width * widthScale, this.station.ring.outer)
                + this.station.ring.thetaStep * 0.85;
            if (delta < halfAngular && r >= this.station.ring.inner - 0.5) return true;
            if (Math.hypot(x - tunnel.cx, z - tunnel.cz) < tunnel.width * 1.1) return true;
            if (Math.hypot(x - tunnel.opening.x, z - tunnel.opening.z) < tunnel.width * 1.1) return true;
            return false;
        });
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
            if (constraints.ringOnly && !this._isOnRingDeck(candidate.x, candidate.z)) return;
            if (constraints.clearDocks !== false && this._isNearDock(candidate.x, candidate.z)) return;
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
        const start = this._playerStart();
        const navCandidates = this.station.navNodes
            .filter((node) => node.kind === "ring" || node.kind === "tunnel" || node.kind === "module")
            .map((node) => new THREE.Vector3(node.x, 0, node.z))
            .filter((point) => (
                Math.hypot(point.x - start.x, point.z - start.z) >= SPAWN_SAFE_RADIUS
                && !this._pointBlocked(point.x, point.z, 0.95)
            ));

        const floorExtras = this._pickRandomFloorPoints(24, 3.5);
        const pool = [...navCandidates, ...floorExtras];
        for (let index = pool.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(this.random() * (index + 1));
            [pool[index], pool[swap]] = [pool[swap], pool[index]];
        }
        this.spawnPoints = [];
        pool.forEach((candidate) => {
            if (this.spawnPoints.length >= 40) return;
            if (this.spawnPoints.some((point) => Math.hypot(point.x - candidate.x, point.z - candidate.z) < 3.2)) {
                return;
            }
            this.spawnPoints.push(candidate.clone());
        });
        this.pickupPoints = this._pickRandomFloorPoints(this.config.pickups, 4);
    }

    _buildFeatureGeometry() {
        const barrelPoints = this._pickRandomFloorPoints(
            FEATURES.barrels.countByLevel[this.config.number - 1],
            3,
            { ringOnly: true },
        ).map((point) => new THREE.Vector3(point.x, 0.7, point.z));

        let airlockAngle = Math.PI;
        if (this.station.tunnels.length) {
            let bestScore = -1;
            for (let index = 0; index < this.station.ring.segments.length; index += 1) {
                const angle = this.station.ring.segments[index].midAngle;
                const score = Math.min(...this.station.tunnels.map((tunnel) => {
                    let delta = Math.abs(tunnel.angle - angle);
                    if (delta > Math.PI) delta = Math.PI * 2 - delta;
                    return delta;
                }));
                if (score > bestScore) {
                    bestScore = score;
                    airlockAngle = angle;
                }
            }
        }
        const airlockPosition = this.config.airlock
            ? new THREE.Vector3(
                Math.sin(airlockAngle) * (this.station.ring.outer - 0.45),
                0,
                Math.cos(airlockAngle) * (this.station.ring.outer - 0.45),
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
                airlockAngle,
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
        const survivorPoints = this._pickRandomFloorPoints(survivorCount, 5, {
            moduleOnly: true,
            clearDocks: false,
        })
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
            bossArena: this.station.bossAnchor
                ? {
                    center: new THREE.Vector3(
                        this.station.bossAnchor.x,
                        0,
                        this.station.bossAnchor.z,
                    ),
                    radius: (this.station.modules.find(
                        (mod) => mod.id === this.station.bossAnchor.moduleId,
                    )?.radius ?? 5.5) * 1.2,
                    moduleId: this.station.bossAnchor.moduleId,
                }
                : null,
        };
    }

    _buildNavDebug() {
        const material = new THREE.LineBasicMaterial({ color: 0x39ff72 });
        const nodeIndex = new Map(this.station.navNodes.map((node) => [node.id, node]));
        const seen = new Set();
        this.station.navEdges.forEach(([a, b]) => {
            const key = a < b ? `${a}|${b}` : `${b}|${a}`;
            if (seen.has(key)) return;
            seen.add(key);
            const na = nodeIndex.get(a);
            const nb = nodeIndex.get(b);
            if (!na || !nb) return;
            const geometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(na.x, 0.4, na.z),
                new THREE.Vector3(nb.x, 0.4, nb.z),
            ]);
            this.group.add(new THREE.Line(geometry, material));
        });
    }

    _buildColliderDebug() {
        const material = new THREE.LineBasicMaterial({ color: 0xff35d3 });
        this.colliders.forEach((box) => {
            const halfW = box.halfW ?? (box.maxX - box.minX) / 2;
            const halfD = box.halfD ?? (box.maxZ - box.minZ) / 2;
            const helper = new THREE.LineSegments(
                new THREE.EdgesGeometry(new THREE.BoxGeometry(halfW * 2, 2.2, halfD * 2)),
                material,
            );
            helper.position.set(box.cx ?? (box.minX + box.maxX) / 2, 1.1, box.cz ?? (box.minZ + box.maxZ) / 2);
            helper.rotation.y = box.yaw ?? 0;
            this.group.add(helper);
        });
    }

    _pointBlocked(x, z, padding) {
        return isInsideSegmentParts(
            { x, z },
            padding,
            this.segmentParts,
            this.propColliders,
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
