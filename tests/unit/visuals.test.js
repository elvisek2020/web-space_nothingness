import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextureLibrary } from "../../app/static/js/textures.js";
import { disposeObject3D } from "../../app/static/js/visual-utils.js";

function fakeCanvasContext() {
    const context = {};
    [
        "fillRect", "strokeRect", "beginPath", "moveTo", "lineTo", "stroke", "arc",
        "fill", "save", "translate", "rotate", "restore", "fillText", "closePath",
    ].forEach((name) => {
        context[name] = () => {};
    });
    context.createRadialGradient = () => ({ addColorStop() {} });
    return context;
}

describe("procedural visual resources", () => {
    beforeEach(() => {
        globalThis.document = {
            createElement: () => ({
                width: 0,
                height: 0,
                getContext: () => fakeCanvasContext(),
            }),
        };
    });

    afterEach(() => {
        delete globalThis.document;
    });

    it("caches generated source textures and clones repeat instances", () => {
        const library = new TextureLibrary({
            capabilities: { getMaxAnisotropy: () => 16 },
        }, "low");
        const first = library.getRadialSprite("glow");
        const second = library.getRadialSprite("glow");
        expect(first).toBe(second);

        const maps = library.getMaps("wall", 3, 2);
        expect(maps.map.repeat.x).toBe(3);
        expect(maps.normalMap.repeat.y).toBe(2);
        expect(library.size).toBe(512);
        expect(library.base.size).toBe(4);
        expect(library.instances.size).toBe(3);

        library.dispose();
        expect(library.base.size).toBe(0);
        expect(library.instances.size).toBe(0);
    });

    it("disposes owned geometry and material but preserves shared resources", () => {
        const root = new THREE.Group();
        const geometry = new THREE.BoxGeometry();
        const material = new THREE.MeshStandardMaterial();
        const geometryDispose = vi.spyOn(geometry, "dispose");
        const materialDispose = vi.spyOn(material, "dispose");
        root.add(new THREE.Mesh(geometry, material));
        disposeObject3D(root);
        expect(geometryDispose).toHaveBeenCalledOnce();
        expect(materialDispose).toHaveBeenCalledOnce();

        const sharedRoot = new THREE.Group();
        const sharedGeometry = new THREE.BoxGeometry();
        const sharedMaterial = new THREE.MeshStandardMaterial();
        sharedGeometry.userData.sharedVisual = true;
        sharedMaterial.userData.sharedVisual = true;
        const sharedGeometryDispose = vi.spyOn(sharedGeometry, "dispose");
        const sharedMaterialDispose = vi.spyOn(sharedMaterial, "dispose");
        sharedRoot.add(new THREE.Mesh(sharedGeometry, sharedMaterial));
        disposeObject3D(sharedRoot);
        expect(sharedGeometryDispose).not.toHaveBeenCalled();
        expect(sharedMaterialDispose).not.toHaveBeenCalled();
    });
});
