export function initializeLandingAuth({
  documentRef = document,
  mobileQuery = typeof window === 'undefined' ? undefined : window.matchMedia('(max-width: 720px)'),
} = {}) {
  const landing = documentRef.querySelector('[data-auth-landing]');
  if (!landing) return undefined;

  const tabs = [...landing.querySelectorAll('[data-auth-tab]')];
  const panels = [...landing.querySelectorAll('[data-auth-panel]')];
  const switches = [...landing.querySelectorAll('[data-auth-switch]')];

  function select(mode, { focusTab = false } = {}) {
    if (!tabs.some((tab) => tab.dataset.authTab === mode)) return;

    for (const tab of tabs) {
      const selected = tab.dataset.authTab === mode;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focusTab) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.authPanel !== mode;
  }

  landing.classList.add('auth-enhanced');
  if (mobileQuery?.matches && !landing.hasAttribute('data-auth-reveal')) {
    select('login');
  } else {
    select(landing.dataset.authInitial === 'signup' ? 'signup' : 'login');
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab.dataset.authTab));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const currentIndex = tabs.indexOf(tab);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length];
      select(nextTab.dataset.authTab, { focusTab: true });
    });
  }
  for (const switchButton of switches) {
    switchButton.addEventListener('click', () => select(switchButton.dataset.authSwitch, { focusTab: true }));
  }

  return { select };
}

if (typeof document !== 'undefined') initializeLandingAuth();
