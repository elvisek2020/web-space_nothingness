/**
 * v5: one function builds local AABB corridor geometry + colliders.
 * Visual group may be yawed; colliders stay axis-aligned in local space.
 *
 * Local frame:
 * - orientation "tangential" (ring): X = along corridor, Z = across (radial)
 * - orientation "radial" (tunnel/module): Z = along corridor, X = across
 */

import * as THREE from "three";
import { FLOOR_Y, MIN_CEILING } from "./config.js";
import { createCollider } from "./collision.js";

const WALL_THICKNESS = 0.55;
const DEFAULT_OVERLAP = 0.1;

/**
 * @param {object} def
 */
export function buildSegmentGeometryAndColliders(def) {
    const id = def.id || "segment";
    const orientation = def.orientation || "tangential";
    const along = def.length;
    const across = def.width;
    const height = def.height ?? MIN_CEILING;
    const overlap = def.overlap ?? DEFAULT_OVERLAP;
    const materials = def.materials || {};
    const floorMat = materials.floor || new THREE.MeshStandardMaterial({ color: 0x3a4550 });
    const wallMat = materials.wall || new THREE.MeshStandardMaterial({ color: 0x4a5560 });
    const ceilingMat = materials.ceiling || wallMat;

    const group = new THREE.Group();
    group.name = id;
    const localColliders = [];

    const addBox = (name, lx, ly, lz, sx, sy, sz, material, solid = true) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
        mesh.name = name;
        mesh.position.set(lx, ly, lz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        if (solid) {
            localColliders.push({
                id: `${id}-${name}-${localColliders.length}`,
                type: name,
                minX: lx - sx / 2,
                maxX: lx + sx / 2,
                minZ: lz - sz / 2,
                maxZ: lz + sz / 2,
                cx: lx,
                cz: lz,
                halfW: sx / 2,
                halfD: sz / 2,
                yaw: 0,
            });
        }
        return mesh;
    };

    let halfAlong;
    let halfAcross;
    let floorSX;
    let floorSZ;

    if (orientation === "radial") {
        // Along +Z, across X
        halfAlong = along / 2 + overlap;
        halfAcross = across / 2;
        floorSX = across + 0.25;
        floorSZ = halfAlong * 2;
        addBox("seg-floor", 0, FLOOR_Y - 0.05, 0, floorSX, 0.12, floorSZ, floorMat, false);
        addBox("seg-ceiling", 0, height + 0.1, 0, floorSX, 0.2, floorSZ, ceilingMat, false);

        // Side walls (±X)
        for (const side of [-1, 1]) {
            addBox(
                "seg-side",
                side * (halfAcross + WALL_THICKNESS / 2),
                height / 2,
                0,
                WALL_THICKNESS,
                height,
                floorSZ,
                wallMat,
                true,
            );
        }

        // Outer end (+Z) — closed unless openOuterEnd
        if (!def.openOuterEnd) {
            addBox(
                "seg-end-outer",
                0,
                height / 2,
                halfAlong + WALL_THICKNESS / 2,
                across + WALL_THICKNESS * 2,
                height,
                WALL_THICKNESS,
                wallMat,
                true,
            );
        }
        // Inner end (-Z) — open for module entry from tunnel
        if (!def.openInnerEnd) {
            addBox(
                "seg-end-inner",
                0,
                height / 2,
                -halfAlong - WALL_THICKNESS / 2,
                across + WALL_THICKNESS * 2,
                height,
                WALL_THICKNESS,
                wallMat,
                true,
            );
        } else if (def.openingWidth > 0) {
            // Door frame on inner end
            const openHalf = def.openingWidth / 2;
            const sideSpan = halfAcross - openHalf;
            if (sideSpan > 0.15) {
                for (const side of [-1, 1]) {
                    addBox(
                        "seg-jamb",
                        side * (openHalf + sideSpan / 2),
                        height / 2,
                        -halfAlong - WALL_THICKNESS / 2,
                        sideSpan,
                        height,
                        WALL_THICKNESS,
                        wallMat,
                        true,
                    );
                }
            }
            addBox(
                "seg-lintel",
                0,
                height - 0.4,
                -halfAlong - WALL_THICKNESS / 2,
                def.openingWidth + 0.4,
                0.8,
                WALL_THICKNESS,
                wallMat,
                false,
            );
        }
    } else {
        // Tangential ring: along X, across Z
        halfAlong = along / 2 + overlap;
        halfAcross = across / 2;
        floorSX = halfAlong * 2;
        floorSZ = across + 0.25;
        addBox("seg-floor", 0, FLOOR_Y - 0.05, 0, floorSX, 0.12, floorSZ, floorMat, false);
        addBox("seg-ceiling", 0, height + 0.1, 0, floorSX, 0.2, floorSZ, ceilingMat, false);

        // Inner wall (-Z)
        addBox(
            "seg-inner",
            0,
            height / 2,
            -halfAcross - WALL_THICKNESS / 2,
            floorSX,
            height,
            WALL_THICKNESS,
            wallMat,
            true,
        );

        // Outer wall (+Z)
        if (def.openOuter && def.openingWidth > 0) {
            const openHalf = def.openingWidth / 2;
            const sideSpan = halfAlong - openHalf;
            if (sideSpan > 0.2) {
                for (const side of [-1, 1]) {
                    addBox(
                        "seg-outer-jamb",
                        side * (openHalf + sideSpan / 2),
                        height / 2,
                        halfAcross + WALL_THICKNESS / 2,
                        sideSpan,
                        height,
                        WALL_THICKNESS,
                        wallMat,
                        true,
                    );
                }
            }
            addBox(
                "seg-outer-lintel",
                0,
                height - 0.4,
                halfAcross + WALL_THICKNESS / 2,
                def.openingWidth + 0.4,
                0.8,
                WALL_THICKNESS,
                wallMat,
                false,
            );
        } else {
            addBox(
                "seg-outer",
                0,
                height / 2,
                halfAcross + WALL_THICKNESS / 2,
                floorSX,
                height,
                WALL_THICKNESS,
                wallMat,
                true,
            );
        }

        if (!def.openEnds) {
            for (const side of [-1, 1]) {
                addBox(
                    "seg-end",
                    side * (halfAlong + WALL_THICKNESS / 2),
                    height / 2,
                    0,
                    WALL_THICKNESS,
                    height,
                    across + WALL_THICKNESS * 2,
                    wallMat,
                    true,
                );
            }
        }
    }

    return {
        id,
        group,
        localColliders,
        length: along,
        width: across,
        height,
        halfAlong,
        halfAcross,
        orientation,
    };
}

export function placeSegment(built, transform, parentGroup) {
    const { x, z, yaw } = transform;
    built.group.position.set(x, 0, z);
    built.group.rotation.y = yaw;
    if (parentGroup) parentGroup.add(built.group);
    return {
        id: built.id,
        group: built.group,
        transform: { x, z, yaw },
        localColliders: built.localColliders.map((c) => ({ ...c })),
        length: built.length,
        width: built.width,
        halfAlong: built.halfAlong,
        halfAcross: built.halfAcross,
        orientation: built.orientation,
    };
}

/**
 * Emit world colliders with segment yaw (OBB) for LOS / spawn probes.
 * Gameplay movement still uses local AABB via segmentParts.
 */
export function emitWorldColliders(placed, idPrefix = "world") {
    const { x: tx, z: tz, yaw } = placed.transform;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return placed.localColliders.map((local, index) => {
        const cx = tx + local.cx * cos + local.cz * sin;
        const cz = tz - local.cx * sin + local.cz * cos;
        return createCollider({
            id: `${idPrefix}-${local.type}-${index}`,
            type: local.type,
            cx,
            cz,
            halfW: local.halfW,
            halfD: local.halfD,
            yaw,
        });
    });
}
