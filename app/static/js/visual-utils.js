import * as THREE from "three";
import { TextureLibrary } from "./textures.js";

let visualContext = null;
let frameAllocations = 0;
const particlePool = [];
const MAX_PARTICLE_POOL = 24;

export function noteAllocation(count = 1) {
    frameAllocations += count;
}

export function resetFrameAllocations() {
    const value = frameAllocations;
    frameAllocations = 0;
    return value;
}

export function getFrameAllocations() {
    return frameAllocations;
}

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
            while (particlePool.length) {
                const entry = particlePool.pop();
                entry.object.geometry.dispose();
                entry.object.material.dispose();
            }
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
    material.userData.sharedVisual = false;
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

function acquireParticlePoints(count) {
    const pooled = particlePool.find((entry) => entry.capacity >= count);
    if (pooled) {
        particlePool.splice(particlePool.indexOf(pooled), 1);
        return pooled;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(Math.max(count, 16) * 3), 3),
    );
    const material = new THREE.PointsMaterial({
        map: getVisuals().textures.getRadialSprite("glow"),
        color: 0xffffff,
        size: 0.1,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
    });
    return {
        object: new THREE.Points(geometry, material),
        capacity: Math.max(count, 16),
        velocities: Array.from({ length: Math.max(count, 16) }, () => new THREE.Vector3()),
    };
}

function releaseParticlePoints(entry) {
    entry.object.removeFromParent();
    if (particlePool.length < MAX_PARTICLE_POOL) {
        particlePool.push(entry);
    } else {
        entry.object.geometry.dispose();
        entry.object.material.dispose();
    }
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
    const entry = acquireParticlePoints(count);
    const positions = entry.object.geometry.attributes.position;
    for (let index = 0; index < count; index += 1) {
        positions.setXYZ(index, position.x, position.y, position.z);
        entry.velocities[index].set(
            (random() - 0.5) * speed,
            random() * speed,
            (random() - 0.5) * speed,
        );
    }
    for (let index = count; index < entry.capacity; index += 1) {
        positions.setXYZ(index, position.x, position.y, position.z);
        entry.velocities[index].set(0, 0, 0);
    }
    positions.needsUpdate = true;
    entry.object.geometry.setDrawRange(0, count);
    entry.object.material.color.set(color);
    entry.object.material.size = size;
    entry.object.material.opacity = 1;
    entry.object.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    scene.add(entry.object);
    return {
        object: entry.object,
        entry,
        activeCount: count,
        life,
        maxLife: life,
        gravity,
        update(delta) {
            this.life -= delta;
            const attrs = this.object.geometry.attributes.position;
            for (let index = 0; index < this.activeCount; index += 1) {
                const velocity = this.entry.velocities[index];
                velocity.y -= this.gravity * delta;
                attrs.setXYZ(
                    index,
                    attrs.getX(index) + velocity.x * delta,
                    attrs.getY(index) + velocity.y * delta,
                    attrs.getZ(index) + velocity.z * delta,
                );
            }
            attrs.needsUpdate = true;
            this.object.material.opacity = Math.max(0, this.life / this.maxLife);
            return this.life > 0;
        },
        dispose() {
            releaseParticlePoints(this.entry);
        },
    };
}

export function createShockwave(scene, position, color = 0xff8a38) {
    noteAllocation(2);
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
