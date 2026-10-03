/*
 * Ecualizador Libre — motor de audio (Web Audio) e interfaz.
 * Sin dependencias externas: funciona sin internet.
 */
'use strict';
(function () {
  // =====================================================================
  // Utilidades
  // =====================================================================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const db2lin = (d) => Math.pow(10, d / 20);
  const lin2db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
  const round = (v, d = 1) => { const m = Math.pow(10, d); return Math.round(v * m) / m; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (s) => parseFloat(String(s).replace(',', '.'));

  function fmtHz(f) {
    if (f >= 1000) {
      const k = f / 1000;
      return (k >= 10 ? k.toFixed(1) : k.toFixed(2)).replace(/\.?0+$/, '') + ' kHz';
    }
    return Math.round(f) + ' Hz';
  }
  const fmtDb = (g, d = 1) => (g > 0 ? '+' : '') + g.toFixed(d) + ' dB';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  class UserError extends Error {}

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* almacenamiento no disponible */ } },
  };

  let toastTimer = 0;
  function toast(msg, kind, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (kind === 'error' ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || (kind === 'error' ? 8000 : 3500));
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function friendly(e, ctxName) {
    if (e instanceof UserError) return e.message;
    switch (e && e.name) {
      case 'NotAllowedError':
        return ctxName === 'display'
          ? 'Se canceló la captura del audio del sistema.'
          : 'Permiso denegado. Haz clic en el ícono de la barra de direcciones y permite el micrófono.';
      case 'NotFoundError': return 'No se encontró ningún dispositivo de entrada de audio.';
      case 'NotReadableError': return 'El dispositivo está ocupado o bloqueado por otra app. Cierra las apps que lo usen en modo exclusivo y reintenta.';
      case 'OverconstrainedError': return 'El dispositivo no soporta la configuración pedida.';
      case 'SecurityError': return 'El navegador bloqueó el acceso. Abre la app con el lanzador (Iniciar-Ecualizador).';
      case 'NotSupportedError': return 'Tu navegador no soporta esta función. Usa Chrome o Edge actualizados.';
      default: return 'Error: ' + ((e && e.message) || e);
    }
  }

  // =====================================================================
  // DSP: filtros biquad (RBJ Audio EQ Cookbook, igual que Web Audio y Equalizer APO)
  // =====================================================================
  const TYPES = {
    PK: { label: 'Campana (PK)', gain: true, q: true, wa: 'peaking' },
    LSC: { label: 'Shelf graves (LSC)', gain: true, q: false, wa: 'lowshelf' },
    HSC: { label: 'Shelf agudos (HSC)', gain: true, q: false, wa: 'highshelf' },
    HP: { label: 'Pasa altos (HP)', gain: false, q: true, wa: 'highpass' },
    LP: { label: 'Pasa bajos (LP)', gain: false, q: true, wa: 'lowpass' },
    NO: { label: 'Notch (NO)', gain: false, q: true, wa: 'notch' },
  };
  // Web Audio usa pendiente S=1 en los shelves, equivalente a Q = 0.707 (igual que AutoEq).
  const SHELF_Q = Math.SQRT1_2;
  const F_MIN = 20, F_MAX = 20000, MAX_BANDS = 24;

  function coeffs(b, fs) {
    const f = clamp(b.f, 5, fs / 2 - 10);
    const w0 = 2 * Math.PI * f / fs, cw = Math.cos(w0), sw = Math.sin(w0);
    const A = Math.pow(10, (b.g || 0) / 40);
    const q = (b.t === 'LSC' || b.t === 'HSC') ? SHELF_Q : Math.max(0.05, b.q || 0.71);
    const alpha = sw / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    switch (b.t) {
      case 'PK':
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
        break;
      case 'LSC': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
        a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s;
        break;
      }
      case 'HSC': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
        a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
        break;
      }
      case 'HP':
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'LP':
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 'NO':
        b0 = 1; b1 = -2 * cw; b2 = 1;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      default:
        return [1, 0, 0, 0, 0];
    }
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }

  function magDb(c, f, fs) {
    const w = 2 * Math.PI * f / fs;
    const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = c[0] + c[1] * c1 + c[2] * c2, ni = -(c[1] * s1 + c[2] * s2);
    const dr = 1 + c[3] * c1 + c[4] * c2, di = -(c[3] * s1 + c[4] * s2);
    return 10 * Math.log10(Math.max((nr * nr + ni * ni) / Math.max(dr * dr + di * di, 1e-30), 1e-30));
  }

  function bandResponse(b, freqs, fs, out) {
    const c = coeffs(b, fs);
    for (let i = 0; i < freqs.length; i++) out[i] += magDb(c, freqs[i], fs);
    return out;
  }

  function responseDb(bands, freqs, fs) {
    const out = new Float64Array(freqs.length);
    for (const b of bands) if (b.on) bandResponse(b, freqs, fs, out);
    return out;
  }

  function logFreqs(n, a, z) {
    const r = new Float64Array(n), la = Math.log(a), lz = Math.log(z);
    for (let i = 0; i < n; i++) r[i] = Math.exp(la + (lz - la) * i / (n - 1));
    return r;
  }
  const PEAK_FREQS = logFreqs(480, F_MIN, F_MAX);

  function maxGainDb(bands, fs) {
    let m = -Infinity;
    for (const v of responseDb(bands, PEAK_FREQS, fs)) if (v > m) m = v;
    return m;
  }

  function pinkBuffer(ctx, secs) {
    const sr = ctx.sampleRate, len = Math.floor(sr * (secs || 6)), buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, ss = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
        d[i] = v; ss += v * v;
      }
      const k = 0.1 / Math.sqrt(ss / len); // RMS -20 dBFS
      for (let i = 0; i < len; i++) d[i] *= k;
    }
    return buf;
  }

  // Puerta de ruido como AudioWorklet (cargada desde un Blob para no depender de archivos extra).
  const GATE_CODE = `
class NoiseGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.2, minValue: 0.01, maxValue: 3, automationRate: 'k-rate' },
      { name: 'range', defaultValue: -60, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.env = 0; this.g = 1; this.hold = 0; this.t = 0; this.open = true; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || inp.length === 0) { for (const ch of out) ch.fill(0); return true; }
    const n = out[0].length, sr = sampleRate;
    const thr = Math.pow(10, p.threshold[0] / 20), floor = Math.pow(10, p.range[0] / 20);
    const aEnv = Math.exp(-1 / (0.01 * sr)), aAtt = Math.exp(-1 / (0.002 * sr)), aRel = Math.exp(-1 / (p.release[0] * sr));
    const holdN = Math.round(0.08 * sr);
    for (let i = 0; i < n; i++) {
      let x = 0;
      for (let c = 0; c < inp.length; c++) { const v = Math.abs(inp[c][i]); if (v > x) x = v; }
      this.env = x > this.env ? x : this.env * aEnv + x * (1 - aEnv);
      let target;
      if (this.env >= thr) { target = 1; this.hold = holdN; }
      else if (this.hold > 0) { target = 1; this.hold--; }
      else target = floor;
      this.g = target + (this.g - target) * (target > this.g ? aAtt : aRel);
      for (let c = 0; c < out.length; c++) { const src = inp[c] || inp[0]; out[c][i] = src[i] * this.g; }
    }
    this.t += n;
    if (this.t >= sr / 15) {
      this.t = 0;
      const o = this.g > 0.5;
      if (o !== this.open) { this.open = o; this.port.postMessage(o); }
    }
    return true;
  }
}
registerProcessor('noise-gate', NoiseGate);
`;
  let gateUrl = null;
  async function loadGate(ctx) {
    if (!ctx.audioWorklet) throw new Error('AudioWorklet no disponible');
    if (!gateUrl) gateUrl = URL.createObjectURL(new Blob([GATE_CODE], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(gateUrl);
  }

  const SINK_OK = typeof AudioContext !== 'undefined' && typeof AudioContext.prototype.setSinkId === 'function';

  function setP(param, v, ctx, instant) {
    if (!isFinite(v)) return;
    if (instant) {
      param.cancelScheduledValues(0);
      param.value = v;
    } else {
      param.setTargetAtTime(v, ctx.currentTime, 0.012);
    }
  }

  function mkAnalyser(ctx, fft, smooth) {
    const a = ctx.createAnalyser();
    a.fftSize = fft || 8192;
    a.smoothingTimeConstant = smooth == null ? 0.8 : smooth;
    a.minDecibels = -120;
    a.maxDecibels = 0;
    return a;
  }

  const TD_BUF = new Float32Array(16384);
  function levelOf(an) {
    const n = an.fftSize, buf = TD_BUF.subarray(0, n);
    an.getFloatTimeDomainData(buf);
    let pk = 0, ss = 0;
    for (let i = 0; i < n; i++) { const v = buf[i]; ss += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
    return { rms: lin2db(Math.sqrt(ss / n)), pk: lin2db(pk) };
  }

  // =====================================================================
  // Estado
  // =====================================================================
  const P = window.EQ_PRESETS;
  const PROFILES = window.AUTOEQ_PROFILES || [];
  const toBand = (a) => ({ t: a[0], f: a[1], g: a[2], q: a[3], on: true });

  function defaultState(id) {
    return {
      sourceType: 'device',
      inputId: 'default', inputLabel: '',
      outputId: id === 'mic' ? 'none' : 'default', outputLabel: '',
      monitor: true,
      bands: P[id][0].bands.map(toBand),
      presetName: P[id][0].name,
      bypass: false,
      preAuto: true, preamp: 0, outGain: 0,
      gate: { on: false, threshold: -50, release: 200 },
      comp: { on: false, threshold: -24, ratio: 3, attack: 5, release: 150, makeup: 0 },
      limiter: { on: true, ceiling: -1 },
      webrtc: { ns: false, aec: false, agc: false },
      auto: { target: id === 'mic' ? 'voice-broadcast' : 'music', dur: 8, strength: 70 },
    };
  }

  function sanitizeBands(list) {
    return (Array.isArray(list) ? list : [])
      .map((b) => (Array.isArray(b) ? toBand(b) : b))
      .filter((b) => b && TYPES[b.t] && isFinite(b.f) && b.f > 0)
      .slice(0, MAX_BANDS)
      .map((b) => ({
        t: b.t,
        f: clamp(+b.f, 10, 24000),
        g: clamp(+b.g || 0, -30, 30),
        q: clamp(+b.q || 0.71, 0.05, 40),
        on: b.on !== false,
      }));
  }

  function loadState(id) {
    const d = defaultState(id), s = store.get('eqlibre.state.' + id, null);
    if (!s || typeof s !== 'object') return d;
    const out = Object.assign({}, d, s);
    for (const k of ['gate', 'comp', 'limiter', 'webrtc', 'auto']) out[k] = Object.assign({}, d[k], s[k] || {});
    out.bands = sanitizeBands(s.bands);
    if (!out.bands.length && !Array.isArray(s.bands)) out.bands = d.bands;
    if (!['device', 'display', 'file', 'noise'].includes(out.sourceType)) out.sourceType = 'device';
    return out;
  }

  // =====================================================================
  // Canal de audio
  // =====================================================================
  class Channel {
    constructor(id) {
      this.id = id;
      this.isMic = id === 'mic';
      this.name = this.isMic ? 'Micrófono' : 'Audio del PC';
      this.s = loadState(id);
      this.ctx = null;
      this.running = false;
      this.busy = false;
      this.stream = null; this.src = null; this.mediaEl = null; this.file = null; this.noise = null;
      this.filters = [];
      this.gate = null; this.gateOpen = true; this.gateError = '';
      this.version = 1;
      this.saveTimer = 0;
      this.sinkError = '';
      this.lv = { inRms: -120, inPk: -120, outRms: -120, outPk: -120, inHold: -120, outHold: -120, inHoldT: 0, outHoldT: 0, clipUntil: 0 };
    }

    get fs() { return this.ctx ? this.ctx.sampleRate : 48000; }

    save(now) {
      clearTimeout(this.saveTimer);
      if (now) store.set('eqlibre.state.' + this.id, this.s);
      else this.saveTimer = setTimeout(() => store.set('eqlibre.state.' + this.id, this.s), 300);
    }

    async init() {
      if (this.ctx) return;
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.input = ctx.createGain();
      this.anaPre = mkAnalyser(ctx);
      this.anaPost = mkAnalyser(ctx);
      this.specPre = new Float32Array(this.anaPre.frequencyBinCount);
      this.specPost = new Float32Array(this.anaPost.frequencyBinCount);
      this.preamp = ctx.createGain();
      this.comp = ctx.createDynamicsCompressor();
      this.makeup = ctx.createGain();
      this.out = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.001;
      this.limiter.release.value = 0.08;
      this.mon = ctx.createGain();
      if (this.isMic) {
        try {
          await loadGate(ctx);
          this.gate = new AudioWorkletNode(ctx, 'noise-gate', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
            channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
          });
          this.gate.port.onmessage = (e) => { this.gateOpen = !!e.data; };
        } catch (e) {
          this.gate = null;
          this.gateError = 'La puerta de ruido no está disponible en este navegador.';
          console.warn('Gate:', e);
        }
      }
      this.buildFilters();
      this.applyParams(true);
      this.rewire();
      await this.applyOutput();
    }

    buildFilters() {
      if (!this.ctx) return;
      for (const f of this.filters) { try { f.disconnect(); } catch (e) { /* ya desconectado */ } }
      this.filters = this.s.bands.map(() => this.ctx.createBiquadFilter());
      this.s.bands.forEach((b, i) => this.setFilter(i, true));
    }

    setFilter(i, instant) {
      const n = this.filters[i], b = this.s.bands[i];
      if (!n || !b) return;
      const T = TYPES[b.t];
      if (n.type !== T.wa) n.type = T.wa;
      const f = clamp(b.f, 10, this.fs / 2 - 100);
      const g = T.gain ? b.g : 0;
      // En Web Audio el Q de pasa-altos/pasa-bajos va en dB.
      const q = (b.t === 'HP' || b.t === 'LP') ? 20 * Math.log10(Math.max(b.q, 0.05)) : (T.q ? b.q : SHELF_Q);
      setP(n.frequency, f, this.ctx, instant);
      setP(n.gain, g, this.ctx, instant);
      setP(n.Q, q, this.ctx, instant);
    }

    autoPreamp() {
      if (this._apV === this.version) return this._ap;
      const m = maxGainDb(this.s.bands, this.fs);
      this._ap = m > 0.05 ? -Math.ceil(m * 10) / 10 : 0;
      this._apV = this.version;
      return this._ap;
    }

    preampDb() { return this.s.preAuto ? this.autoPreamp() : this.s.preamp; }

    applyParams(instant) {
      if (!this.ctx) return;
      const s = this.s, ctx = this.ctx, c = s.comp;
      setP(this.preamp.gain, db2lin(this.preampDb()), ctx, instant);
      this.comp.threshold.value = c.threshold;
      this.comp.ratio.value = c.ratio;
      this.comp.knee.value = 6;
      this.comp.attack.value = c.attack / 1000;
      this.comp.release.value = c.release / 1000;
      setP(this.makeup.gain, db2lin(c.makeup), ctx, instant);
      setP(this.out.gain, db2lin(s.outGain), ctx, instant);
      this.limiter.threshold.value = s.limiter.ceiling;
      const muted = !s.monitor || (s.outputId === 'none' && !SINK_OK);
      setP(this.mon.gain, muted ? 0 : 1, ctx, instant);
      if (this.gate) {
        const p = this.gate.parameters;
        p.get('threshold').value = s.gate.threshold;
        p.get('release').value = s.gate.release / 1000;
      }
    }

    rewire() {
      if (!this.ctx) return;
      const s = this.s;
      const all = [this.input, this.gate, this.preamp, ...this.filters, this.comp, this.makeup, this.out, this.limiter, this.mon];
      for (const n of all) if (n) { try { n.disconnect(); } catch (e) { /* sin conexiones */ } }
      const chain = [this.input];
      if (this.gate && s.gate.on) chain.push(this.gate);
      if (!s.bypass) {
        chain.push(this.preamp);
        this.filters.forEach((f, i) => { if (s.bands[i] && s.bands[i].on) chain.push(f); });
      }
      if (s.comp.on) chain.push(this.comp, this.makeup);
      chain.push(this.out);
      if (s.limiter.on) chain.push(this.limiter);
      for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
      const last = chain[chain.length - 1];
      last.connect(this.anaPost);
      last.connect(this.mon);
      this.input.connect(this.anaPre);
      this.mon.connect(this.ctx.destination);
    }

    // kind: 'param' (solo valores) · 'wire' (re-conectar) · 'struct' (bandas nuevas/borradas/tipo)
    changed(kind) {
      this.version++;
      if (this.ctx) {
        if (kind === 'struct') { this.buildFilters(); this.rewire(); }
        else if (kind === 'wire') this.rewire();
        this.applyParams();
      }
      this.save();
    }

    bandChanged(i) {
      this.version++;
      if (this.ctx) { this.setFilter(i); this.applyParams(); }
      this.save();
    }

    async applyOutput() {
      this.sinkError = '';
      if (!this.ctx) return;
      const id = this.s.outputId;
      if (!SINK_OK) {
        if (id !== 'default' && id !== 'none') this.sinkError = 'Este navegador no permite elegir la salida (se usa la predeterminada). Usa Chrome o Edge actualizados.';
        this.applyParams(true);
        return;
      }
      try {
        await this.ctx.setSinkId(id === 'none' ? { type: 'none' } : (id === 'default' ? '' : id));
      } catch (e) {
        this.sinkError = 'No se pudo usar esa salida (' + (e.message || e.name) + '). Se usa la predeterminada.';
        try { await this.ctx.setSinkId(''); } catch (e2) { /* sin alternativa */ }
      }
      this.applyParams(true);
    }

    async start() {
      if (this.busy) return;
      this.busy = true;
      try {
        await this.init();
        this.stopSource();
        const s = this.s, ctx = this.ctx;
        if (ctx.state !== 'running') await ctx.resume();
        if (s.sourceType === 'device') {
          this.stream = await getInputStream(s.inputId, this.isMic ? s.webrtc : null);
          const tr = this.stream.getAudioTracks()[0];
          const st = tr && tr.getSettings ? tr.getSettings() : {};
          if (st.deviceId && s.inputId !== 'default') s.inputId = st.deviceId;
          this.src = ctx.createMediaStreamSource(this.stream);
        } else if (s.sourceType === 'display') {
          this.stream = await getSystemAudio();
          this.src = ctx.createMediaStreamSource(new MediaStream(this.stream.getAudioTracks()));
        } else if (s.sourceType === 'file') {
          if (!this.file) throw new UserError('Primero elige un archivo de audio.');
          const el = document.createElement('audio');
          el.controls = true;
          el.loop = true;
          el.src = URL.createObjectURL(this.file);
          this.mediaEl = el;
          this.src = ctx.createMediaElementSource(el);
          await el.play();
        } else {
          const n = ctx.createBufferSource();
          n.buffer = pinkBuffer(ctx);
          n.loop = true;
          n.start();
          this.noise = n;
          this.src = n;
        }
        this.src.connect(this.input);
        if (this.stream) {
          const stream = this.stream;
          stream.getTracks().forEach((t) => t.addEventListener('ended', () => {
            if (this.stream !== stream) return;
            this.stop();
            toast(this.name + ': la fuente de audio se desconectó.');
            ui.refresh();
          }));
        }
        this.running = true;
        this.save();
      } catch (e) {
        this.stopSource();
        throw e;
      } finally {
        this.busy = false;
      }
    }

    stopSource() {
      if (this.src) { try { this.src.disconnect(); } catch (e) { /* nada */ } }
      if (this.noise) { try { this.noise.stop(); } catch (e) { /* nada */ } }
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.mediaEl) {
        this.mediaEl.pause();
        URL.revokeObjectURL(this.mediaEl.src);
        this.mediaEl.remove();
      }
      this.src = this.noise = this.stream = this.mediaEl = null;
      this.running = false;
    }

    async stop() {
      this.stopSource();
      if (this.ctx && this.ctx.state === 'running') {
        try { await this.ctx.suspend(); } catch (e) { /* nada */ }
      }
    }

    async restartIfRunning() {
      if (!this.running) return;
      try { await this.start(); } catch (e) { toast(friendly(e, this.s.sourceType), 'error'); }
    }

    readLevels(now) {
      const L = this.lv;
      if (!this.running || !this.ctx || this.ctx.state !== 'running') {
        L.inRms = L.outRms = L.inPk = L.outPk = L.inHold = L.outHold = -120;
        return;
      }
      const a = levelOf(this.anaPre), b = levelOf(this.anaPost);
      L.inRms = a.rms; L.inPk = a.pk; L.outRms = b.rms; L.outPk = b.pk;
      if (a.pk >= L.inHold || now > L.inHoldT) { L.inHold = a.pk; L.inHoldT = now + 1200; }
      if (b.pk >= L.outHold || now > L.outHoldT) { L.outHold = b.pk; L.outHoldT = now + 1200; }
      if (b.pk > -0.2) L.clipUntil = now + 1500;
    }
  }

  async function getInputStream(deviceId, webrtc) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new UserError('Este navegador no da acceso al micrófono. Abre la app con el lanzador en Chrome o Edge.');
    }
    const p = webrtc || { ns: false, aec: false, agc: false };
    const c = {
      echoCancellation: !!p.aec,
      noiseSuppression: !!p.ns,
      autoGainControl: !!p.agc,
      channelCount: { ideal: webrtc ? 1 : 2 },
    };
    if (deviceId && deviceId !== 'default') c.deviceId = { exact: deviceId };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: c });
    } catch (e) {
      if ((e.name === 'OverconstrainedError' || e.name === 'NotFoundError') && c.deviceId) {
        delete c.deviceId;
        toast('No se encontró el dispositivo elegido; se usa el predeterminado.');
        return navigator.mediaDevices.getUserMedia({ audio: c });
      }
      throw e;
    }
  }

  async function getSystemAudio() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new UserError('Tu navegador no permite capturar el audio del sistema. Usa Chrome o Edge en Windows.');
    }
    const st = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1, width: 320, height: 180 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'include',
    });
    if (!st.getAudioTracks().length) {
      st.getTracks().forEach((t) => t.stop());
      throw new UserError('No se compartió audio. Elige «Pantalla completa» y activa «Compartir también el audio del sistema».');
    }
    return st;
  }

  const channels = { mic: new Channel('mic'), pc: new Channel('pc') };
  let cur = channels[store.get('eqlibre.tab', 'mic')] || channels.mic;

  // =====================================================================
  // Dispositivos
  // =====================================================================
  const devs = { inputs: [], outputs: [], labels: false };

  async function refreshDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      devs.inputs = list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');
      devs.outputs = list.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default');
      devs.labels = list.some((d) => d.kind === 'audioinput' && d.label);
      for (const ch of Object.values(channels)) {
        resolveDevice(ch.s, 'inputId', 'inputLabel', devs.inputs);
        resolveDevice(ch.s, 'outputId', 'outputLabel', devs.outputs);
      }
    } catch (e) {
      console.warn('enumerateDevices', e);
    }
    $('#btnPerm').hidden = devs.labels;
    ui.renderIO();
  }

  // Los IDs de dispositivo pueden cambiar entre sesiones: si no aparece, se busca por nombre.
  function resolveDevice(s, idK, lblK, list) {
    const id = s[idK];
    if (id === 'default' || id === 'none' || !devs.labels) return;
    if (list.some((d) => d.deviceId === id)) return;
    const m = list.find((d) => d.label && d.label === s[lblK]);
    if (m) s[idK] = m.deviceId;
  }

  const labelOf = (list, id) => { const d = list.find((x) => x.deviceId === id); return d ? d.label : ''; };

  // =====================================================================
  // Ajuste automático (análisis de espectro promedio)
  // =====================================================================
  const THIRD = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];

  function interp(anchors, f) {
    if (f <= anchors[0][0]) return anchors[0][1];
    const last = anchors[anchors.length - 1];
    if (f >= last[0]) return last[1];
    for (let i = 1; i < anchors.length; i++) {
      if (f <= anchors[i][0]) {
        const [f0, d0] = anchors[i - 1], [f1, d1] = anchors[i];
        return d0 + (d1 - d0) * Math.log(f / f0) / Math.log(f1 / f0);
      }
    }
    return last[1];
  }

  // Espectro promedio de la voz a largo plazo (LTASS, Byrne et al. 1994), niveles por tercio de octava.
  const LTASS = [[100, 54.4], [125, 57.7], [160, 56.8], [200, 60.2], [250, 60.3], [315, 59.0], [400, 62.1], [500, 62.1],
    [630, 60.5], [800, 56.8], [1000, 53.7], [1250, 53.0], [1600, 52.0], [2000, 48.7], [2500, 48.1], [3150, 46.8],
    [4000, 45.6], [5000, 44.5], [6300, 44.3], [8000, 43.7], [10000, 43.4], [12500, 41.3], [16000, 40.7]];
  const BROADCAST_ADD = [[100, 0], [200, -1.5], [315, -1.5], [500, 0], [1600, 0], [2500, 2], [4000, 3], [6300, 2], [10000, 2.5], [16000, 2.5]];
  // Balance tonal promedio de música comercial (tercios de octava, relativo).
  const MUSIC = [[31.5, -1], [63, 0], [125, 0], [250, -2], [500, -4.5], [1000, -7.5], [2000, -10.5], [4000, -14], [8000, -18.5], [16000, -26]];
  // Curva de sala tipo Harman/B&K: graves ligeramente arriba, caída suave en agudos.
  const ROOM = [[20, 4], [50, 4], [100, 3], [200, 1.5], [500, 0.5], [1000, 0], [2000, -1], [5000, -2.5], [10000, -4], [20000, -6]];

  const TARGETS = {
    'voice-broadcast': {
      ch: 'mic', label: 'Voz broadcast (presencia y aire)',
      desc: 'Habla normal durante la medición (lee algo en voz alta). Corrige la coloración del micrófono y del cuarto, y agrega presencia de locutor.',
      curve: (f) => interp(LTASS, f) + interp(BROADCAST_ADD, f),
      range: [100, 12500], norm: [300, 3000], lim: [-6, 4], centers: [125, 250, 500, 1000, 2000, 4000, 8000], hp: 80, gate: true,
    },
    'voice-natural': {
      ch: 'mic', label: 'Voz natural',
      desc: 'Habla normal durante la medición. Lleva tu voz al espectro promedio de la voz humana (LTASS), sin realces.',
      curve: (f) => interp(LTASS, f),
      range: [100, 12500], norm: [300, 3000], lim: [-6, 4], centers: [125, 250, 500, 1000, 2000, 4000, 8000], hp: 80, gate: true,
    },
    music: {
      ch: 'pc', label: 'Balance tonal del audio que suena',
      desc: 'Inicia el canal y reproduce música variada durante la medición. Ajusta suavemente el balance hacia el promedio de la música comercial.',
      curve: (f) => interp(MUSIC, f),
      range: [40, 14000], norm: [200, 5000], lim: [-4, 3], centers: [63, 125, 250, 500, 1000, 2000, 4000, 8000], hp: 0, gate: true,
    },
    room: {
      ch: 'pc', label: 'Parlantes + sala (ruido rosa + micrófono)',
      desc: 'Emite ruido rosa por la salida de este canal y lo graba con el micrófono del canal Micrófono. Pon el micrófono donde escuchas, a la altura de los oídos, con volumen de conversación.',
      curve: (f) => interp(ROOM, f),
      range: [35, 16000], norm: [300, 3000], lim: [-8, 4], gate: false,
      // Graves en tercios de octava (resonancias del cuarto), medios y agudos en medias octavas.
      centers: [40, 50, 63, 80, 100, 125, 160, 200, 250, 355, 500, 710, 1000, 1400, 2000, 2800, 4000, 5600, 8000, 11200],
      q: (fc) => (fc <= 250 ? 4.32 : 2.87),
      smooth: 0, edges: true, hole: 9,
    },
  };

  async function captureFrames(an, secs, onProg, alive) {
    const bins = an.frequencyBinCount, fd = new Float32Array(bins), td = new Float32Array(an.fftSize);
    const frames = [], t0 = performance.now(), total = secs * 1000;
    while (performance.now() - t0 < total) {
      await sleep(100);
      if (alive && !alive()) throw new UserError('Medición cancelada.');
      an.getFloatTimeDomainData(td);
      let ss = 0;
      for (let i = 0; i < td.length; i++) ss += td[i] * td[i];
      an.getFloatFrequencyData(fd);
      frames.push({ rms: lin2db(Math.sqrt(ss / td.length)), db: Float32Array.from(fd) });
      if (onProg) onProg(Math.min(1, (performance.now() - t0) / total));
    }
    return frames;
  }

  function avgPower(frames, gate) {
    let sel = frames;
    if (gate && frames.length) {
      const sorted = frames.map((f) => f.rms).sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      const thr = Math.max(-62, p90 - 18);
      sel = frames.filter((f) => f.rms >= thr);
    }
    if (!sel.length) return null;
    const n = sel[0].db.length, acc = new Float64Array(n);
    let lvl = 0;
    for (const f of sel) {
      lvl += f.rms;
      for (let i = 0; i < n; i++) acc[i] += Math.pow(10, f.db[i] / 10);
    }
    for (let i = 0; i < n; i++) acc[i] /= sel.length;
    return { pow: acc, frames: sel.length, level: lvl / sel.length };
  }

  function thirdOct(pow, binHz) {
    return THIRD.map((fc) => {
      const lo = fc / Math.pow(2, 1 / 6), hi = fc * Math.pow(2, 1 / 6);
      let s = 0, n = 0;
      const i0 = Math.max(1, Math.floor(lo / binHz)), i1 = Math.min(pow.length - 1, Math.ceil(hi / binHz));
      for (let i = i0; i <= i1; i++) { const f = i * binHz; if (f >= lo && f < hi) { s += pow[i]; n++; } }
      if (!n) s = pow[clamp(Math.round(fc / binHz), 1, pow.length - 1)];
      return 10 * Math.log10(Math.max(s, 1e-20));
    });
  }

  function designCorrection(meas, T, strength, floor) {
    const tgt = THIRD.map((f) => T.curve(f));
    let s = 0, n = 0;
    THIRD.forEach((f, i) => { if (f >= T.norm[0] && f <= T.norm[1]) { s += meas[i] - tgt[i]; n++; } });
    const off = n ? s / n : 0;
    const dev = THIRD.map((f, i) => meas[i] - (tgt[i] + off));
    // Límites reales del equipo: donde la respuesta cae más de 6 dB en dos bandas seguidas
    // (el subwoofer ya no baja más / el tweeter ya no sube más). Ahí no se realza, solo se recorta.
    let lo = 0, hi = Infinity;
    if (T.edges) {
      for (let i = THIRD.indexOf(200); i >= 0; i--) {
        if (dev[i] < -6 && (i === 0 || dev[i - 1] < -6)) { lo = THIRD[i + 1]; break; }
      }
      for (let i = THIRD.indexOf(4000); i < THIRD.length; i++) {
        if (dev[i] < -6 && (i === THIRD.length - 1 || dev[i + 1] < -6)) { hi = THIRD[i - 1]; break; }
      }
    }
    let corr = THIRD.map((f, i) => {
      if (f < T.range[0] || f > T.range[1]) return 0;
      if (floor && meas[i] - floor[i] < 6) return 0; // señal poco confiable en esa banda
      const c = -dev[i];
      if (c > 0 && (f < lo || f > hi)) return 0; // fuera del rango del equipo
      if (T.hole && c > T.hole) return 0; // hueco profundo del cuarto: realzarlo no sirve
      return clamp(c, T.lim[0] * 1.5, T.lim[1] * 1.5);
    });
    for (let p = 0; p < (T.smooth == null ? 2 : T.smooth); p++) {
      corr = corr.map((v, i) => 0.25 * (i > 0 ? corr[i - 1] : v) + 0.5 * v + 0.25 * (i < corr.length - 1 ? corr[i + 1] : v));
    }
    return { corr: corr.map((v) => clamp(v * strength, T.lim[0], T.lim[1])), lo, hi };
  }

  function fitBands(corr, T, fs, lo) {
    const at = (fc) => {
      for (let i = 1; i < THIRD.length; i++) {
        if (fc <= THIRD[i]) {
          const t = Math.log(fc / THIRD[i - 1]) / Math.log(THIRD[i] / THIRD[i - 1]);
          return corr[i - 1] + (corr[i] - corr[i - 1]) * t;
        }
      }
      return corr[corr.length - 1];
    };
    const desired = T.centers.map(at);
    const bands = T.centers.map((fc, i) => ({ t: 'PK', f: fc, g: desired[i], q: T.q ? T.q(fc) : 1.41, on: true }));
    const cf = Float64Array.from(T.centers);
    for (let it = 0; it < 40; it++) {
      const r = responseDb(bands, cf, fs);
      bands.forEach((b, i) => { b.g = clamp(b.g + 0.6 * (desired[i] - r[i]), T.lim[0] - 2, T.lim[1] + 2); });
    }
    const out = bands.map((b) => Object.assign(b, { g: round(b.g, 1) })).filter((b) => Math.abs(b.g) >= 0.3);
    // Parlantes: filtro protector bajo lo que el subwoofer puede reproducir (nunca por encima de 30 Hz).
    const hp = T.edges ? clamp(Math.round(0.6 * (lo || 0)), 20, 30) : T.hp;
    if (hp) out.unshift({ t: 'HP', f: hp, g: 0, q: 0.71, on: true });
    // error residual dentro del rango útil
    const idx = THIRD.map((f, i) => i).filter((i) => THIRD[i] >= Math.max(T.range[0], hp * 1.5 || 0) && THIRD[i] <= T.range[1]);
    const resp = responseDb(out.filter((b) => b.t === 'PK'), Float64Array.from(idx.map((i) => THIRD[i])), fs);
    let e = 0;
    idx.forEach((i, k) => { e += Math.pow(resp[k] - corr[i], 2); });
    return { bands: out, err: Math.sqrt(e / Math.max(1, idx.length)) };
  }

  function region(f) {
    if (f < 80) return 'sub-graves / retumbe';
    if (f < 250) return 'graves / cuerpo';
    if (f < 500) return 'turbiedad / encierro';
    if (f < 2000) return 'medios / nasalidad';
    if (f < 5000) return 'presencia / claridad';
    if (f < 9000) return 'sibilancia / brillo';
    return 'aire';
  }

  const autoRun = { active: false, ch: null };

  async function runAuto(ch) {
    const s = ch.s, T = TARGETS[s.auto.target];
    if (!T || T.ch !== ch.id) throw new UserError('Elige un objetivo de ajuste.');
    const strength = s.auto.strength / 100, secs = s.auto.dur;
    const prog = (p, txt) => {
      if (cur !== ch) return;
      $('#autoProg').style.width = Math.round(p * 100) + '%';
      if (txt) $('#autoResult').innerHTML = '<span class="muted">' + esc(txt) + '</span>';
    };
    const alive = () => autoRun.active;
    let levels, floor = null, fs;

    if (s.auto.target === 'room') {
      const r = await measureRoom(ch, secs, prog, alive);
      levels = r.levels; floor = r.floor; fs = ch.fs;
    } else {
      if (!ch.running) {
        if (ch.id === 'pc' && ch.s.sourceType === 'noise') throw new UserError('Elige una fuente con música real, no ruido rosa.');
        await ch.start();
        ui.refresh();
      }
      const an = mkAnalyser(ch.ctx, 16384, 0);
      ch.input.connect(an);
      prog(0, ch.isMic ? 'Escuchando… habla normal, como en una llamada.' : 'Escuchando el audio que suena…');
      let frames;
      try {
        frames = await captureFrames(an, secs, (p) => prog(p), alive);
      } finally {
        try { ch.input.disconnect(an); } catch (e) { /* nada */ }
      }
      const avg = avgPower(frames, T.gate);
      if (!avg || avg.frames < 8 || avg.level < -65) {
        throw new UserError(ch.isMic
          ? 'No se detectó suficiente voz. Acércate al micrófono, sube su volumen en Windows y habla durante toda la medición.'
          : 'No se detectó suficiente audio. Reproduce música durante la medición.');
      }
      fs = ch.fs;
      levels = thirdOct(avg.pow, fs / an.fftSize);
    }

    const design = designCorrection(levels, T, strength, floor);
    const fit = fitBands(design.corr, T, fs, design.lo);
    if (!fit.bands.some((b) => b.t === 'PK')) {
      return '<b>Listo.</b> Tu señal ya está muy cerca del objetivo: no hace falta corregir.';
    }
    s.bands = fit.bands;
    s.preAuto = true;
    s.bypass = false;
    s.presetName = 'Auto: ' + T.label;
    ch.changed('struct');
    const top = fit.bands.filter((b) => b.t === 'PK').sort((a, b) => Math.abs(b.g) - Math.abs(a.g)).slice(0, 4);
    let range = '';
    if (T.edges) {
      range = '<p class="small">Tus parlantes reproducen bien desde ~' + fmtHz(design.lo || 40) + ' hasta ~' + fmtHz(isFinite(design.hi) ? design.hi : 16000) +
        '. Fuera de ese rango la app no realza, para no forzar el subwoofer ni los tweeters.</p>';
      if (design.lo > 80) {
        range += '<p class="small">Si tu subwoofer sí suena más abajo, es probable que el micrófono no capte bien los graves ' +
          '(pasa con micrófonos de audífonos o de laptop). En ese caso ajusta los graves con la perilla del subwoofer.</p>';
      }
    }
    return '<b>Listo.</b> Se aplicaron ' + fit.bands.length + ' bandas (error residual ±' + fit.err.toFixed(1) + ' dB). Cambios principales:<ul>' +
      top.map((b) => '<li>' + fmtDb(b.g) + ' en ' + fmtHz(b.f) + ' · ' + region(b.f) + '</li>').join('') +
      '</ul>' + range + '<span class="small muted">Compara con A/B. Si suena exagerado, baja la intensidad y vuelve a medir.</span>';
  }

  async function measureRoom(pc, secs, prog, alive) {
    const mic = channels.mic;
    if (pc.s.outputId === 'none') throw new UserError('Elige tus parlantes como Salida del canal Audio del PC.');
    await pc.init();
    const wasRunning = pc.running;
    pc.stopSource();
    if (pc.ctx.state !== 'running') await pc.ctx.resume();
    let stream = null, nz = null;
    try {
      stream = await getInputStream(mic.s.inputId, null);
      const src = pc.ctx.createMediaStreamSource(stream);
      const an = mkAnalyser(pc.ctx, 16384, 0);
      src.connect(an);
      prog(0, 'Midiendo el ruido de fondo… silencio, por favor.');
      await sleep(300);
      const quiet = await captureFrames(an, 1.5, (p) => prog(p * 0.15), alive);
      nz = pc.ctx.createBufferSource();
      nz.buffer = pinkBuffer(pc.ctx);
      nz.loop = true;
      const g = pc.ctx.createGain();
      g.gain.value = 0;
      nz.connect(g);
      g.connect(pc.ctx.destination);
      nz.start();
      g.gain.setTargetAtTime(1, pc.ctx.currentTime, 0.15);
      prog(0.15, 'Reproduciendo ruido rosa y midiendo…');
      await sleep(900);
      const loud = await captureFrames(an, secs, (p) => prog(0.15 + p * 0.85), alive);
      g.gain.setTargetAtTime(0, pc.ctx.currentTime, 0.04);
      await sleep(200);
      src.disconnect();
      const q = avgPower(quiet, false), l = avgPower(loud, false);
      const binHz = pc.ctx.sampleRate / an.fftSize;
      const floor = thirdOct(q.pow, binHz), levels = thirdOct(l.pow, binHz);
      let snr = 0, n = 0;
      THIRD.forEach((f, i) => { if (f >= 200 && f <= 4000) { snr += levels[i] - floor[i]; n++; } });
      snr /= n;
      if (snr < 10) {
        throw new UserError('El micrófono casi no capta los parlantes (señal/ruido ' + String(Math.round(snr)) +
          ' dB). Sube el volumen, revisa que la Salida sean tus parlantes y que el micrófono del canal Micrófono sea el correcto.');
      }
      return { levels, floor };
    } finally {
      if (nz) { try { nz.stop(); } catch (e) { /* nada */ } }
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (wasRunning) { try { await pc.start(); } catch (e) { /* se informa en la UI */ } }
      else if (pc.ctx.state === 'running') { try { await pc.ctx.suspend(); } catch (e) { /* nada */ } }
    }
  }

  // =====================================================================
  // Importar / exportar
  // =====================================================================
  const fmtF = (f) => (f >= 100 ? String(Math.round(f)) : String(round(f, 1)));

  function toApo(ch) {
    const s = ch.s, L = [];
    L.push('# Ecualizador Libre · ' + ch.name + ' · ' + (s.presetName || 'personalizado'));
    L.push('# ' + new Date().toLocaleString());
    if (ch.isMic) L.push('# Micrófono: en el Configurator de Equalizer APO marca tu micrófono en «Capture devices».');
    L.push('Preamp: ' + ch.preampDb().toFixed(1) + ' dB');
    s.bands.forEach((b, i) => {
      let body;
      switch (b.t) {
        case 'PK': body = 'PK Fc ' + fmtF(b.f) + ' Hz Gain ' + b.g.toFixed(1) + ' dB Q ' + b.q.toFixed(2); break;
        case 'LSC':
        case 'HSC': body = b.t + ' Fc ' + fmtF(b.f) + ' Hz Gain ' + b.g.toFixed(1) + ' dB Q 0.71'; break;
        case 'HP': body = 'HPQ Fc ' + fmtF(b.f) + ' Hz Q ' + b.q.toFixed(2); break;
        case 'LP': body = 'LPQ Fc ' + fmtF(b.f) + ' Hz Q ' + b.q.toFixed(2); break;
        case 'NO': body = 'NO Fc ' + fmtF(b.f) + ' Hz Q ' + b.q.toFixed(2); break;
        default: return;
      }
      L.push('Filter ' + (i + 1) + ': ' + (b.on ? 'ON' : 'OFF') + ' ' + body);
    });
    return L.join('\r\n') + '\r\n';
  }

  function toGraphicEq(ch) {
    const fr = [];
    let last = 0;
    for (const f of logFreqs(127, 20, 20000)) { const r = Math.round(f); if (r > last) { fr.push(r); last = r; } }
    const resp = responseDb(ch.s.bands, Float64Array.from(fr), 48000), pre = ch.preampDb();
    return 'GraphicEQ: ' + fr.map((f, i) => f + ' ' + round(resp[i] + pre, 1)).join('; ') + '\r\n';
  }

  function presetSnapshot(ch, name) {
    const s = ch.s;
    return {
      app: 'ecualizador-libre', version: 1, canal: ch.id, name: name || s.presetName || 'Preset',
      preAuto: s.preAuto, preamp: s.preamp, bands: s.bands.map((b) => Object.assign({}, b)),
      comp: Object.assign({}, s.comp), gate: Object.assign({}, s.gate), limiter: Object.assign({}, s.limiter),
      date: new Date().toISOString(),
    };
  }

  const bwToQ = (bw) => { const p = Math.pow(2, bw); return Math.sqrt(p) / (p - 1); };

  function parseApo(text) {
    const bands = [], warn = [];
    let preamp = null, skipped = 0, shelfQ = false;
    if (/^\s*GraphicEQ\s*:/im.test(text) && !/Filter/i.test(text)) {
      throw new UserError('Ese archivo es GraphicEQ. Importa el «ParametricEQ.txt» de AutoEq o un config paramétrico de Equalizer APO.');
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      let m = line.match(/^Preamp\s*:\s*([-+]?\d+(?:[.,]\d+)?)\s*dB/i);
      if (m) { preamp = (preamp || 0) + num(m[1]); continue; }
      m = line.match(/^Filter\s*\d*\s*:\s*(ON|OFF)\s+([A-Za-z]+)(?:\s+\d+\s*dB)?\s+Fc\s+([\d.,]+)\s*(k?Hz)?(.*)$/i);
      if (!m) continue;
      const on = m[1].toUpperCase() === 'ON';
      const kind = m[2].toUpperCase();
      // «3,000» como separador de miles; «62,5» como decimal
      let f = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(m[3]) ? num(m[3].replace(/,/g, '')) : num(m[3]);
      if (m[4] && m[4].toLowerCase() === 'khz') f *= 1000;
      const rest = m[5] || '';
      const gm = rest.match(/Gain\s+([-+]?[\d.,]+)\s*dB/i);
      const qm = rest.match(/\bQ\s+([\d.,]+)/i);
      const bm = rest.match(/BW\s+Oct\s+([\d.,]+)/i);
      const g = gm ? num(gm[1]) : 0;
      let q = qm ? num(qm[1]) : (bm ? bwToQ(num(bm[1])) : NaN);
      let t;
      if (kind === 'PK' || kind === 'PEQ' || kind === 'MODAL') t = 'PK';
      else if (kind === 'LS' || kind === 'LSC') t = 'LSC';
      else if (kind === 'HS' || kind === 'HSC') t = 'HSC';
      else if (kind === 'HP' || kind === 'HPQ') t = 'HP';
      else if (kind === 'LP' || kind === 'LPQ') t = 'LP';
      else if (kind === 'NO') t = 'NO';
      else { skipped++; continue; }
      if (!isFinite(q)) q = t === 'PK' ? 1.41 : (t === 'NO' ? 10 : 0.71);
      if ((t === 'LSC' || t === 'HSC') && Math.abs(q - 0.71) > 0.05) shelfQ = true;
      if (!isFinite(f) || f <= 0) { skipped++; continue; }
      bands.push({ t, f, g, q, on });
    }
    if (!bands.length) throw new UserError('No se encontraron filtros. El formato esperado es: «Filter 1: ON PK Fc 1000 Hz Gain -3 dB Q 1.41».');
    if (bands.length > MAX_BANDS) warn.push('Solo se importaron las primeras ' + MAX_BANDS + ' bandas.');
    if (skipped) warn.push(skipped + ' filtro(s) de tipo no soportado se omitieron.');
    if (shelfQ) warn.push('Los shelves usan pendiente fija (Q 0.71); la curva puede variar levemente.');
    return { bands: sanitizeBands(bands), preamp, warn };
  }

  function importText(ch, text, name) {
    const t = text.trim();
    if (!t) throw new UserError('No hay nada para importar.');
    if (t[0] === '{' || t[0] === '[') {
      let data;
      try { data = JSON.parse(t); } catch (e) { throw new UserError('El JSON no es válido.'); }
      const p = Array.isArray(data) ? data[0] : data;
      if (!p || !Array.isArray(p.bands)) throw new UserError('El JSON no contiene bandas.');
      applyPreset(ch, p, p.name || name || 'Importado');
      return [];
    }
    const r = parseApo(t);
    const s = ch.s;
    s.bands = r.bands;
    if (r.preamp != null) { s.preAuto = false; s.preamp = clamp(r.preamp, -30, 12); } else s.preAuto = true;
    s.presetName = name || 'Importado';
    s.bypass = false;
    ch.changed('struct');
    return r.warn;
  }

  function applyPreset(ch, p, name) {
    const s = ch.s;
    s.bands = sanitizeBands(p.bands);
    if (p.comp) s.comp = Object.assign({}, s.comp, p.comp);
    if (p.gate && ch.isMic) s.gate = Object.assign({}, s.gate, p.gate);
    if (p.limiter) s.limiter = Object.assign({}, s.limiter, p.limiter);
    if (p.preAuto === false && isFinite(p.preamp)) { s.preAuto = false; s.preamp = p.preamp; } else s.preAuto = true;
    s.presetName = name;
    s.bypass = false;
    ch.changed('struct');
    ui.refresh();
  }

  function applyProfile(ch, prof, emulate) {
    const s = ch.s;
    const bands = prof.f.map(([t, f, g, q]) => ({ t, f, g: emulate ? -g : g, q, on: true }));
    if (emulate) {
      const keep = s.bands.filter((b) => !((b.t === 'PK' || b.t === 'LSC' || b.t === 'HSC') && Math.abs(b.g) < 0.05));
      if (keep.length + bands.length > MAX_BANDS) {
        throw new UserError('No caben más bandas (máximo ' + MAX_BANDS + '). Quita algunas o usa «Corregir» primero.');
      }
      const base = s.presetName && s.presetName.startsWith('AutoEq: ') ? s.presetName.slice(8) : '';
      s.bands = keep.concat(bands);
      s.presetName = (base ? base + ' → ' : '') + 'suena como ' + prof.n;
    } else {
      s.bands = bands;
      s.presetName = 'AutoEq: ' + prof.n;
    }
    s.preAuto = true;
    s.bypass = false;
    ch.changed('struct');
  }

  // =====================================================================
  // Gráfico
  // =====================================================================
  const G = {
    cv: null, c: null, w: 0, h: 0, dpr: 1,
    pad: { l: 42, r: 12, t: 12, b: 24 },
    range: 18, hover: -1, drag: -1, sel: -1,
    last: null, mouse: null,
    cache: { key: '', freqs: null, total: null, per: [] },
    colors: {}, showSpec: true,
  };
  const bandColor = (i) => 'hsl(' + Math.round((i * 137.5 + 20) % 360) + ' 78% 58%)';
  const LOG_SPAN = Math.log(F_MAX / F_MIN);

  function plotW() { return G.w - G.pad.l - G.pad.r; }
  function plotH() { return G.h - G.pad.t - G.pad.b; }
  function fx(f) { return G.pad.l + Math.log(f / F_MIN) / LOG_SPAN * plotW(); }
  function xf(x) { return F_MIN * Math.exp(clamp((x - G.pad.l) / plotW(), 0, 1) * LOG_SPAN); }
  function gy(g) { return G.pad.t + (1 - (g + G.range) / (2 * G.range)) * plotH(); }
  function yg(y) { return (1 - (y - G.pad.t) / plotH()) * 2 * G.range - G.range; }

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['grid', 'grid-strong', 'zero', 'curve', 'spec-pre', 'spec-post', 'spec-post-line', 'muted', 'text', 'panel']) {
      G.colors[k] = cs.getPropertyValue('--' + k).trim();
    }
  }

  function resizeGraph() {
    const r = G.cv.getBoundingClientRect();
    G.dpr = window.devicePixelRatio || 1;
    G.w = Math.max(200, r.width);
    G.h = Math.max(150, r.height);
    G.cv.width = Math.round(G.w * G.dpr);
    G.cv.height = Math.round(G.h * G.dpr);
    G.cache.key = '';
  }

  function curves() {
    const ch = cur, key = ch.id + ':' + ch.version + ':' + Math.round(G.w) + ':' + ch.fs;
    if (G.cache.key === key) return G.cache;
    const n = Math.max(64, Math.round(plotW() / 2));
    const freqs = logFreqs(n, F_MIN, F_MAX);
    G.cache.freqs = freqs;
    G.cache.per = ch.s.bands.map((b) => bandResponse(Object.assign({}, b, { on: true }), freqs, ch.fs, new Float64Array(n)));
    const total = new Float64Array(n);
    ch.s.bands.forEach((b, i) => { if (b.on) for (let k = 0; k < n; k++) total[k] += G.cache.per[i][k]; });
    G.cache.total = total;
    G.cache.key = key;
    return G.cache;
  }

  function handlePos(i) {
    const b = cur.s.bands[i];
    return { x: fx(clamp(b.f, F_MIN, F_MAX)), y: gy(TYPES[b.t].gain ? clamp(b.g, -G.range, G.range) : 0) };
  }

  function hit(x, y) {
    let best = -1, bd = 16 * 16;
    cur.s.bands.forEach((b, i) => {
      const p = handlePos(i), d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  const SPEC_MIN = -100, SPEC_MAX = -10;
  function drawSpectrum(c, an, buf, fill) {
    an.getFloatFrequencyData(buf);
    const binHz = cur.fs / an.fftSize, top = G.pad.t, bottom = G.pad.t + plotH(), H = bottom - top;
    const x0 = G.pad.l, x1 = G.pad.l + plotW();
    c.beginPath();
    let first = true;
    for (let x = x0; x <= x1; x += 2) {
      const fa = xf(x), fb = xf(x + 2);
      const ia = fa / binHz, ib = fb / binHz;
      let v;
      if (Math.floor(ib) - Math.floor(ia) >= 1) {
        v = -200;
        for (let i = Math.max(1, Math.floor(ia)); i <= Math.min(buf.length - 1, Math.floor(ib)); i++) if (buf[i] > v) v = buf[i];
      } else {
        const i = Math.max(1, Math.floor(ia)), t = ia - i;
        const a = buf[Math.min(i, buf.length - 1)], b = buf[Math.min(i + 1, buf.length - 1)];
        v = a + (b - a) * clamp(t, 0, 1);
      }
      if (!isFinite(v)) v = SPEC_MIN;
      v += 3 * Math.log2(fa / 1000); // inclinación +3 dB/oct: el ruido rosa se ve plano
      const y = bottom - clamp((v - SPEC_MIN) / (SPEC_MAX - SPEC_MIN), 0, 1) * H;
      if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y);
    }
    if (fill) {
      c.strokeStyle = G.colors['spec-post-line'];
      c.lineWidth = 1.2;
      c.stroke();
      c.lineTo(x1, bottom);
      c.lineTo(x0, bottom);
      c.closePath();
      c.fillStyle = G.colors['spec-post'];
      c.fill();
    } else {
      c.strokeStyle = G.colors['spec-pre'];
      c.lineWidth = 1;
      c.stroke();
    }
  }

  function drawGraph() {
    const c = G.c, W = G.w, H = G.h, P = G.pad, s = cur.s;
    c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';
    c.textBaseline = 'middle';

    // rejilla de frecuencias
    const fLines = [30, 40, 50, 60, 70, 80, 90, 200, 300, 400, 600, 700, 800, 900, 3000, 4000, 6000, 7000, 8000, 9000];
    const fMain = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    c.lineWidth = 1;
    c.strokeStyle = G.colors.grid;
    c.beginPath();
    for (const f of fLines) { const x = Math.round(fx(f)) + 0.5; c.moveTo(x, P.t); c.lineTo(x, P.t + plotH()); }
    c.stroke();
    c.strokeStyle = G.colors['grid-strong'];
    c.beginPath();
    c.fillStyle = G.colors.muted;
    c.textAlign = 'center';
    for (const f of fMain) {
      const x = Math.round(fx(f)) + 0.5;
      c.moveTo(x, P.t); c.lineTo(x, P.t + plotH());
      const lbl = f >= 1000 ? (f / 1000) + 'k' : String(f);
      c.fillText(lbl, clamp(x, P.l + 8, W - P.r - 10), H - P.b / 2);
    }
    c.stroke();

    // rejilla de ganancia
    const step = G.range <= 6 ? 2 : (G.range <= 12 ? 3 : 6);
    c.textAlign = 'right';
    c.beginPath();
    c.strokeStyle = G.colors.grid;
    for (let g = -G.range; g <= G.range + 0.01; g += step) {
      const y = Math.round(gy(g)) + 0.5;
      if (g !== 0) { c.moveTo(P.l, y); c.lineTo(W - P.r, y); }
      c.fillText((g > 0 ? '+' : '') + g, P.l - 6, y);
    }
    c.stroke();
    c.strokeStyle = G.colors.zero;
    c.beginPath();
    const y0 = Math.round(gy(0)) + 0.5;
    c.moveTo(P.l, y0); c.lineTo(W - P.r, y0);
    c.stroke();

    // espectro
    if (G.showSpec && cur.running && cur.ctx && cur.ctx.state === 'running') {
      c.save();
      c.beginPath();
      c.rect(P.l, P.t, plotW(), plotH());
      c.clip();
      drawSpectrum(c, cur.anaPost, cur.specPost, true);
      drawSpectrum(c, cur.anaPre, cur.specPre, false);
      c.restore();
    }

    // curvas
    const cc = curves(), n = cc.freqs.length;
    c.save();
    c.beginPath();
    c.rect(P.l, P.t, plotW(), plotH());
    c.clip();
    const focus = G.drag >= 0 ? G.drag : (G.hover >= 0 ? G.hover : G.sel);
    if (focus >= 0 && cc.per[focus]) {
      const per = cc.per[focus];
      c.beginPath();
      c.moveTo(fx(cc.freqs[0]), y0);
      for (let k = 0; k < n; k++) c.lineTo(fx(cc.freqs[k]), gy(clamp(per[k], -G.range * 1.2, G.range * 1.2)));
      c.lineTo(fx(cc.freqs[n - 1]), y0);
      c.closePath();
      c.globalAlpha = 0.22;
      c.fillStyle = bandColor(focus);
      c.fill();
      c.globalAlpha = 1;
    }
    c.beginPath();
    for (let k = 0; k < n; k++) {
      const x = fx(cc.freqs[k]), y = gy(clamp(cc.total[k], -G.range * 1.2, G.range * 1.2));
      if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = G.colors.curve;
    c.lineWidth = 2.5;
    c.globalAlpha = s.bypass ? 0.35 : 1;
    c.stroke();
    c.globalAlpha = 1;
    c.restore();

    // puntos de control
    c.textAlign = 'center';
    c.font = '700 10px system-ui, -apple-system, Segoe UI, sans-serif';
    s.bands.forEach((b, i) => {
      const p = handlePos(i), active = i === focus;
      c.beginPath();
      c.arc(p.x, p.y, active ? 10 : 8, 0, Math.PI * 2);
      c.fillStyle = bandColor(i);
      c.globalAlpha = b.on ? 1 : 0.35;
      c.fill();
      c.lineWidth = active ? 2.5 : 1.5;
      c.strokeStyle = active ? G.colors.text : 'rgba(0,0,0,.35)';
      c.stroke();
      c.fillStyle = '#111';
      c.fillText(String(i + 1), p.x, p.y + 0.5);
      c.globalAlpha = 1;
    });

    if (s.bypass) {
      c.textAlign = 'right';
      c.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
      c.fillStyle = G.colors.muted;
      c.fillText('EQ desactivado (A/B)', W - P.r - 6, P.t + 12);
    }
  }

  function showTip() {
    const tip = $('#tip'), i = G.drag >= 0 ? G.drag : G.hover;
    if (i >= 0 && cur.s.bands[i]) {
      const b = cur.s.bands[i], T = TYPES[b.t], p = handlePos(i);
      let t = '#' + (i + 1) + ' · ' + T.label.replace(/ \(.+\)/, '') + ' · ' + fmtHz(b.f);
      if (T.gain) t += ' · ' + fmtDb(b.g);
      if (T.q) t += ' · Q ' + b.q.toFixed(2);
      tip.textContent = t;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = clamp(p.x - tw / 2, 4, G.w - tw - 4) + 'px';
      tip.style.top = (p.y > 50 ? p.y - 40 : p.y + 16) + 'px';
    } else if (G.mouse) {
      const f = xf(G.mouse.x), cc = curves();
      const k = Math.round(Math.log(f / F_MIN) / LOG_SPAN * (cc.freqs.length - 1));
      tip.textContent = fmtHz(f) + ' · EQ ' + fmtDb(cc.total[clamp(k, 0, cc.freqs.length - 1)]);
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = clamp(G.mouse.x + 12, 4, G.w - tw - 4) + 'px';
      tip.style.top = clamp(G.mouse.y - 30, 4, G.h - 30) + 'px';
    } else {
      tip.hidden = true;
    }
  }

  function graphEvents() {
    const cv = G.cv;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = pos(e), i = hit(p.x, p.y);
      if (i >= 0) {
        G.drag = i;
        G.sel = i;
        G.last = p;
        cv.setPointerCapture(e.pointerId);
        ui.markSelected();
        e.preventDefault();
      } else {
        G.sel = -1;
        ui.markSelected();
      }
    });

    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      G.mouse = p;
      if (G.drag >= 0) {
        const b = cur.s.bands[G.drag], k = e.shiftKey ? 0.2 : 1;
        const dx = p.x - G.last.x, dy = p.y - G.last.y;
        G.last = p;
        b.f = round(clamp(b.f * Math.exp(dx / plotW() * LOG_SPAN * k), F_MIN, F_MAX), b.f < 100 ? 1 : 0);
        if (TYPES[b.t].gain) b.g = round(clamp(b.g - dy / plotH() * 2 * G.range * k, -G.range, G.range), 1);
        cur.s.presetName = 'Personalizado';
        cur.bandChanged(G.drag);
        ui.updateBandRow(G.drag);
        ui.renderPresetName();
      } else {
        G.hover = hit(p.x, p.y);
        cv.style.cursor = G.hover >= 0 ? 'grab' : 'crosshair';
      }
      showTip();
    });

    const end = (e) => {
      if (G.drag >= 0) {
        try { cv.releasePointerCapture(e.pointerId); } catch (er) { /* nada */ }
        G.drag = -1;
        cur.save();
        ui.renderPresets();
      }
      showTip();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { if (G.drag < 0) { G.hover = -1; G.mouse = null; showTip(); } });

    cv.addEventListener('wheel', (e) => {
      const p = pos(e), i = hit(p.x, p.y) >= 0 ? hit(p.x, p.y) : G.sel;
      if (i < 0 || !cur.s.bands[i]) return;
      const b = cur.s.bands[i];
      if (!TYPES[b.t].q) return;
      e.preventDefault();
      b.q = round(clamp(b.q * Math.pow(1.1, e.deltaY < 0 ? 1 : -1), 0.1, 30), 2);
      cur.s.presetName = 'Personalizado';
      cur.bandChanged(i);
      ui.updateBandRow(i);
      ui.renderPresetName();
      G.hover = i;
      showTip();
    }, { passive: false });

    cv.addEventListener('dblclick', (e) => {
      const p = pos(e), i = hit(p.x, p.y);
      if (i >= 0) {
        const b = cur.s.bands[i];
        if (TYPES[b.t].gain) { b.g = 0; cur.bandChanged(i); ui.updateBandRow(i); }
        return;
      }
      addBand(round(xf(p.x), 0), round(clamp(yg(p.y), -G.range, G.range), 1));
    });

    cv.addEventListener('contextmenu', (e) => {
      const p = pos(e), i = hit(p.x, p.y);
      if (i < 0) return;
      e.preventDefault();
      removeBand(i);
    });
  }

  function addBand(f, g) {
    const s = cur.s;
    if (s.bands.length >= MAX_BANDS) { toast('Máximo ' + MAX_BANDS + ' bandas por canal.'); return; }
    if (f == null) {
      // la frecuencia en el hueco más grande (en escala logarítmica)
      const fs = s.bands.map((b) => b.f).concat([F_MIN, F_MAX]).sort((a, b) => a - b);
      let best = 1000, gap = 0;
      for (let i = 1; i < fs.length; i++) {
        const gl = Math.log(fs[i] / fs[i - 1]);
        if (gl > gap) { gap = gl; best = Math.sqrt(fs[i] * fs[i - 1]); }
      }
      f = round(best, 0);
      g = 0;
    }
    s.bands.push({ t: 'PK', f: clamp(f, F_MIN, F_MAX), g: g || 0, q: 1.41, on: true });
    s.presetName = 'Personalizado';
    G.sel = s.bands.length - 1;
    cur.changed('struct');
    ui.renderBands();
    ui.renderPresets();
  }

  function removeBand(i) {
    cur.s.bands.splice(i, 1);
    cur.s.presetName = 'Personalizado';
    G.sel = -1; G.hover = -1; G.drag = -1;
    cur.changed('struct');
    ui.renderBands();
    ui.renderPresets();
    showTip();
  }

  // =====================================================================
  // Interfaz
  // =====================================================================
  const SOURCES = {
    mic: [['device', 'Micrófono / entrada'], ['file', 'Archivo de audio (prueba)'], ['noise', 'Ruido rosa (prueba)']],
    pc: [['device', 'Entrada (cable virtual, Mezcla estéreo)'], ['display', 'Audio del sistema (compartir pantalla)'],
      ['file', 'Archivo de audio'], ['noise', 'Ruido rosa (prueba)']],
  };
  const isVirtual = (l) => /cable|voicemeeter|vb-audio|blackhole|loopback|virtual/i.test(l || '');
  const isStereoMix = (l) => /mezcla est|stereo mix|what u hear|wave out/i.test(l || '');

  const ui = {
    refresh() {
      this.renderTabs();
      this.renderIO();
      this.renderBands();
      this.renderPresets();
      this.renderBrands();
      this.renderMine();
      this.renderAuto();
      this.renderDyn();
      this.renderPresetName();
      G.cache.key = '';
    },

    renderTabs() {
      $$('.tab').forEach((t) => {
        const ch = channels[t.dataset.ch];
        t.setAttribute('aria-selected', String(ch === cur));
        t.classList.toggle('on', ch.running);
        let st = 'Detenido';
        if (ch.running) {
          const src = ch.s.sourceType;
          st = 'Activo · ' + (src === 'device' ? (labelOf(devs.inputs, ch.s.inputId) || 'entrada predeterminada')
            : src === 'display' ? 'audio del sistema' : src === 'file' ? 'archivo' : 'ruido rosa');
        }
        $('[data-status]', t).textContent = st;
      });
    },

    renderIO() {
      const s = cur.s;
      const srcSel = $('#srcType');
      srcSel.innerHTML = SOURCES[cur.id].map(([v, l]) => '<option value="' + v + '">' + esc(l) + '</option>').join('');
      if (!SOURCES[cur.id].some(([v]) => v === s.sourceType)) s.sourceType = 'device';
      srcSel.value = s.sourceType;

      $('#inField').hidden = s.sourceType !== 'device';
      $('#fileField').hidden = s.sourceType !== 'file';

      const inSel = $('#inDev');
      const inOpts = ['<option value="default">Predeterminada del sistema</option>'];
      devs.inputs.forEach((d, i) => inOpts.push('<option value="' + esc(d.deviceId) + '">' + esc(d.label || 'Entrada ' + (i + 1)) + '</option>'));
      if (s.inputId !== 'default' && !devs.inputs.some((d) => d.deviceId === s.inputId)) {
        inOpts.push('<option value="' + esc(s.inputId) + '">' + esc(s.inputLabel || 'Dispositivo guardado') + '</option>');
      }
      inSel.innerHTML = inOpts.join('');
      inSel.value = s.inputId;

      const outSel = $('#outDev');
      const outOpts = ['<option value="none">Ninguna (solo analizar)</option>', '<option value="default">Predeterminada del sistema</option>'];
      devs.outputs.forEach((d, i) => outOpts.push('<option value="' + esc(d.deviceId) + '">' + esc(d.label || 'Salida ' + (i + 1)) + '</option>'));
      if (!['none', 'default'].includes(s.outputId) && !devs.outputs.some((d) => d.deviceId === s.outputId)) {
        outOpts.push('<option value="' + esc(s.outputId) + '">' + esc(s.outputLabel || 'Salida guardada') + '</option>');
      }
      outSel.innerHTML = outOpts.join('');
      outSel.value = s.outputId;

      $('#monitor').checked = s.monitor;
      const btn = $('#btnStart');
      btn.textContent = cur.running ? '■ Detener' : '▶ Iniciar';
      btn.classList.toggle('running', cur.running);
      btn.disabled = cur.busy;

      const box = $('#playerBox');
      box.innerHTML = '';
      if (cur.mediaEl) box.appendChild(cur.mediaEl);

      this.renderHint();
      this.renderTabs();
    },

    renderHint() {
      const s = cur.s, h = [];
      const inL = labelOf(devs.inputs, s.inputId) || s.inputLabel;
      const outL = s.outputId === 'none' ? '' : (labelOf(devs.outputs, s.outputId) || s.outputLabel);
      if (cur.isMic) {
        if (s.sourceType !== 'device') h.push('Fuente de prueba: escucha cómo suena cada preset.');
        if (s.outputId === 'none') h.push('Salida «Ninguna»: solo analizas. Para usarlo en Discord, Zoom u OBS elige «CABLE Input» como salida (ver Guía).');
        else if (isVirtual(outL)) h.push('✔ En Discord, Zoom, OBS o Meet elige «' + outL.replace(/input/i, 'Output') + '» como micrófono.');
        else if (s.monitor) h.push('Te estás escuchando: usa audífonos (con parlantes se acopla).');
      } else {
        if (s.sourceType === 'device') {
          if (isVirtual(inL)) h.push('✔ Recuerda: en Windows la salida de sonido predeterminada debe ser el cable virtual, y aquí la Salida tus audífonos o parlantes reales.');
          else if (isStereoMix(inL)) h.push('«Mezcla estéreo» capta lo que ya suena: úsalo para analizar con Salida «Ninguna», o enviarás eco a tus parlantes.');
          else h.push('Para ecualizar el audio del PC en tiempo real elige como entrada la salida de un cable virtual (ver Guía). Para todo Windows sin latencia: exporta a Equalizer APO.');
        } else if (s.sourceType === 'display') {
          h.push('Comparte «Pantalla completa» con «audio del sistema». Ideal para analizar y para el Ajuste automático; deja la Salida en «Ninguna» si es la misma tarjeta de sonido (evita eco).');
        } else if (s.sourceType === 'file') {
          h.push('El archivo se reproduce en bucle a través del ecualizador.');
        } else {
          h.push('Ruido rosa: escucha cómo la EQ cambia el balance tonal.');
        }
      }
      if (cur.sinkError) h.push('⚠ ' + cur.sinkError);
      $('#ioHint').textContent = h.join(' ');
    },

    renderBands() {
      const s = cur.s;
      const typeOpts = (t) => Object.entries(TYPES).map(([k, v]) => '<option value="' + k + '"' + (k === t ? ' selected' : '') + '>' + v.label + '</option>').join('');
      $('#bandRows').innerHTML = s.bands.map((b, i) => {
        const T = TYPES[b.t];
        return '<tr data-i="' + i + '" class="' + (i === G.sel ? 'sel ' : '') + (b.on ? '' : 'off') + '">' +
          '<td><span class="dot" style="background:' + bandColor(i) + '">' + (i + 1) + '</span></td>' +
          '<td><input type="checkbox" data-k="on"' + (b.on ? ' checked' : '') + ' aria-label="Activar banda ' + (i + 1) + '"></td>' +
          '<td class="type-cell"><select data-k="t" aria-label="Tipo de filtro">' + typeOpts(b.t) + '</select></td>' +
          '<td class="num-cell"><input type="number" data-k="f" min="10" max="24000" step="1" value="' + fmtF(b.f) + '" aria-label="Frecuencia en Hz"></td>' +
          '<td class="num-cell"><input type="number" data-k="g" min="-30" max="30" step="0.1" value="' + (T.gain ? b.g.toFixed(1) : '') + '"' + (T.gain ? '' : ' disabled') + ' aria-label="Ganancia en dB"></td>' +
          '<td class="num-cell"><input type="number" data-k="q" min="0.1" max="40" step="0.01" value="' + (T.q ? b.q.toFixed(2) : '0.71') + '"' +
            (T.q ? '' : ' disabled title="Los shelves usan pendiente fija (Q 0.71)"') + ' aria-label="Q"></td>' +
          '<td><button class="btn ghost sm" data-del title="Borrar banda" aria-label="Borrar banda ' + (i + 1) + '">✕</button></td></tr>';
      }).join('') || '<tr><td colspan="7" class="muted">Sin bandas. Doble clic en el gráfico o «+ Banda».</td></tr>';
      $('#bandCount').textContent = s.bands.length + '/' + MAX_BANDS;
      $('#btnAdd').disabled = s.bands.length >= MAX_BANDS;
    },

    updateBandRow(i) {
      const tr = $('#bandRows tr[data-i="' + i + '"]'), b = cur.s.bands[i];
      if (!tr || !b) return;
      const set = (k, v) => { const el = $('[data-k="' + k + '"]', tr); if (el && document.activeElement !== el) el.value = v; };
      set('f', fmtF(b.f));
      if (TYPES[b.t].gain) set('g', b.g.toFixed(1));
      if (TYPES[b.t].q) set('q', b.q.toFixed(2));
      this.renderDynValues();
    },

    markSelected() {
      $$('#bandRows tr[data-i]').forEach((tr) => tr.classList.toggle('sel', +tr.dataset.i === G.sel));
    },

    renderPresetName() {
      $('#presetName').textContent = cur.s.presetName ? '· ' + cur.s.presetName : '';
    },

    renderPresets() {
      const list = P[cur.id];
      let html = '', cat = '';
      list.forEach((p, i) => {
        if (p.cat !== cat) { cat = p.cat; html += '<div class="cat">' + esc(cat) + '</div>'; }
        html += '<button class="item' + (cur.s.presetName === p.name ? ' active' : '') + '" data-preset="' + i + '"><b>' + esc(p.name) + '</b><small>' + esc(p.desc) + '</small></button>';
      });
      $('#presetList').innerHTML = html;
      this.renderPresetName();
    },

    brandSel: -1,
    renderBrands() {
      const isPc = cur.id === 'pc';
      $('#brandMicNote').hidden = isPc;
      $('#brandBody').hidden = !isPc;
      if (!isPc) return;
      const terms = norm($('#brandSearch').value).split(/\s+/).filter(Boolean);
      let html = '', brand = '', count = 0;
      PROFILES.forEach((p, i) => {
        const hay = norm(p.n);
        if (terms.length && !terms.every((t) => hay.includes(t))) return;
        const b = p.n.split(' ')[0];
        if (b !== brand) { brand = b; html += '<div class="cat">' + esc(b) + '</div>'; }
        html += '<button class="item' + (i === this.brandSel ? ' active' : '') + '" data-prof="' + i + '"><b>' + esc(p.n) + '</b><small>Medición: ' + esc(p.s) + ' · ' + p.f.length + ' filtros</small></button>';
        count++;
      });
      $('#brandList').innerHTML = html || '<p class="small muted">No hay coincidencias. Puedes importar cualquier modelo desde AutoEq en «Exportar → Importar».</p>';
      const sel = PROFILES[this.brandSel];
      $('#brandSel').innerHTML = sel ? 'Seleccionado: <b>' + esc(sel.n) + '</b>' : 'Elige un modelo (' + count + ' disponibles).';
      $('#btnBrandFix').disabled = !sel;
      $('#btnBrandEmu').disabled = !sel;
    },

    renderMine() {
      const mine = store.get('eqlibre.mine', []);
      $('#mineList').innerHTML = mine.length ? mine.map((p, i) =>
        '<div class="mine-row"><button class="item" data-mine="' + i + '"><b>' + esc(p.name) + '</b><small>' +
        (p.canal === 'mic' ? 'Micrófono' : 'Audio del PC') + ' · ' + (p.bands ? p.bands.length : 0) + ' bandas' +
        (p.date ? ' · ' + new Date(p.date).toLocaleDateString() : '') + '</small></button>' +
        '<button class="btn ghost sm danger" data-mine-del="' + i + '" title="Borrar" aria-label="Borrar ' + esc(p.name) + '">✕</button></div>').join('')
        : '<p class="small muted">Aún no guardas presets. Ajusta la EQ y guárdala con un nombre.</p>';
    },

    renderAuto() {
      const s = cur.s;
      const opts = Object.entries(TARGETS).filter(([, t]) => t.ch === cur.id);
      if (!opts.some(([k]) => k === s.auto.target)) s.auto.target = opts[0][0];
      $('#autoTarget').innerHTML = opts.map(([k, t]) => '<option value="' + k + '">' + esc(t.label) + '</option>').join('');
      $('#autoTarget').value = s.auto.target;
      $('#autoDesc').textContent = TARGETS[s.auto.target].desc;
      $('#autoDur').value = String(s.auto.dur);
      $('#autoStr').value = String(s.auto.strength);
      $('#autoStrTxt').textContent = s.auto.strength + '%';
      const running = autoRun.active && autoRun.ch === cur;
      $('#btnAuto').textContent = running ? 'Cancelar medición' : 'Medir y ajustar';
      $('#btnAuto').disabled = autoRun.active && autoRun.ch !== cur;
      $('.progress').hidden = !running;
      if (!running && autoRun.ch !== cur) $('#autoResult').innerHTML = '';
    },

    renderDyn() {
      const s = cur.s;
      $('#preAuto').checked = s.preAuto;
      $('#preamp').disabled = s.preAuto;
      $('#outGain').value = s.outGain;
      $('#gateBox').hidden = !cur.isMic;
      $('#webrtcBox').hidden = !cur.isMic;
      $('#gateOn').checked = s.gate.on;
      $('#gateOn').disabled = !!cur.gateError;
      $('#gateThr').value = s.gate.threshold;
      $('#gateRel').value = s.gate.release;
      $('#compTitle').textContent = cur.isMic ? 'Compresor' : 'Nivelador de volumen (compresor)';
      $('#compOn').checked = s.comp.on;
      $('#compThr').value = s.comp.threshold;
      $('#compRatio').value = s.comp.ratio;
      $('#compAtk').value = s.comp.attack;
      $('#compRel').value = s.comp.release;
      $('#compMk').value = s.comp.makeup;
      $('#limOn').checked = s.limiter.on;
      $('#limCeil').value = s.limiter.ceiling;
      $('#wNs').checked = s.webrtc.ns;
      $('#wAec').checked = s.webrtc.aec;
      $('#wAgc').checked = s.webrtc.agc;
      $('#btnBypass').setAttribute('aria-pressed', String(s.bypass));
      $('#btnBypass').textContent = s.bypass ? 'A/B: sin EQ' : 'A/B: con EQ';
      this.renderDynValues();
    },

    renderDynValues() {
      const s = cur.s, pre = cur.preampDb();
      if (s.preAuto) $('#preamp').value = pre;
      else $('#preamp').value = s.preamp;
      $('#preTxt').textContent = fmtDb(pre);
      $('#outTxt').textContent = fmtDb(s.outGain);
      $('#gateThrTxt').textContent = s.gate.threshold + ' dB';
      $('#gateRelTxt').textContent = s.gate.release + ' ms';
      $('#compThrTxt').textContent = s.comp.threshold + ' dB';
      $('#compRatioTxt').textContent = s.comp.ratio + ':1';
      $('#compAtkTxt').textContent = s.comp.attack + ' ms';
      $('#compRelTxt').textContent = s.comp.release + ' ms';
      $('#compMkTxt').textContent = fmtDb(s.comp.makeup);
      $('#limCeilTxt').textContent = s.limiter.ceiling.toFixed(1) + ' dB';
    },
  };

  // ---------- medidores ----------
  const meterFrac = (db) => clamp((db + 60) / 60, 0, 1);
  const disp = { mic: { a: 0, b: 0 }, pc: { a: 0, b: 0 } };

  function drawMeters(now) {
    for (const ch of Object.values(channels)) {
      const d = disp[ch.id], L = ch.lv;
      d.a = Math.max(meterFrac(L.inRms), d.a - 0.03);
      d.b = Math.max(meterFrac(L.outRms), d.b - 0.03);
      const mini = $('.tab[data-ch="' + ch.id + '"] .mini-meter i');
      mini.style.transform = 'scaleX(' + d.b.toFixed(3) + ')';
    }
    const L = cur.lv, d = disp[cur.id];
    $('#mIn').style.transform = 'scaleX(' + d.a.toFixed(3) + ')';
    $('#mOut').style.transform = 'scaleX(' + d.b.toFixed(3) + ')';
    const on = cur.running;
    $('#mInPk').style.left = (meterFrac(L.inHold) * 100).toFixed(1) + '%';
    $('#mOutPk').style.left = (meterFrac(L.outHold) * 100).toFixed(1) + '%';
    $('#mInPk').style.opacity = on ? '' : '0';
    $('#mOutPk').style.opacity = on ? '' : '0';
    $('#mInTxt').textContent = on ? (L.inRms > -100 ? L.inRms.toFixed(1) + ' dB' : '−∞') : '—';
    $('#mOutTxt').textContent = on ? (L.outRms > -100 ? L.outRms.toFixed(1) + ' dB' : '−∞') : '—';
    $('#clip').hidden = !(on && now < L.clipUntil);
    const gl = $('#gateLed');
    gl.hidden = !(on && cur.isMic && cur.gate && cur.s.gate.on);
    gl.textContent = cur.gateOpen ? 'Gate abierto' : 'Gate cerrado';
    gl.classList.toggle('open', cur.gateOpen);
    const gr = $('#grTxt');
    if (on && cur.ctx && (cur.s.comp.on || cur.s.limiter.on)) {
      const parts = [];
      if (cur.s.comp.on) parts.push('Comp ' + cur.comp.reduction.toFixed(1) + ' dB');
      if (cur.s.limiter.on && cur.limiter.reduction < -0.1) parts.push('Lim ' + cur.limiter.reduction.toFixed(1) + ' dB');
      gr.textContent = parts.join(' · ');
      gr.hidden = !parts.length;
    } else gr.hidden = true;
    if (cur.ctx) {
      const lat = ((cur.ctx.baseLatency || 0) + (cur.ctx.outputLatency || 0)) * 1000;
      $('#latency').textContent = (lat > 0 ? 'Latencia ≈ ' + Math.round(lat) + ' ms · ' : '') + Math.round(cur.ctx.sampleRate / 100) / 10 + ' kHz';
    } else $('#latency').textContent = '';
  }

  function frame(now) {
    for (const ch of Object.values(channels)) ch.readLevels(now);
    drawGraph();
    drawMeters(now);
    requestAnimationFrame(frame);
  }

  // =====================================================================
  // Eventos
  // =====================================================================
  function selectChannel(id) {
    cur = channels[id];
    store.set('eqlibre.tab', id);
    G.sel = G.hover = G.drag = -1;
    ui.brandSel = -1;
    ui.refresh();
  }

  async function guard(fn) {
    try { await fn(); } catch (e) { if (!(e instanceof UserError)) console.error(e); toast(friendly(e, cur.s.sourceType), 'error'); }
    ui.refresh();
  }

  function bindRange(id, set) {
    const el = $(id);
    el.addEventListener('input', () => {
      set(num(el.value));
      cur.changed('param');
      ui.renderDynValues();
    });
  }

  function wire() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => selectChannel(t.dataset.ch)));

    $('#btnStart').addEventListener('click', () => guard(async () => {
      const ch = cur;
      if (ch.running) { await ch.stop(); return; }
      ui.renderIO();
      await ch.start();
      await refreshDevices();
    }));

    $('#srcType').addEventListener('change', (e) => guard(async () => {
      const ch = cur;
      ch.s.sourceType = e.target.value;
      if (ch.s.sourceType === 'display' && ch.s.outputId === 'default') {
        ch.s.outputId = 'none';
        toast('Salida cambiada a «Ninguna» para evitar eco al capturar el audio del sistema.');
        await ch.applyOutput();
      }
      ch.save();
      if (ch.running) {
        if (ch.s.sourceType === 'file' && !ch.file) await ch.stop();
        else await ch.start();
      }
    }));

    $('#inDev').addEventListener('change', (e) => guard(async () => {
      const ch = cur;
      ch.s.inputId = e.target.value;
      ch.s.inputLabel = labelOf(devs.inputs, ch.s.inputId);
      ch.save();
      await ch.restartIfRunning();
    }));

    $('#outDev').addEventListener('change', (e) => guard(async () => {
      const ch = cur;
      ch.s.outputId = e.target.value;
      ch.s.outputLabel = labelOf(devs.outputs, ch.s.outputId);
      ch.save();
      await ch.applyOutput();
    }));

    $('#fileIn').addEventListener('change', (e) => guard(async () => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const ch = cur;
      ch.file = f;
      ch.s.sourceType = 'file';
      await ch.start();
    }));

    $('#btnRefresh').addEventListener('click', (e) => { e.preventDefault(); refreshDevices(); });

    $('#monitor').addEventListener('change', (e) => { cur.s.monitor = e.target.checked; cur.changed('param'); ui.renderHint(); });

    $('#btnPerm').addEventListener('click', () => guard(async () => {
      const st = await getInputStream('default', null);
      st.getTracks().forEach((t) => t.stop());
      await refreshDevices();
      toast('Listo: ya puedes elegir tus dispositivos.');
    }));

    // gráfico
    $('#btnBypass').addEventListener('click', () => {
      cur.s.bypass = !cur.s.bypass;
      cur.changed('wire');
      ui.renderDyn();
    });
    $('#rangeSel').addEventListener('change', (e) => { G.range = +e.target.value; store.set('eqlibre.range', G.range); });
    $('#showSpec').addEventListener('change', (e) => { G.showSpec = e.target.checked; store.set('eqlibre.spec', G.showSpec); });
    $('#btnFlat').addEventListener('click', () => {
      applyPreset(cur, { bands: P[cur.id][0].bands }, P[cur.id][0].name);
    });

    // bandas
    $('#btnAdd').addEventListener('click', () => addBand());
    const rows = $('#bandRows');
    rows.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-i]'), k = e.target.dataset.k;
      if (!tr || !k) return;
      const i = +tr.dataset.i, b = cur.s.bands[i];
      cur.s.presetName = 'Personalizado';
      if (k === 'on') {
        b.on = e.target.checked;
        tr.classList.toggle('off', !b.on);
        cur.changed('wire');
      } else if (k === 't') {
        const t = e.target.value;
        if (t === 'HP' || t === 'LP') b.q = 0.71;
        else if (t === 'NO') b.q = 10;
        else if (t === 'PK' && (b.q < 0.3 || b.q > 8)) b.q = 1.41;
        b.t = t;
        cur.changed('struct');
        ui.renderBands();
      } else {
        const v = num(e.target.value);
        if (!isFinite(v)) return;
        if (k === 'f') b.f = clamp(v, 10, 24000);
        if (k === 'g') b.g = clamp(v, -30, 30);
        if (k === 'q') b.q = clamp(v, 0.1, 40);
        cur.bandChanged(i);
      }
      ui.renderDynValues();
      ui.renderPresets();
    });
    rows.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (!tr) return;
      if (e.target.closest('[data-del]')) { removeBand(+tr.dataset.i); return; }
      G.sel = +tr.dataset.i;
      ui.markSelected();
    });

    // presets
    $$('[data-ptab]').forEach((b) => b.addEventListener('click', () => {
      $$('[data-ptab]').forEach((x) => x.classList.toggle('active', x === b));
      $$('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.ptab; });
      store.set('eqlibre.ptab', b.dataset.ptab);
    }));
    $('#presetList').addEventListener('click', (e) => {
      const it = e.target.closest('[data-preset]');
      if (!it) return;
      const p = P[cur.id][+it.dataset.preset];
      applyPreset(cur, p, p.name);
      toast('Preset aplicado: ' + p.name);
    });

    $('#brandSearch').addEventListener('input', () => ui.renderBrands());
    $('#brandList').addEventListener('click', (e) => {
      const it = e.target.closest('[data-prof]');
      if (!it) return;
      ui.brandSel = +it.dataset.prof;
      ui.renderBrands();
    });
    $('#btnBrandFix').addEventListener('click', () => guard(async () => {
      const p = PROFILES[ui.brandSel];
      if (!p) return;
      applyProfile(cur, p, false);
      toast('Corrección aplicada para ' + p.n + '. Compara con A/B.');
    }));
    $('#btnBrandEmu').addEventListener('click', () => guard(async () => {
      const p = PROFILES[ui.brandSel];
      if (!p) return;
      applyProfile(cur, p, true);
      toast('Ahora tus audífonos imitan a ' + p.n + '.');
    }));

    // mis presets
    $('#btnSaveMine').addEventListener('click', () => {
      const name = $('#myName').value.trim() || cur.s.presetName || 'Mi preset';
      const mine = store.get('eqlibre.mine', []);
      const snap = presetSnapshot(cur, name);
      const at = mine.findIndex((p) => p.name === name && p.canal === cur.id);
      if (at >= 0) mine[at] = snap; else mine.unshift(snap);
      store.set('eqlibre.mine', mine);
      cur.s.presetName = name;
      cur.save();
      $('#myName').value = '';
      ui.renderMine();
      ui.renderPresetName();
      toast('Guardado: ' + name);
    });
    $('#mineList').addEventListener('click', (e) => {
      const mine = store.get('eqlibre.mine', []);
      const del = e.target.closest('[data-mine-del]');
      if (del) {
        const p = mine[+del.dataset.mineDel];
        if (p && confirm('¿Borrar el preset «' + p.name + '»?')) {
          mine.splice(+del.dataset.mineDel, 1);
          store.set('eqlibre.mine', mine);
          ui.renderMine();
        }
        return;
      }
      const it = e.target.closest('[data-mine]');
      if (!it) return;
      const p = mine[+it.dataset.mine];
      if (p) { applyPreset(cur, p, p.name); toast('Cargado: ' + p.name); }
    });
    $('#btnMineExport').addEventListener('click', () => {
      download('ecualizador-libre-presets.json', JSON.stringify(store.get('eqlibre.mine', []), null, 2), 'application/json');
    });
    $('#mineImport').addEventListener('change', (e) => guard(async () => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch (er) { throw new UserError('El archivo no es un respaldo válido.'); }
      const list = (Array.isArray(data) ? data : [data]).filter((p) => p && Array.isArray(p.bands) && p.name);
      if (!list.length) throw new UserError('El archivo no contiene presets.');
      const mine = store.get('eqlibre.mine', []);
      for (const p of list) {
        const at = mine.findIndex((m) => m.name === p.name && m.canal === p.canal);
        if (at >= 0) mine[at] = p; else mine.push(p);
      }
      store.set('eqlibre.mine', mine);
      e.target.value = '';
      toast('Restaurados ' + list.length + ' presets.');
    }));

    // exportar / importar
    $('#btnCopyApo').addEventListener('click', async () => {
      const ok = await copyText(toApo(cur));
      toast(ok ? 'Copiado. Pégalo en config.txt de Equalizer APO o en Peace.' : 'No se pudo copiar; usa «config.txt».', ok ? '' : 'error');
    });
    $('#btnDlApo').addEventListener('click', () => download('config.txt', toApo(cur)));
    $('#btnDlGeq').addEventListener('click', () => download('GraphicEQ.txt', toGraphicEq(cur)));
    $('#btnDlJson').addEventListener('click', () => {
      const name = (cur.s.presetName || 'preset').replace(/[^\w\-áéíóúñ ]+/gi, '').trim() || 'preset';
      download(name + '.json', JSON.stringify(presetSnapshot(cur), null, 2), 'application/json');
    });
    const doImport = (text, name) => guard(async () => {
      const warn = importText(cur, text, name);
      toast('Importado.' + (warn.length ? ' ' + warn.join(' ') : ''));
    });
    $('#btnImport').addEventListener('click', () => doImport($('#importTxt').value, 'Importado'));
    $('#importFile').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const text = await f.text();
      e.target.value = '';
      doImport(text, f.name.replace(/\.(txt|json)$/i, '').replace(/ ParametricEQ$/i, ''));
    });

    // ajuste automático
    $('#autoTarget').addEventListener('change', (e) => { cur.s.auto.target = e.target.value; cur.save(); ui.renderAuto(); });
    $('#autoDur').addEventListener('change', (e) => { cur.s.auto.dur = +e.target.value; cur.save(); });
    $('#autoStr').addEventListener('input', (e) => { cur.s.auto.strength = +e.target.value; $('#autoStrTxt').textContent = e.target.value + '%'; cur.save(); });
    $('#btnAuto').addEventListener('click', async () => {
      if (autoRun.active) { autoRun.active = false; return; }
      const ch = cur;
      autoRun.active = true;
      autoRun.ch = ch;
      $('#autoProg').style.width = '0%';
      ui.renderAuto();
      let html;
      try {
        html = await runAuto(ch);
      } catch (e) {
        if (!(e instanceof UserError)) console.error(e);
        html = '<span class="err">' + esc(friendly(e, ch.s.sourceType)) + '</span>';
      }
      autoRun.active = false;
      ui.refresh();
      if (cur === ch) $('#autoResult').innerHTML = html;
    });

    // dinámica
    $('#preAuto').addEventListener('change', (e) => {
      const s = cur.s;
      if (!e.target.checked) s.preamp = cur.preampDb();
      s.preAuto = e.target.checked;
      cur.changed('param');
      ui.renderDyn();
    });
    bindRange('#preamp', (v) => { cur.s.preamp = v; });
    bindRange('#outGain', (v) => { cur.s.outGain = v; });
    bindRange('#gateThr', (v) => { cur.s.gate.threshold = v; });
    bindRange('#gateRel', (v) => { cur.s.gate.release = v; });
    bindRange('#compThr', (v) => { cur.s.comp.threshold = v; });
    bindRange('#compRatio', (v) => { cur.s.comp.ratio = v; });
    bindRange('#compAtk', (v) => { cur.s.comp.attack = v; });
    bindRange('#compRel', (v) => { cur.s.comp.release = v; });
    bindRange('#compMk', (v) => { cur.s.comp.makeup = v; });
    bindRange('#limCeil', (v) => { cur.s.limiter.ceiling = v; });
    $('#gateOn').addEventListener('change', (e) => { cur.s.gate.on = e.target.checked; cur.changed('wire'); });
    $('#compOn').addEventListener('change', (e) => { cur.s.comp.on = e.target.checked; cur.changed('wire'); });
    $('#limOn').addEventListener('change', (e) => { cur.s.limiter.on = e.target.checked; cur.changed('wire'); });
    for (const [id, k] of [['#wNs', 'ns'], ['#wAec', 'aec'], ['#wAgc', 'agc']]) {
      $(id).addEventListener('change', (e) => guard(async () => {
        cur.s.webrtc[k] = e.target.checked;
        cur.save();
        await cur.restartIfRunning();
      }));
    }

    // ayuda y tema
    $('#btnHelp').addEventListener('click', () => $('#helpDlg').showModal());
    $('#btnTheme').addEventListener('click', () => {
      const root = document.documentElement;
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      store.set('eqlibre.theme', root.dataset.theme);
      readColors();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);

    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    }
    window.addEventListener('resize', resizeGraph);
    if (window.ResizeObserver) new ResizeObserver(resizeGraph).observe($('.graph-wrap'));
    window.addEventListener('beforeunload', () => { for (const ch of Object.values(channels)) ch.save(true); });
  }

  function compat() {
    const msgs = [];
    if (!window.AudioContext) msgs.push('Tu navegador no soporta Web Audio. Usa Chrome o Edge actualizados.');
    if (!window.isSecureContext) msgs.push('Abre la app con el lanzador «Iniciar-Ecualizador» (servidor local); así el navegador permite usar el micrófono.');
    else if (!navigator.mediaDevices) msgs.push('El navegador no da acceso a dispositivos de audio.');
    if (window.AudioContext && !SINK_OK) msgs.push('Este navegador no permite elegir la salida de audio; usa Chrome o Edge 110+ para enviar el audio a un cable virtual.');
    const el = $('#compat');
    el.textContent = msgs.join(' ');
    el.hidden = !msgs.length;
  }

  // =====================================================================
  // Inicio
  // =====================================================================
  function boot() {
    const theme = store.get('eqlibre.theme', null);
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    G.cv = $('#graph');
    G.c = G.cv.getContext('2d');
    G.range = store.get('eqlibre.range', 18);
    G.showSpec = store.get('eqlibre.spec', true);
    $('#rangeSel').value = String(G.range);
    $('#showSpec').checked = G.showSpec;
    const ptab = store.get('eqlibre.ptab', 'presets');
    $$('[data-ptab]').forEach((x) => x.classList.toggle('active', x.dataset.ptab === ptab));
    $$('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== ptab; });
    readColors();
    resizeGraph();
    graphEvents();
    wire();
    compat();
    ui.refresh();
    refreshDevices();
    requestAnimationFrame(frame);
  }

  // Exponer para pruebas y depuración desde la consola.
  window.EQLibre = { channels, parseApo, toApo, toGraphicEq, coeffs, magDb, responseDb, designCorrection, fitBands, TARGETS, THIRD, applyProfile, importText };

  boot();
})();
