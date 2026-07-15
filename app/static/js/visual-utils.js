import * as THREE from "three";
import { TextureLibrary } from "./textures.js";

let visualContext = null;

export function initializeVisuals(renderer, quality) {
    visualContext?.dispose();
    const textures = new TextureLibrary(renderer, quality);
    const materials = new Map();
    const geometries = new Map();
    visualContext = {
        quality,
        textures,
        materials,
        geometries,
        getMaterial(key, factory) {
            if (!materials.has(key)) {
                const material = factory();
                material.userData.sharedVisual = true;
                materials.set(key, material);
            }
            return materials.get(key);
        },
        getGeometry(key, factory) {
            if (!geometries.has(key)) {
                const geometry = factory();
                geometry.userData.sharedVisual = true;
                geometries.set(key, geometry);
            }
            return geometries.get(key);
        },
        dispose() {
            materials.forEach((material) => material.dispose());
            geometries.forEach((geometry) => geometry.dispose());
            textures.dispose();
            materials.clear();
            geometries.clear();
        },
    };
    return visualContext;
}

export function getVisuals() {
    if (!visualContext) throw new Error("Visual context has not been initialized.");
    return visualContext;
}

export function disposeVisuals() {
    visualContext?.dispose();
    visualContext = null;
}

export function disposeObject3D(object) {
    object.traverse((child) => {
        if (child.geometry && !child.geometry.userData?.sharedVisual) child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.filter(Boolean).forEach((material) => {
            if (material.userData?.sharedVisual) return;
            Object.values(material).forEach((value) => {
                if (value?.isTexture && value.userData?.visualInstance) {
                    visualContext?.textures.release(value);
                }
            });
            material.dispose();
        });
    });
    object.removeFromParent();
}

export function createGlowSprite(color, scale = 1, opacity = 1) {
    const material = new THREE.SpriteMaterial({
        map: getVisuals().textures.getRadialSprite("glow"),
        color,
        opacity,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(scale);
    sprite.userData.transientMaterial = true;
    return sprite;
}

export function createSmokeSprite(scale = 1, opacity = 0.45) {
    const material = new THREE.SpriteMaterial({
        map: getVisuals().textures.getRadialSprite("smoke"),
        color: 0x89979d,
        opacity,
        transparent: true,
        depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(scale);
    return sprite;
}

export function createParticleBurst(scene, options) {
    const {
        position,
        color = 0xffffff,
        count = 20,
        speed = 5,
        life = 0.9,
        size = 0.18,
        gravity = 4,
        additive = true,
        random = Math.random,
    } = options;
    const coordinates = [];
    const velocities = [];
    for (let index = 0; index < count; index += 1) {
        coordinates.push(position.x, position.y, position.z);
        const velocity = new THREE.Vector3(
            (random() - 0.5) * speed,
            random() * speed,
            (random() - 0.5) * speed,
        );
        velocities.push(velocity);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(coordinates, 3));
    const material = new THREE.PointsMaterial({
        map: getVisuals().textures.getRadialSprite("glow"),
        color,
        size,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: false,
    });
    const object = new THREE.Points(geometry, material);
    scene.add(object);
    return {
        object,
        velocities,
        life,
        maxLife: life,
        gravity,
        update(delta) {
            this.life -= delta;
            const positions = this.object.geometry.attributes.position;
            this.velocities.forEach((velocity, index) => {
                velocity.y -= this.gravity * delta;
                positions.setXYZ(
                    index,
                    positions.getX(index) + velocity.x * delta,
                    positions.getY(index) + velocity.y * delta,
                    positions.getZ(index) + velocity.z * delta,
                );
            });
            positions.needsUpdate = true;
            this.object.material.opacity = Math.max(0, this.life / this.maxLife);
            return this.life > 0;
        },
        dispose() {
            disposeObject3D(this.object);
        },
    };
}

export function createShockwave(scene, position, color = 0xff8a38) {
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.42, 32), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position);
    mesh.position.y = 0.1;
    scene.add(mesh);
    return {
        object: mesh,
        life: 0.65,
        update(delta) {
            this.life -= delta;
            this.object.scale.addScalar(delta * 13);
            this.object.material.opacity = Math.max(0, this.life / 0.65);
            return this.life > 0;
        },
        dispose() {
            disposeObject3D(this.object);
        },
    };
}
