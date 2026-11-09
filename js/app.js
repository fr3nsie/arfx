// Ricalca – sovrappone un'immagine alla fotocamera per aiutare a disegnare.

/* ---------- Costanti ---------- */
const SCALE_MIN = 0.1;
const SCALE_MAX = 4;
const WHEEL_STEP = 1.05;

/* ---------- Elementi della pagina ---------- */
const $ = (id) => document.getElementById(id);

const els = {
  stage: $('stage'),
  cam: $('cam'),
  overlay: $('overlay'),
  message: $('message'),
  panel: $('panel'),
  file: $('file'),
  camToggle: $('camToggle'),
  opacity: $('opacity'),
  opacityOut: $('opacityOut'),
  scale: $('scale'),
  scaleOut: $('scaleOut'),
  rotation: $('rotation'),
  rotationOut: $('rotationOut'),
};

/* ---------- Stato ---------- */
const state = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 0.5,
  flip: false,
  lines: false,
  locked: false,
  hidden: false,
};

let stream = null;
let facing = 'environment';
let wakeLock = null;
let objectUrl = null;

/* ---------- Utilità ---------- */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeAngle = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
const formatScale = (n) => `${n.toFixed(2).replace('.', ',')}×`;
const hasImage = () => els.overlay.style.display === 'block';

/* ---------- Render ---------- */
function render() {
  const { x, y, scale, rotation, opacity, flip, lines, hidden } = state;
  const scaleX = flip ? -scale : scale;
  const { style } = els.overlay;

  style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scaleX}, ${scale})`;
  style.opacity = opacity;
  style.filter = lines ? 'grayscale(1) contrast(1.6)' : 'none';
  style.mixBlendMode = lines ? 'multiply' : 'normal';
  style.visibility = hidden ? 'hidden' : 'visible';

  els.opacity.value = opacity;
  els.opacityOut.textContent = `${Math.round(opacity * 100)}%`;
  els.scale.value = scale;
  els.scaleOut.textContent = formatScale(scale);
  els.rotation.value = rotation;
  els.rotationOut.textContent = `${Math.round(rotation)}°`;
}

function showMessage(title, text) {
  const strong = document.createElement('strong');
  const paragraph = document.createElement('p');
  strong.textContent = title;
  paragraph.textContent = text;
  els.message.replaceChildren(strong, paragraph);
  els.message.style.display = 'flex';
}

/* ---------- Immagine ---------- */
$('pick').addEventListener('click', () => els.file.click());

els.file.addEventListener('change', () => {
  const [file] = els.file.files;
  if (!file) return;

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);

  els.overlay.onload = () => {
    els.overlay.style.display = 'block';
    els.message.style.display = 'none';
    render();
  };
  els.overlay.src = objectUrl;
});

/* ---------- Fotocamera ---------- */
const setCameraLabel = (on) => {
  els.camToggle.textContent = on ? 'Ferma fotocamera' : 'Avvia fotocamera';
};

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    wakeLock = null; // non supportato o negato: non è un errore grave
  }
}

function stopCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  els.cam.srcObject = null;
  setCameraLabel(false);

  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

async function startCamera() {
  stopCamera();

  if (!navigator.mediaDevices?.getUserMedia) {
    showMessage(
      'Fotocamera non disponibile',
      'Il browser non permette l’accesso alla fotocamera. Apri la pagina da un indirizzo https:// (per esempio GitHub Pages).'
    );
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    els.cam.srcObject = stream;
    setCameraLabel(true);
    if (!hasImage()) els.message.style.display = 'none';
    await requestWakeLock();
  } catch (error) {
    const text =
      error?.name === 'NotAllowedError'
        ? 'Accesso alla fotocamera negato. Consenti la fotocamera nelle impostazioni del browser per questo sito, poi riprova.'
        : 'Impossibile avviare la fotocamera. Controlla che nessun’altra app la stia usando.';
    showMessage('Fotocamera non disponibile', text);
  }
}

els.camToggle.addEventListener('click', () => (stream ? stopCamera() : startCamera()));

$('camSwitch').addEventListener('click', () => {
  facing = facing === 'environment' ? 'user' : 'environment';
  if (stream) startCamera();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && stream && !wakeLock) requestWakeLock();
});

/* ---------- Controlli ---------- */
const sliders = [
  [els.opacity, 'opacity'],
  [els.scale, 'scale'],
  [els.rotation, 'rotation'],
];

for (const [input, key] of sliders) {
  input.addEventListener('input', () => {
    state[key] = Number(input.value);
    render();
  });
}

const toggles = [
  ['mirror', 'flip'],
  ['lines', 'lines'],
  ['lock', 'locked'],
  ['hide', 'hidden'],
];

for (const [id, key] of toggles) {
  const button = $(id);
  button.addEventListener('click', () => {
    state[key] = !state[key];
    button.setAttribute('aria-pressed', String(state[key]));
    render();
  });
}

$('reset').addEventListener('click', () => {
  Object.assign(state, { x: 0, y: 0, scale: 1, rotation: 0 });
  render();
});

$('togglePanel').addEventListener('click', () => els.panel.classList.toggle('closed'));

$('fullscreen').addEventListener('click', async () => {
  const root = document.documentElement;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.requestFullscreen();
  } catch {
    alert('Schermo intero non disponibile su questo browser. Usa «Aggiungi a schermata Home».');
  }
});

/* ---------- Gesti: 1 dito = sposta, 2 dita = zoom + rotazione ---------- */
const pointers = new Map();
let gesture = null;

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

function startGesture() {
  const points = [...pointers.values()];

  if (points.length >= 2) {
    const [a, b] = points;
    gesture = {
      type: 'pinch',
      distance: distance(a, b),
      angle: angle(a, b),
      scale: state.scale,
      rotation: state.rotation,
    };
  } else if (points.length === 1) {
    const [p] = points;
    gesture = { type: 'drag', px: p.x, py: p.y, x: state.x, y: state.y };
  } else {
    gesture = null;
  }
}

els.stage.addEventListener('pointerdown', (event) => {
  if (state.locked || !hasImage()) return;
  els.stage.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  startGesture();
});

els.stage.addEventListener('pointermove', (event) => {
  if (!pointers.has(event.pointerId) || !gesture) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (gesture.type === 'pinch') {
    const [a, b] = [...pointers.values()];
    if (gesture.distance > 0) {
      state.scale = clamp(gesture.scale * (distance(a, b) / gesture.distance), SCALE_MIN, SCALE_MAX);
    }
    const delta = ((angle(a, b) - gesture.angle) * 180) / Math.PI;
    state.rotation = normalizeAngle(gesture.rotation + (state.flip ? -delta : delta));
  } else {
    state.x = gesture.x + (event.clientX - gesture.px);
    state.y = gesture.y + (event.clientY - gesture.py);
  }
  render();
});

const endPointer = (event) => {
  pointers.delete(event.pointerId);
  startGesture();
};

els.stage.addEventListener('pointerup', endPointer);
els.stage.addEventListener('pointercancel', endPointer);

els.stage.addEventListener(
  'wheel',
  (event) => {
    if (state.locked) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
    state.scale = clamp(state.scale * factor, SCALE_MIN, SCALE_MAX);
    render();
  },
  { passive: false }
);

/* ---------- Avvio ---------- */
render();
