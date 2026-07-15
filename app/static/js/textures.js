import * as THREE from "three";
import { VISUALS } from "./config.js";

function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 4294967296;
    };
}

function createCanvas(size, fill) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.fillStyle = fill;
    context.fillRect(0, 0, size, size);
    return { canvas, context };
}

function drawNoise(context, size, random, alpha = 0.08) {
    const count = Math.floor(size * 1.6);
    for (let index = 0; index < count; index += 1) {
        const shade = Math.floor(100 + random() * 120);
        context.fillStyle = `rgba(${shade},${shade},${shade},${alpha * random()})`;
        const radius = 1 + random() * size * 0.008;
        context.fillRect(random() * size, random() * size, radius, radius);
    }
}

function drawPanel(context, size, random, roughness = false, normal = false) {
    const cells = 4;
    const cell = size / cells;
    context.lineWidth = Math.max(2, size / 180);
    context.strokeStyle = normal ? "#6f7fff" : roughness ? "#d1d1d1" : "#202b31";
    for (let index = 0; index <= cells; index += 1) {
        context.beginPath();
        context.moveTo(index * cell, 0);
        context.lineTo(index * cell, size);
        context.moveTo(0, index * cell);
        context.lineTo(size, index * cell);
        context.stroke();
    }
    if (!normal) {
        for (let x = 0; x < cells; x += 1) {
            for (let y = 0; y < cells; y += 1) {
                const inset = size * 0.025;
                context.fillStyle = roughness ? "#999" : "#7f9199";
                for (const [dx, dy] of [[inset, inset], [cell - inset, inset], [inset, cell - inset], [cell - inset, cell - inset]]) {
                    context.beginPath();
                    context.arc(x * cell + dx, y * cell + dy, size / 170, 0, Math.PI * 2);
                    context.fill();
                }
            }
        }
        drawNoise(context, size, random, roughness ? 0.12 : 0.08);
    }
}

function drawFloor(context, size, random, roughness = false, normal = false) {
    const plate = size / 4;
    context.lineWidth = Math.max(2, size / 160);
    context.strokeStyle = normal ? "#7582ff" : roughness ? "#d8d8d8" : "#1e292e";
    for (let index = 0; index <= 4; index += 1) {
        context.beginPath();
        context.moveTo(index * plate, 0);
        context.lineTo(index * plate, size);
        context.moveTo(0, index * plate);
        context.lineTo(size, index * plate);
        context.stroke();
    }
    if (!normal) {
        context.fillStyle = roughness ? "#a8a8a8" : "#829198";
        for (let y = size / 18; y < size; y += size / 9) {
            for (let x = size / 18; x < size; x += size / 9) {
                context.save();
                context.translate(x, y);
                context.rotate(Math.PI / 4);
                context.fillRect(-size / 120, -size / 42, size / 60, size / 21);
                context.restore();
            }
        }
        drawNoise(context, size, random, 0.1);
    }
}

function drawHazard(context, size) {
    context.fillStyle = "#e5a91f";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#15181a";
    const stripe = size / 5;
    for (let x = -size; x < size * 2; x += stripe * 2) {
        context.beginPath();
        context.moveTo(x, size);
        context.lineTo(x + stripe, size);
        context.lineTo(x + size + stripe, 0);
        context.lineTo(x + size, 0);
        context.closePath();
        context.fill();
    }
}

function drawTerminal(context, size, accent) {
    const color = `#${new THREE.Color(accent).getHexString()}`;
    context.fillStyle = "#020a0d";
    context.fillRect(0, 0, size, size);
    context.fillStyle = color;
    context.globalAlpha = 0.8;
    for (let row = 0; row < 14; row += 1) {
        const width = size * (0.16 + ((row * 37) % 65) / 100);
        context.fillRect(size * 0.08, size * (0.08 + row * 0.06), width, size * 0.014);
    }
    context.globalAlpha = 0.2;
    for (let y = 0; y < size; y += 4) context.fillRect(0, y, size, 1);
    context.globalAlpha = 1;
}

function drawCrate(context, size, random) {
    context.strokeStyle = "#d3b96a";
    context.lineWidth = size / 28;
    context.strokeRect(size * 0.035, size * 0.035, size * 0.93, size * 0.93);
    context.strokeStyle = "#2b3438";
    context.lineWidth = size / 45;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(size, size);
    context.moveTo(size, 0);
    context.lineTo(0, size);
    context.stroke();
    context.fillStyle = "#d8c570";
    context.fillRect(size * 0.29, size * 0.42, size * 0.42, size * 0.16);
    context.fillStyle = "#222";
    context.font = `bold ${size / 14}px monospace`;
    context.fillText("ORION CARGO", size * 0.32, size * 0.52);
    drawNoise(context, size, random, 0.12);
}

