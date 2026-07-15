export class GameAudio {
    constructor() {
        this.context = null;
        this.master = null;
        this.ambient = null;
        this.enabled = true;
    }

    async unlock() {
        if (!this.context) {
            this.context = new (window.AudioContext || window.webkitAudioContext)();
            this.master = this.context.createGain();
            this.master.gain.value = 0.34;
            this.master.connect(this.context.destination);
        }
        if (this.context.state === "suspended") await this.context.resume();
        this._startAmbient();
    }

    _startAmbient() {
        if (this.ambient || !this.context) return;
        const oscillator = this.context.createOscillator();
        const filter = this.context.createBiquadFilter();
        const gain = this.context.createGain();
        oscillator.type = "sawtooth";
        oscillator.frequency.value = 47;
        filter.type = "lowpass";
        filter.frequency.value = 120;
        gain.gain.value = 0.035;
        oscillator.connect(filter).connect(gain).connect(this.master);
        oscillator.start();
        this.ambient = { oscillator, gain };
    }

    _tone(frequency, duration, options = {}) {
        if (!this.context || !this.enabled) return;
        const now = this.context.currentTime;
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        const filter = this.context.createBiquadFilter();
        oscillator.type = options.type || "square";
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(
            Math.max(20, options.endFrequency || frequency * 0.65),
            now + duration,
        );
        filter.type = "lowpass";
        filter.frequency.value = options.filter || 5000;
        gain.gain.setValueAtTime(options.volume || 0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        oscillator.connect(filter).connect(gain).connect(this.master);
        oscillator.start(now);
        oscillator.stop(now + duration);
    }

    _noise(duration, options = {}) {
        if (!this.context || !this.enabled) return;
        const frames = Math.ceil(this.context.sampleRate * duration);
        const buffer = this.context.createBuffer(1, frames, this.context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let index = 0; index < frames; index += 1) data[index] = Math.random() * 2 - 1;
        const source = this.context.createBufferSource();
        const filter = this.context.createBiquadFilter();
        const gain = this.context.createGain();
        const now = this.context.currentTime;
        filter.type = options.filterType || "bandpass";
        filter.frequency.value = options.frequency || 1200;
        filter.Q.value = options.q || 1;
        gain.gain.setValueAtTime(options.volume || 0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        source.buffer = buffer;
        const destination = options.position
            ? this._createPanner(options.position)
            : this.master;
        source.connect(filter).connect(gain).connect(destination);
        source.start();
    }

    _createPanner(position) {
        const panner = this.context.createPanner();
        panner.panningModel = "HRTF";
        panner.distanceModel = "inverse";
        panner.refDistance = 2;
        panner.maxDistance = 35;
        panner.rolloffFactor = 1.1;
        const now = this.context.currentTime;
        if (panner.positionX) {
            panner.positionX.setValueAtTime(position.x, now);
            panner.positionY.setValueAtTime(position.y, now);
            panner.positionZ.setValueAtTime(position.z, now);
        } else {
            panner.setPosition(position.x, position.y, position.z);
        }
        panner.connect(this.master);
        return panner;
    }

    setListener(position, forward) {
        if (!this.context) return;
        const listener = this.context.listener;
        const now = this.context.currentTime;
        if (listener.positionX) {
            listener.positionX.setValueAtTime(position.x, now);
            listener.positionY.setValueAtTime(position.y, now);
            listener.positionZ.setValueAtTime(position.z, now);
            listener.forwardX.setValueAtTime(forward.x, now);
            listener.forwardY.setValueAtTime(forward.y, now);
            listener.forwardZ.setValueAtTime(forward.z, now);
            listener.upX.setValueAtTime(0, now);
            listener.upY.setValueAtTime(1, now);
            listener.upZ.setValueAtTime(0, now);
        } else {
            listener.setPosition(position.x, position.y, position.z);
            listener.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
        }
    }

    shoot() {
        this._tone(210, 0.1, { endFrequency: 70, type: "sawtooth", volume: 0.16 });
        this._noise(0.07, { frequency: 1800, q: 0.5, volume: 0.06 });
    }

    weaponShot(type) {
        if (type === "shotgun") {
            this._noise(0.18, { frequency: 420, q: 0.7, volume: 0.18 });
            this._tone(125, 0.2, { endFrequency: 45, type: "sawtooth", volume: 0.2 });
            return;
        }
        if (type === "flamethrower") {
            this._noise(0.09, { frequency: 780, q: 0.35, volume: 0.075 });
            return;
        }
        this.shoot();
    }

    hit() {
        this._tone(760, 0.055, { endFrequency: 340, type: "square", volume: 0.08 });
    }

    enemyDeath(boss = false) {
        this._noise(boss ? 0.75 : 0.28, {
            frequency: boss ? 260 : 520,
            q: 2,
            volume: boss ? 0.2 : 0.1,
        });
        this._tone(boss ? 180 : 320, boss ? 0.8 : 0.25, {
            endFrequency: 42,
            type: "sawtooth",
            volume: boss ? 0.22 : 0.1,
        });
    }

    playerHurt() {
        this._noise(0.16, { frequency: 180, q: 0.7, volume: 0.18 });
    }

    pickup() {
        this._tone(440, 0.18, { endFrequency: 880, type: "sine", volume: 0.12 });
        window.setTimeout(() => this._tone(660, 0.18, { endFrequency: 1100, type: "sine", volume: 0.08 }), 80);
    }

    trackerBeep(proximity) {
        this._tone(850 + proximity * 380, 0.045, {
            endFrequency: 850 + proximity * 380,
            type: "sine",
            volume: 0.025 + proximity * 0.025,
        });
    }

    alienCry(boss = false) {
        this._noise(boss ? 0.5 : 0.2, {
            frequency: boss ? 180 : 430,
            q: 5,
            volume: boss ? 0.14 : 0.055,
        });
    }

    ceilingScratch(position) {
        this._noise(0.16, {
            position,
            frequency: 2300,
            q: 7,
            volume: 0.045,
        });
        window.setTimeout(() => this._noise(0.08, {
            position,
            frequency: 3200,
            q: 5,
            volume: 0.025,
        }), 95);
    }

    ceilingScreech(position) {
        this._noise(0.42, {
            position,
            frequency: 1450,
            q: 5.5,
            volume: 0.13,
        });
        if (!this.context || !this.enabled) return;
        const now = this.context.currentTime;
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = "sawtooth";
        oscillator.frequency.setValueAtTime(620, now);
        oscillator.frequency.exponentialRampToValueAtTime(155, now + 0.38);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
        oscillator.connect(gain).connect(this._createPanner(position));
        oscillator.start(now);
        oscillator.stop(now + 0.4);
    }

    bossAlarm() {
        [0, 340, 680].forEach((delay) => {
            window.setTimeout(() => this._tone(130, 0.24, {
                endFrequency: 110,
                type: "square",
                volume: 0.18,
                filter: 600,
            }), delay);
        });
    }

    explosion() {
        this._noise(0.65, { frequency: 160, q: 0.45, volume: 0.24 });
        this._tone(85, 0.7, { endFrequency: 28, type: "sawtooth", volume: 0.2 });
    }

    decompression() {
        this._noise(3, { frequency: 900, q: 0.2, volume: 0.16 });
        this.bossAlarm();
    }

    oxygenWarning() {
        this._tone(1050, 0.11, { endFrequency: 1050, type: "sine", volume: 0.1 });
    }

    turretShot() {
        this._tone(390, 0.055, { endFrequency: 180, type: "square", volume: 0.07 });
    }

    survivorTeleport() {
        this._tone(380, 0.45, { endFrequency: 1200, type: "sine", volume: 0.12 });
        this._noise(0.25, { frequency: 1800, q: 4, volume: 0.05 });
    }

    selfDestructAlarm() {
        [0, 420, 840, 1260].forEach((delay) => {
            window.setTimeout(() => this._tone(95, 0.3, {
                endFrequency: 72,
                type: "square",
                volume: 0.2,
                filter: 500,
            }), delay);
        });
    }

    dispose() {
        if (this.ambient) this.ambient.oscillator.stop();
        this.ambient = null;
        this.context?.close();
        this.context = null;
    }
}
