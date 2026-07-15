import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { LIGHTING, VISUALS } from "./config.js";

function disposeSceneResources(root) {
    root.traverse((object) => {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
        } else {
            object.material?.dispose();
        }
    });
}

export class RenderingPipeline {
    constructor(canvas, scene, camera, quality, testMode = false) {
        this.canvas = canvas;
        this.scene = scene;
        this.camera = camera;
        this.quality = quality;
        this.testMode = testMode;
        this.profile = VISUALS.quality[quality];
        this.pixelRatio = Math.min(window.devicePixelRatio, this.profile.pixelRatio);
        this.composer = null;
        this.environmentTexture = null;

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: testMode && quality === "high",
            powerPreference: "high-performance",
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = LIGHTING.exposure;
        this.renderer.shadowMap.enabled = !testMode && this.profile.shadows;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.info.autoReset = false;
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight, false);

        this._createEnvironment();
        if (!testMode) this._createComposer();
    }

    _createEnvironment() {
        const generator = new THREE.PMREMGenerator(this.renderer);
        generator.compileEquirectangularShader();
        const room = new RoomEnvironment();
        const target = generator.fromScene(room, 0.04);
        this.environmentTexture = target.texture;
        this.scene.environment = this.environmentTexture;
        this.scene.environmentIntensity = VISUALS.environmentIntensity;
        disposeSceneResources(room);
        generator.dispose();
    }

    _createComposer() {
        const target = new THREE.WebGLRenderTarget(
            Math.max(1, Math.floor(window.innerWidth * this.pixelRatio)),
            Math.max(1, Math.floor(window.innerHeight * this.pixelRatio)),
            {
                type: THREE.HalfFloatType,
                depthBuffer: true,
                stencilBuffer: false,
            },
        );
        target.samples = this.profile.msaaSamples;
        target.texture.name = `orion-composer-${this.quality}`;

        this.composer = new EffectComposer(this.renderer, target);
        this.composer.setPixelRatio(this.pixelRatio);
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(this.renderPass);

        if (this.profile.ssao) {
            this.ssaoPass = new SSAOPass(
                this.scene,
                this.camera,
                window.innerWidth,
                window.innerHeight,
            );
            this.ssaoPass.kernelRadius = VISUALS.ssao.kernelRadius;
            this.ssaoPass.minDistance = VISUALS.ssao.minDistance;
            this.ssaoPass.maxDistance = VISUALS.ssao.maxDistance;
            this.composer.addPass(this.ssaoPass);
        }

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            this.profile.bloomStrength,
            this.profile.bloomRadius,
            this.profile.bloomThreshold,
        );
        this.composer.addPass(this.bloomPass);
        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);
    }

    markShadowsDirty() {
        if (this.renderer.shadowMap.enabled) {
            this.renderer.shadowMap.needsUpdate = true;
        }
    }

    setExposure(scale) {
        this.renderer.toneMappingExposure = LIGHTING.exposure * scale;
    }

    resize(width = window.innerWidth, height = window.innerHeight) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.composer?.setSize(width, height);
    }

    render(delta = 0) {
        this.renderer.info.reset();
        if (this.composer) this.composer.render(delta);
        else this.renderer.render(this.scene, this.camera);
    }

    getStats() {
        const { info } = this.renderer;
        return {
            quality: this.quality,
            composer: Boolean(this.composer),
            ssao: Boolean(this.ssaoPass),
            shadows: this.renderer.shadowMap.enabled,
            pixelRatio: this.pixelRatio,
            calls: info.render.calls,
            triangles: info.render.triangles,
            points: info.render.points,
            lines: info.render.lines,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
        };
    }

    dispose() {
        this.composer?.dispose();
        this.environmentTexture?.dispose();
        this.scene.environment = null;
        this.renderer.dispose();
    }
}
