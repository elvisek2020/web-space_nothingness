import { GAME_CONFIG } from "./config.js";

export class Hud {
    constructor(audio) {
        this.audio = audio;
        this.healthValue = document.getElementById("health-value");
        this.healthBar = document.getElementById("health-bar");
        this.scoreValue = document.getElementById("score-value");
        this.levelValue = document.getElementById("level-value");
        this.remainingValue = document.getElementById("remaining-value");
        this.survivorsValue = document.getElementById("survivors-value");
        this.weaponValue = document.getElementById("weapon-value");
        this.ammoValue = document.getElementById("ammo-value");
        this.oxygenPanel = document.getElementById("oxygen-panel");
        this.oxygenValue = document.getElementById("oxygen-value");
        this.oxygenBar = document.getElementById("oxygen-bar");
        this.turretPanel = document.getElementById("turret-panel");
        this.turretValue = document.getElementById("turret-value");
        this.selfDestructPanel = document.getElementById("self-destruct-panel");
        this.selfDestructValue = document.getElementById("self-destruct-value");
        this.contextHint = document.getElementById("context-hint");
        this.radar = document.getElementById("radar");
        this.bossWarning = document.getElementById("boss-warning");
        this.sectionMessage = document.getElementById("section-message");
        this.damageVignette = document.getElementById("damage-vignette");
        this.healFlash = document.getElementById("heal-flash");
        this.lastBeep = 0;
        this.messageTimer = null;
    }

    setHealth(hp) {
        const value = Math.max(0, Math.min(100, hp));
        this.healthValue.textContent = `${Math.ceil(value)} %`;
        this.healthBar.style.width = `${value}%`;
        this.healthBar.style.backgroundColor = value > 55 ? "#43ff81" : value > 25 ? "#ffad32" : "#ff4057";
    }

    setScore(score) {
        this.scoreValue.textContent = String(score).padStart(6, "0");
    }

    setLevel(number, name) {
        this.levelValue.textContent = `${number}/4 · ${name}`;
    }

    setRemaining(count) {
        this.remainingValue.textContent = String(count);
    }

    setWeapon(label, ammo) {
        this.weaponValue.textContent = label;
        this.ammoValue.textContent = Number.isFinite(ammo) ? String(Math.max(0, Math.floor(ammo))) : "∞";
    }

    setSurvivors(rescued, total) {
        this.survivorsValue.textContent = `${rescued}/${total}`;
    }

    setOxygen(value, maximum, visible) {
        this.oxygenPanel.classList.toggle("hidden", !visible);
        const ratio = Math.max(0, Math.min(1, value / maximum));
        this.oxygenValue.textContent = `${value.toFixed(1)} s`;
        this.oxygenBar.style.width = `${ratio * 100}%`;
        this.oxygenBar.style.background = ratio < 0.3 ? "#ff4057" : "#48b8ff";
    }

    setTurret(seconds) {
        const visible = seconds > 0;
        this.turretPanel.classList.toggle("hidden", !visible);
        this.turretValue.textContent = `${Math.ceil(seconds)} s`;
    }

    setSelfDestruct(seconds) {
        const visible = seconds !== null;
        this.selfDestructPanel.classList.toggle("hidden", !visible);
        if (visible) this.selfDestructValue.textContent = String(Math.max(0, Math.ceil(seconds)));
    }

    setContextHint(message = "") {
        this.contextHint.textContent = message;
        this.contextHint.classList.toggle("hidden", !message);
    }

    showBoss(name) {
        this.bossWarning.textContent = `⚠ BOSS · ${name.toUpperCase()}`;
        this.bossWarning.classList.remove("hidden");
        window.setTimeout(() => this.bossWarning.classList.add("hidden"), 3600);
    }

    showMessage(message, duration = 1800) {
        window.clearTimeout(this.messageTimer);
        this.sectionMessage.textContent = message;
        this.sectionMessage.classList.remove("hidden");
        this.messageTimer = window.setTimeout(
            () => this.sectionMessage.classList.add("hidden"),
            duration,
        );
    }

    flashDamage() {
        this._flash(this.damageVignette, 180);
    }

    flashHeal() {
        this._flash(this.healFlash, 260);
        this.showMessage("+25 HP", 800);
    }

    _flash(element, duration) {
        element.classList.add("flash");
        window.setTimeout(() => element.classList.remove("flash"), duration);
    }

    updateRadar(player, enemies, pickups, survivors, elapsed) {
        this.radar.querySelectorAll(".radar-dot").forEach((dot) => dot.remove());
        const range = GAME_CONFIG.radar.range;
        const playerPosition = player.camera.position;
        const cos = Math.cos(-player.yaw);
        const sin = Math.sin(-player.yaw);
        let nearest = Infinity;

        enemies.forEach((enemy) => {
            const dx = enemy.position.x - playerPosition.x;
            const dz = enemy.position.z - playerPosition.z;
            const distance = Math.hypot(dx, dz);
            nearest = Math.min(nearest, distance);
            if (distance > range) return;
            const localX = dx * cos - dz * sin;
            const localZ = dx * sin + dz * cos;
            this._radarDot(
                localX,
                localZ,
                range,
                `radar-enemy${enemy.boss ? " radar-boss" : ""}${enemy.ceiling ? " radar-ceiling" : ""}`,
            );
        });
        pickups.forEach((pickup) => {
            const dx = pickup.position.x - playerPosition.x;
            const dz = pickup.position.z - playerPosition.z;
            if (Math.hypot(dx, dz) > range) return;
            const localX = dx * cos - dz * sin;
            const localZ = dx * sin + dz * cos;
            this._radarDot(localX, localZ, range, "radar-pickup");
        });
        survivors.forEach((survivor) => {
            const dx = survivor.position.x - playerPosition.x;
            const dz = survivor.position.z - playerPosition.z;
            if (Math.hypot(dx, dz) > range) return;
            const localX = dx * cos - dz * sin;
            const localZ = dx * sin + dz * cos;
            this._radarDot(localX, localZ, range, "radar-survivor");
        });

        if (Number.isFinite(nearest)) {
            const proximity = 1 - Math.min(nearest, range) / range;
            const interval = GAME_CONFIG.radar.beepFar
                - proximity * (GAME_CONFIG.radar.beepFar - GAME_CONFIG.radar.beepNear);
            if (elapsed - this.lastBeep >= interval) {
                this.lastBeep = elapsed;
                this.audio?.trackerBeep(proximity);
            }
        }
    }

    _radarDot(x, z, range, className) {
        const dot = document.createElement("span");
        dot.className = `radar-dot ${className}`;
        dot.style.left = `${50 + (x / range) * 47}%`;
        dot.style.top = `${50 + (z / range) * 47}%`;
        this.radar.appendChild(dot);
    }

    reset() {
        this.setHealth(100);
        this.setScore(0);
        this.setRemaining(0);
        this.setWeapon("PULZNÍ PUŠKA M41", Infinity);
        this.setSurvivors(0, 0);
        this.setOxygen(20, 20, false);
        this.setTurret(0);
        this.setSelfDestruct(null);
        this.setContextHint("");
        this.bossWarning.classList.add("hidden");
        this.sectionMessage.classList.add("hidden");
        this.radar.querySelectorAll(".radar-dot").forEach((dot) => dot.remove());
        this.lastBeep = 0;
    }
}