function drawBarrel(context, size, random) {
    context.fillStyle = "#9e1724";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#20262a";
    context.fillRect(0, size * 0.08, size, size * 0.1);
    context.fillRect(0, size * 0.82, size, size * 0.1);
    context.fillStyle = "#f0c02c";
    context.beginPath();
    context.moveTo(size * 0.5, size * 0.25);
    context.lineTo(size * 0.72, size * 0.66);
    context.lineTo(size * 0.28, size * 0.66);
    context.closePath();
    context.fill();
    context.fillStyle = "#17191a";
    context.font = `bold ${size / 7}px sans-serif`;
    context.fillText("!", size * 0.47, size * 0.58);
    drawNoise(context, size, random, 0.12);
}

export class TextureLibrary {
    constructor(renderer, quality) {
        this.renderer = renderer;
        this.quality = quality;
        this.size = VISUALS.quality[quality].textureSize;
        this.maxAnisotropy = Math.min(
            VISUALS.quality[quality].anisotropy,
            renderer.capabilities.getMaxAnisotropy(),
        );
        this.base = new Map();
        this.instances = new Set();
    }

    _build(kind, channel = "color", accent = 0x39ffc8) {
        const cacheKey = `${kind}:${channel}:${accent}`;
        if (this.base.has(cacheKey)) return this.base.get(cacheKey);
        const random = seededRandom(cacheKey.split("").reduce((sum, letter) => sum + letter.charCodeAt(0), 0));
        const background = channel === "normal"
            ? "#8080ff"
            : channel === "roughness"
                ? "#b5b5b5"
                : {
                    wall: "#59666d",
                    floor: "#465158",
                    crate: "#4c585d",
                    barrel: "#9e1724",
                    hazard: "#e5a91f",
                    terminal: "#020a0d",
                }[kind] || "#ffffff";
        const { canvas, context } = createCanvas(this.size, background);
        const roughness = channel === "roughness";
        const normal = channel === "normal";
        if (kind === "wall") drawPanel(context, this.size, random, roughness, normal);
        if (kind === "floor") drawFloor(context, this.size, random, roughness, normal);
        if (kind === "hazard") drawHazard(context, this.size);
        if (kind === "terminal") drawTerminal(context, this.size, accent);
        if (kind === "crate") drawCrate(context, this.size, random);
        if (kind === "barrel") drawBarrel(context, this.size, random);
        const texture = new THREE.CanvasTexture(canvas);
        texture.name = `${kind}-${channel}-${this.quality}`;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = this.maxAnisotropy;
        if (channel === "color") texture.colorSpace = THREE.SRGBColorSpace;
        this.base.set(cacheKey, texture);
        return texture;
    }

    getMaps(kind, repeatX = 1, repeatY = 1, accent = 0x39ffc8) {
        const channels = ["color"];
        if (kind === "wall" || kind === "floor") channels.push("roughness", "normal");
        const maps = {};
        channels.forEach((channel) => {
            const texture = this._build(kind, channel, accent).clone();
            texture.needsUpdate = true;
            texture.repeat.set(repeatX, repeatY);
            texture.userData.visualInstance = true;
            this.instances.add(texture);
            if (channel === "color") maps.map = texture;
            if (channel === "roughness") maps.roughnessMap = texture;
            if (channel === "normal") maps.normalMap = texture;
        });
        return maps;
    }

    release(texture) {
        if (!texture?.userData?.visualInstance || !this.instances.has(texture)) return;
        texture.dispose();
        this.instances.delete(texture);
    }

    getRadialSprite(kind = "glow") {
        const cacheKey = `sprite:${kind}`;
        if (this.base.has(cacheKey)) return this.base.get(cacheKey);
        const size = 128;
        const { canvas, context } = createCanvas(size, "rgba(0,0,0,0)");
        const gradient = context.createRadialGradient(
            size / 2,
            size / 2,
            0,
            size / 2,
            size / 2,
            size / 2,
        );
        if (kind === "smoke") {
            gradient.addColorStop(0, "rgba(190,205,210,0.55)");
            gradient.addColorStop(0.45, "rgba(100,115,120,0.28)");
            gradient.addColorStop(1, "rgba(30,35,38,0)");
        } else {
            gradient.addColorStop(0, "rgba(255,255,255,1)");
            gradient.addColorStop(0.2, "rgba(255,255,255,0.85)");
            gradient.addColorStop(1, "rgba(255,255,255,0)");
        }
        context.fillStyle = gradient;
        context.fillRect(0, 0, size, size);
        const texture = new THREE.CanvasTexture(canvas);
        texture.name = cacheKey;
        texture.colorSpace = THREE.SRGBColorSpace;
        this.base.set(cacheKey, texture);
        return texture;
    }

    dispose() {
        this.instances.forEach((texture) => texture.dispose());
        this.base.forEach((texture) => texture.dispose());
        this.instances.clear();
        this.base.clear();
    }
}
