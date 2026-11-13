/*
 * The installer's screens, and nothing else.
 *
 * One state machine: options -> ready -> installing -> completed. Everything
 * that touches the machine is behind `window.setup` (the preload bridge); when
 * that bridge is absent — this page opened in a browser for review — the same
 * screens run on a simulated install so the design can be judged without
 * installing anything.
 */

const bridge = window.setup ?? null;

const state = {
  screen: 'options',
  scope: 'user',
  percent: 0,
  installed: false
};

const screens = new Map(
  [...document.querySelectorAll('.screen')].map((node) => [node.dataset.screen, node])
);
const steps = new Map(
  [...document.querySelectorAll('.step')].map((node) => [node.dataset.step, node])
);
const order = ['options', 'ready', 'installing', 'completed'];

const nextButton = document.getElementById('next');
const cancelButton = document.getElementById('cancel');
const bar = document.getElementById('bar');
const fill = document.getElementById('fill');
const stageCopy = document.getElementById('install-stage');
const noteCopy = document.getElementById('install-note');
const reviewScope = document.getElementById('review-scope');
const reviewPath = document.getElementById('review-path');
const launchBox = document.getElementById('launch');
const versionTag = document.getElementById('version');

const PATHS = {
  user: '%LOCALAPPDATA%\\Programs\\INDRA HUB',
  machine: '%PROGRAMFILES%\\INDRA HUB'
};

/* ---------------- painting ---------------- */

function paint() {
  for (const [name, node] of screens) {
    node.classList.toggle('is-current', name === state.screen);
  }

  const here = order.indexOf(state.screen);
  for (const [name, node] of steps) {
    const at = order.indexOf(name);
    node.classList.toggle('is-active', at === here);
    node.classList.toggle('is-done', at < here);
  }

  reviewScope.textContent = state.scope === 'machine' ? 'Everyone on this PC' : 'Only me';
  reviewPath.textContent = PATHS[state.scope];

  const label =
    state.screen === 'options'
      ? 'Next'
      : state.screen === 'ready'
        ? 'Install'
        : state.screen === 'installing'
          ? 'Installing…'
          : 'Finish';

  nextButton.disabled = state.screen === 'installing';
  nextButton.innerHTML =
    state.screen === 'completed'
      ? 'Finish'
      : `${label} <span class="btn__arrow" aria-hidden="true">→</span>`;

  cancelButton.textContent = state.screen === 'completed' ? 'Close' : 'Cancel';
  bar.setAttribute('aria-valuenow', String(Math.round(state.percent)));
  fill.style.width = `${state.percent}%`;
}

function go(screen) {
  state.screen = screen;
  paint();
}

/* ---------------- choosing ---------------- */

for (const choice of document.querySelectorAll('.choice')) {
  choice.addEventListener('click', () => {
    if (state.screen !== 'options') return;
    state.scope = choice.dataset.scope;
    for (const other of document.querySelectorAll('.choice')) {
      const selected = other === choice;
      other.classList.toggle('is-selected', selected);
      other.setAttribute('aria-checked', String(selected));
    }
    paint();
  });
}

/* ---------------- installing ---------------- */

function setStage(text, note) {
  if (text) stageCopy.textContent = text;
  if (note !== undefined) noteCopy.textContent = note;
}

async function install() {
  go('installing');
  state.percent = 4;
  paint();

  if (!bridge) {
    /* Review mode: the same beats, at reading speed. */
    const beats = [
      [18, 'Preparing…'],
      [42, 'Unpacking the app…'],
      [71, 'Creating shortcuts…'],
      [93, 'Finishing up…']
    ];
    for (const [percent, label] of beats) {
      setStage(label);
      state.percent = percent;
      paint();
      await new Promise((done) => setTimeout(done, 620));
    }
    state.percent = 100;
    paint();
    state.installed = true;
    go('completed');
    return;
  }

  bridge.onProgress((event) => {
    state.percent = Math.max(0, Math.min(100, Number(event.percent) || 0));
    if (event.stage) setStage(event.stage);
    paint();
  });

  try {
    const result = await bridge.install({ scope: state.scope });
    if (!result?.ok) throw new Error(result?.message || 'The installation did not complete.');
    state.percent = 100;
    paint();
    state.installed = true;
    go('completed');
  } catch (error) {
    state.percent = 0;
    paint();
    setStage('The installation stopped.', String(error?.message ?? error));
    noteCopy.textContent = 'Nothing was changed on this PC beyond what was already copied.';
    nextButton.disabled = false;
    nextButton.textContent = 'Try again';
    go('ready');
  }
}

/* ---------------- the one button ---------------- */

nextButton.addEventListener('click', () => {
  if (state.screen === 'options') return go('ready');
  if (state.screen === 'ready') return void install();
  if (state.screen === 'completed') return finish();
});

cancelButton.addEventListener('click', () => {
  if (bridge) bridge.close();
  else if (state.screen === 'completed') go('options');
});

function finish() {
  if (bridge) {
    bridge.finish({ launch: launchBox.checked });
    return;
  }
  go('options');
}

document.querySelector('[data-win="close"]')?.addEventListener('click', () => {
  if (bridge) bridge.close();
});
document.querySelector('[data-win="minimise"]')?.addEventListener('click', () => {
  if (bridge) bridge.minimise();
});

/* ---------------- chrome ---------------- */

const video = document.getElementById('video');
/*
 * The film, if this build was given one. It is optional by design: the page is
 * complete without it, so an installer can never fail because a video did not
 * decode.
 */
if (video) {
  const sources = ['background.webm', 'background.mp4'];
  for (const source of sources) {
    const node = document.createElement('source');
    node.src = source;
    node.type = source.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    video.appendChild(node);
  }
  video.addEventListener('loadeddata', () => video.classList.add('is-live'), { once: true });
  video.addEventListener('error', () => video.remove(), { once: true });
  /* A muted video that will not autoplay is fine to ignore; the fallback stays. */
  void video.play?.().catch(() => undefined);
}

if (bridge) {
  bridge.version?.().then((value) => {
    if (value) versionTag.textContent = `v${value}`;
  }).catch(() => undefined);
}

paint();
