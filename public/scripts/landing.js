export function initializeLandingAuth({
  documentRef = document,
  mobileQuery = typeof window === 'undefined' ? undefined : window.matchMedia('(max-width: 720px)'),
} = {}) {
  const landing = documentRef.querySelector('[data-auth-landing]');
  if (!landing) return undefined;

  const panels = [...landing.querySelectorAll('[data-auth-panel]')];
  const switches = [...landing.querySelectorAll('[data-auth-switch]')];

  function select(mode) {
    if (!panels.some((panel) => panel.dataset.authPanel === mode)) return;
    for (const panel of panels) panel.hidden = panel.dataset.authPanel !== mode;
  }

  landing.classList.add('auth-enhanced');
  if (mobileQuery?.matches && !landing.hasAttribute('data-auth-reveal')) {
    select('login');
  } else {
    select(landing.dataset.authInitial === 'signup' ? 'signup' : 'login');
  }

  for (const switchButton of switches) {
    switchButton.addEventListener('click', () => select(switchButton.dataset.authSwitch));
  }

  return { select };
}

if (typeof document !== 'undefined') initializeLandingAuth();
