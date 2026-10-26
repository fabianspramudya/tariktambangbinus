// ================== PENGATURAN ==================
const WIN_STEPS = 4;          // jumlah tarikan untuk menang
const TOUCH_ONLY = false;     // ubah ke true agar klik mouse di numpad diabaikan
const AUTO_BACK_SECONDS = 10; // layar menang otomatis kembali ke menu

// Waktu bot menjawab satu soal (milidetik): [paling cepat, paling lambat]
const BOT_SPEED = {
  1: [6000, 8500],
  2: [3800, 5500],
  3: [2000, 3200],
};
// Peluang bot menjawab benar
const BOT_ACCURACY = { 1: 0.8, 2: 0.9, 3: 0.97 };

// ================== STATUS PERMAINAN ==================
const state = {
  mode: 'pvp',      // 'pvp' atau 'bot'
  level: 1,         // level bot
  op: 'addsub',     // 'addsub' | 'mul' | 'div'
  pos: 0,           // posisi tambang: negatif = ke kiri (P1), positif = ke kanan (P2)
  playing: false,
  q: { 1: null, 2: null },      // soal tiap pemain
  input: { 1: '', 2: '' },      // jawaban yang sedang diketik
  timers: [],                   // semua setTimeout yang aktif (untuk dibatalkan)
};

const $ = (id) => document.getElementById(id);

// ================== EFEK SUARA ==================
// Suara dibuat langsung oleh browser (Web Audio API), jadi tidak perlu file mp3.
// Catatan: HP/tablet hanya mengizinkan suara setelah layar disentuh sekali,
// karena itu AudioContext baru dibuat saat sentuhan pertama.
const Sound = {
  ctx: null,
  on: true,

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  // Membunyikan satu nada: frekuensi (Hz), mulai (detik dari sekarang), durasi, jenis gelombang, volume
  tone(freq, start = 0, dur = 0.15, type = 'sine', vol = 0.25) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);   // naik cepat
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur); // memudar
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  },

  tap()     { this.tone(900, 0, 0.04, 'square', 0.04); },
  correct() { this.tone(660, 0, 0.1, 'triangle'); this.tone(990, 0.09, 0.18, 'triangle'); },
  wrong()   { this.tone(180, 0, 0.12, 'sawtooth', 0.15); this.tone(140, 0.12, 0.22, 'sawtooth', 0.15); },
  tick()    { this.tone(520, 0, 0.12, 'square', 0.12); },
  go()      { this.tone(1040, 0, 0.3, 'square', 0.15); },
  win() {
    // Fanfare: do-mi-sol-do tinggi lalu akor
    [523, 659, 784].forEach((f, i) => this.tone(f, i * 0.14, 0.18, 'triangle', 0.3));
    [523, 659, 784, 1047].forEach((f) => this.tone(f, 0.45, 0.8, 'triangle', 0.18));
  },
  lose() {
    [392, 349, 311, 262].forEach((f, i) => this.tone(f, i * 0.22, 0.3, 'triangle', 0.25));
  },
};

// Sentuhan pertama di mana saja akan "membuka kunci" suara
document.addEventListener('pointerdown', () => Sound.unlock(), { capture: true });

// ================== HELPER ==================
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function later(fn, ms) {
  const t = setTimeout(fn, ms);
  state.timers.push(t);
  return t;
}

function clearTimers() {
  state.timers.forEach(clearTimeout);
  state.timers = [];
}

function show(screenId) {
  document.querySelectorAll('.screen').forEach((s) => {
    s.classList.toggle('active', s.id === screenId);
  });
}

// ================== PEMBUAT SOAL ==================
function makeQuestion(op) {
  if (op === 'addsub') {
    if (Math.random() < 0.5) {
      const a = rand(1, 39);
      const b = rand(1, 40 - a);            // hasil maksimal 40
      return { text: `${a} + ${b}`, ans: a + b };
    }
    const a = rand(2, 40);
    const b = rand(1, a);                   // hasil tidak negatif
    return { text: `${a} − ${b}`, ans: a - b };
  }
  if (op === 'mul') {
    const a = rand(1, 11);
    const b = rand(1, 11);
    return { text: `${a} × ${b}`, ans: a * b };
  }
  // Pembagian: dibuat dari perkalian supaya hasilnya selalu bulat
  const divisor = rand(1, 11);
  const result = rand(1, 11);
  return { text: `${divisor * result} ÷ ${divisor}`, ans: result };
}

function newQuestion(p) {
  let q;
  do {
    q = makeQuestion(state.op);
  } while (state.q[p] && q.text === state.q[p].text); // hindari soal sama berturut-turut
  state.q[p] = q;
  $('q' + p).textContent = q.text + ' = ?';
}

// ================== TAMPILAN ==================
function renderInput(p) {
  $('a' + p).textContent = state.input[p];
}

function flash(p, cls) {
  const el = $('a' + p);
  el.classList.remove('good', 'bad');
  void el.offsetWidth; // trik agar animasi bisa diulang
  el.classList.add(cls);
  later(() => el.classList.remove(cls), 450);
}

function updateTeam(direction) {
  const team = $('team');
  // Setiap langkah = 12.5% lebar tim (= 6.25% lebar arena)
  team.style.transform = `translateX(${state.pos * 12.5}%)`;
  if (direction) {
    team.classList.remove('tug-left', 'tug-right');
    void team.offsetWidth;
    team.classList.add(direction === 1 ? 'tug-left' : 'tug-right');
  }
}

