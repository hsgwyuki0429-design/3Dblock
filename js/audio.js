// 小さなWebAudioシンセ (外部アセットなし)

let ctx = null;
let master = null;
let muted = false;

export function initAudio() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
}

export function setMuted(m) {
  muted = m;
}

function tone(freq, { t = 0, dur = 0.15, type = "sine", vol = 0.5, glide = 0 } = {}) {
  if (!ctx || muted) return;
  const now = ctx.currentTime + t;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + glide), now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(vol, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g).connect(master);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}

export const sfx = {
  ui()     { tone(660, { dur: 0.06, type: "triangle", vol: 0.2 }); },
  pick()   { tone(520, { dur: 0.08, type: "triangle", vol: 0.3, glide: 160 }); },
  cancel() { tone(300, { dur: 0.1, type: "triangle", vol: 0.22, glide: -80 }); },
  place() {
    tone(300, { dur: 0.1, type: "sine", vol: 0.5, glide: -60 });
    tone(600, { dur: 0.07, type: "triangle", vol: 0.18 });
  },
  good() {
    // 最適解どおりに置けた時の軽い上昇2音 (褒めのチャイム)
    tone(784, { dur: 0.11, type: "triangle", vol: 0.28 });          // G5
    tone(1175, { t: 0.075, dur: 0.16, type: "triangle", vol: 0.26 }); // D6
    tone(1568, { t: 0.075, dur: 0.14, type: "sine", vol: 0.10 });     // 上ハモリ
  },
  clear(lines) {
    const base = [523, 659, 784, 988];  // C5 E5 G5 B5
    const count = Math.min(2 + lines, 5);
    for (let i = 0; i < count; i++) {
      tone(base[i % 4] * (1 + Math.floor(i / 4)), {
        t: i * 0.07, dur: 0.3, type: "sine", vol: 0.4,
      });
      tone(base[i % 4] * 2, { t: i * 0.07, dur: 0.18, type: "triangle", vol: 0.1 });
    }
    if (lines > 1) tone(1568, { t: count * 0.07, dur: 0.5, type: "sine", vol: 0.3 });
  },
  over() {
    const seq = [523, 494, 415, 330];
    seq.forEach((f, i) => tone(f, { t: i * 0.22, dur: 0.4, type: "sine", vol: 0.35 }));
  },
};
