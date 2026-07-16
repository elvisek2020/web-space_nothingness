import { describe, expect, it } from "vitest";
import {
    moveWithSegmentSubsteps,
    worldToLocal,
    localToWorld,
    isInsideSegmentParts,
} from "../../app/static/js/collision.js";
import {
    buildSegmentGeometryAndColliders,
    placeSegment,
} from "../../app/static/js/station-segment.js";

describe("v5 AABB segment (step 1–2)", () => {
    it("builds local wall colliders that seal a straight corridor", () => {
        const built = buildSegmentGeometryAndColliders({
            id: "test-seg",
            orientation: "tangential",
            length: 10,
            width: 6,
            openEnds: true,
        });
        expect(built.localColliders.length).toBeGreaterThanOrEqual(2);
        const centerFree = !built.localColliders.some((box) => (
            Math.abs(box.cx) < 0.1 && Math.abs(box.cz) < 0.1
        ));
        expect(centerFree).toBe(true);
        // Outside outer wall should intersect outer collider when probed
        const outer = built.localColliders.find((c) => c.type === "seg-outer");
        expect(outer).toBeTruthy();
        expect(outer.maxZ).toBeGreaterThan(3);
    });

    it("lets the player slide inside and blocks leaving through walls", () => {
        const built = buildSegmentGeometryAndColliders({
            id: "walk-seg",
            orientation: "tangential",
            length: 12,
            width: 7,
            openEnds: true,
        });
        const placed = placeSegment(built, { x: 0, z: 20, yaw: 0 }, null);
        const parts = [placed];
        const bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
        const radius = 0.45;

        // Move along corridor (+X) from center
        const along = moveWithSegmentSubsteps(
            { x: 0, z: 20 },
            { x: 3, z: 0 },
            radius,
            parts,
            [],
            bounds,
        );
        expect(along.x).toBeGreaterThan(2);
        expect(Math.abs(along.z - 20)).toBeLessThan(0.01);

        // Try to escape through outer wall (+Z)
        const out = moveWithSegmentSubsteps(
            { x: 0, z: 20 },
            { x: 0, z: 8 },
            radius,
            parts,
            [],
            bounds,
        );
        expect(out.z).toBeLessThan(20 + 3.6);

        // Try to escape through inner wall (-Z)
        const inn = moveWithSegmentSubsteps(
            { x: 0, z: 20 },
            { x: 0, z: -8 },
            radius,
            parts,
            [],
            bounds,
        );
        expect(inn.z).toBeGreaterThan(20 - 3.6);
    });

    it("preserves sealing after 45° placement (step 2)", () => {
        const built = buildSegmentGeometryAndColliders({
            id: "diag-seg",
            orientation: "tangential",
            length: 12,
            width: 7,
            openEnds: true,
        });
        const yaw = Math.PI / 4;
        const cx = Math.sin(yaw) * 20;
        const cz = Math.cos(yaw) * 20;
        const placed = placeSegment(built, { x: cx, z: cz, yaw }, null);
        const parts = [placed];
        const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
        const radius = 0.45;

        expect(isInsideSegmentParts({ x: cx, z: cz }, radius, parts, [])).toBe(false);

        // Radial outward escape
        const outward = {
            x: Math.sin(yaw) * 10,
            z: Math.cos(yaw) * 10,
        };
        const escaped = moveWithSegmentSubsteps(
            { x: cx, z: cz },
            outward,
            radius,
            parts,
            [],
            bounds,
        );
        const local = worldToLocal(escaped.x, escaped.z, placed.transform);
        expect(Math.abs(local.z)).toBeLessThan(placed.halfAcross + 0.5);

        // Round-trip transform
        const back = localToWorld(local.x, local.z, placed.transform);
        expect(Math.hypot(back.x - escaped.x, back.z - escaped.z)).toBeLessThan(1e-9);
    });
});