// ================== NUMBER PAD ==================
function buildPad(padEl, player) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  keys.forEach((k) => {
    const b = document.createElement('button');
    b.className = 'key' + (k === 'ok' ? ' ok' : k === 'del' ? ' del' : '');
    b.textContent = k === 'del' ? '⌫' : k === 'ok' ? '✓' : k;
    b.dataset.key = k;
    padEl.appendChild(b);
  });

  // pointerdown: langsung bereaksi saat disentuh & mendukung multi-touch
  // (dua pemain bisa menekan bersamaan)
  padEl.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.key');
    if (!b) return;
    e.preventDefault();
    if (TOUCH_ONLY && e.pointerType === 'mouse') return;
    b.classList.add('pressed');
    setTimeout(() => b.classList.remove('pressed'), 120);
    press(player, b.dataset.key);
  });
}

function press(p, key) {
  if (!state.playing) return;
  if (state.mode === 'bot' && p === 2) return; // pad bot tidak bisa disentuh

  if (key !== 'ok') Sound.tap();

  if (key === 'del') {
    state.input[p] = state.input[p].slice(0, -1);
  } else if (key === 'ok') {
    submit(p);
    return;
  } else if (state.input[p].length < 3) {
    state.input[p] += key;
  }
  renderInput(p);
}

function submit(p) {
  if (!state.playing || state.input[p] === '') return;

  const correct = Number(state.input[p]) === state.q[p].ans;
  state.input[p] = '';
  renderInput(p);

  if (correct) {
    flash(p, 'good');
    pull(p);
    if (state.playing) {
      Sound.correct();
      newQuestion(p);
    }
  } else {
    Sound.wrong();
    flash(p, 'bad'); // soal tetap sama, coba lagi
  }

  if (state.playing && state.mode === 'bot' && p === 2) scheduleBot();
}

function pull(p) {
  state.pos += p === 1 ? -1 : 1;
  updateTeam(p);
  if (Math.abs(state.pos) >= WIN_STEPS) endGame(p);
}

// ================== BOT ==================
function scheduleBot() {
  const [min, max] = BOT_SPEED[state.level];
  later(botAnswer, rand(min, max));
}

function botAnswer() {
  if (!state.playing) return;
  let ans = state.q[2].ans;
  if (Math.random() > BOT_ACCURACY[state.level]) {
    ans += rand(1, 3) * (Math.random() < 0.5 ? -1 : 1); // sesekali salah
    if (ans < 0) ans = state.q[2].ans + 1;
  }
  // Animasi bot "mengetik" digit satu per satu
  const digits = String(ans).split('');
  digits.forEach((d, i) => {
    later(() => {
      if (!state.playing) return;
      state.input[2] += d;
      renderInput(2);
    }, i * 220);
  });
  later(() => submit(2), digits.length * 220 + 150);
}

// ================== ALUR PERMAINAN ==================
function startGame() {
  clearTimers();
  state.pos = 0;
  state.playing = false;
  state.input = { 1: '', 2: '' };
  state.q = { 1: null, 2: null };
  renderInput(1);
  renderInput(2);
  $('q1').textContent = '–';
  $('q2').textContent = '–';
  updateTeam();

  const isBot = state.mode === 'bot';
  $('tag2').textContent = isBot ? `🤖 Bot Level ${state.level}` : 'Player 2';
  $('side2').classList.toggle('is-bot', isBot);

  show('screen-game');

  // Hitung mundur 3-2-1-MULAI
  const cd = $('countdown');
  cd.classList.add('show');
  ['3', '2', '1', 'MULAI!'].forEach((txt, i) => {
    later(() => {
      cd.innerHTML = `<span>${txt}</span>`;
      if (i < 3) Sound.tick(); else Sound.go();
    }, i * 800);
  });
  later(() => {
    cd.classList.remove('show');
    state.playing = true;
    newQuestion(1);
    newQuestion(2);
    if (isBot) scheduleBot();
  }, 4 * 800);
}

function endGame(winner) {
  state.playing = false;
  clearTimers();

  let text;
  if (state.mode === 'bot') {
    text = winner === 1 ? '🎉 Player 1 Menang!' : '🤖 Bot Menang!';
  } else {
    text = `🎉 Player ${winner} Menang!`;
  }
  const winEl = $('win-text');
  winEl.textContent = text;
  winEl.style.color = winner === 1 ? 'var(--p1)' : 'var(--p2)';

  // Kalah dari bot = nada sedih, selain itu fanfare kemenangan
  if (state.mode === 'bot' && winner === 2) Sound.lose();
  else Sound.win();

  // Beri waktu animasi tarikan terakhir, lalu tampilkan layar menang
  later(() => {
    show('screen-win');
    let s = AUTO_BACK_SECONDS;
    const tick = () => {
      $('auto-back').textContent = `Kembali ke menu dalam ${s} detik…`;
      if (s === 0) { goHome(); return; }
      s--;
      later(tick, 1000);
    };
    tick();
  }, 1200);
}

function goHome() {
  state.playing = false;
  clearTimers();
  $('countdown').classList.remove('show');
  show('screen-home');
}

// ================== EVENT MENU ==================
document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.mode = btn.dataset.mode;
    state.level = Number(btn.dataset.level || 1);
    show('screen-op');
  });
});

document.querySelectorAll('[data-op]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.op = btn.dataset.op;
    startGame();
  });
});

$('btn-back-op').addEventListener('click', () => show('screen-home'));

$('btn-sound').addEventListener('click', () => {
  Sound.on = !Sound.on;
  $('btn-sound').textContent = Sound.on ? '🔊' : '🔇';
  if (Sound.on) Sound.correct();
});
$('btn-home').addEventListener('click', goHome);
$('btn-quit').addEventListener('click', goHome);

buildPad($('pad1'), 1);
buildPad($('pad2'), 2);

// Cegah menu tahan-lama & pinch-zoom di iOS
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
