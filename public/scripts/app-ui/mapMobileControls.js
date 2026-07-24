/** Initialize the compact mobile map-view menu. */
export function initializeMapMobileControls(documentRef = document) {
  const root = documentRef.querySelector?.('[data-map-mobile-controls]');
  const trigger = root?.querySelector?.('[data-map-mobile-view-trigger]');
  const menu = root?.querySelector?.('[data-map-mobile-view-menu]');
  if (!root || !trigger || !menu) return;

  const setOpen = (open) => {
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector?.('a.is-active')?.focus?.();
  };

  trigger.addEventListener('click', () => setOpen(menu.hidden));
  root.querySelectorAll?.('[data-map-mode-link]')?.forEach((link) => {
    link.addEventListener('click', () => setOpen(false));
  });
  documentRef.addEventListener?.('click', (event) => {
    if (!menu.hidden && !root.contains?.(event.target)) setOpen(false);
  });
  documentRef.addEventListener?.('keydown', (event) => {
    if (event.key !== 'Escape' || menu.hidden) return;
    setOpen(false);
    trigger.focus?.();
  });
}
