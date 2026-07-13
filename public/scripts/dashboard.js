(() => {
  const mapElement = document.querySelector('[data-dashboard-map]');
  const emptyState = document.querySelector('[data-map-empty-state]');

  function showMapUnavailable() {
    if (emptyState) emptyState.hidden = false;
  }

  if (mapElement && window.maplibregl) {
    try {
      const map = new window.maplibregl.Map({
        container: mapElement,
        style: mapElement.dataset.mapStyleUrl,
        center: [-106.2, 39.2],
        zoom: 7,
      });
      map.addControl(new window.maplibregl.NavigationControl(), 'top-right');
      map.once('error', showMapUnavailable);
    } catch {
      showMapUnavailable();
    }
  } else if (mapElement) {
    showMapUnavailable();
  }

  const currentMonth = document.querySelector('[data-current-month]');
  if (currentMonth) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    currentMonth.textContent = `${formatter.format(start)} – ${formatter.format(end)} (Local)`;
  }

  const accountTrigger = document.querySelector('[data-account-trigger]');
  const accountPopover = document.querySelector('[data-account-popover]');
  if (accountTrigger && accountPopover) {
    accountTrigger.addEventListener('click', () => {
      const open = accountPopover.hidden;
      accountPopover.hidden = !open;
      accountTrigger.setAttribute('aria-expanded', String(open));
    });
  }

  const sheetToggle = document.querySelector('[data-sheet-toggle]');
  const sheet = document.querySelector('[data-mobile-sheet]');
  if (sheetToggle && sheet) {
    sheetToggle.addEventListener('click', () => {
      const expanded = sheet.classList.toggle('is-expanded');
      sheetToggle.setAttribute('aria-expanded', String(expanded));
    });
  }

  const uploadForm = document.querySelector('[data-upload-form]');
  const uploadInput = uploadForm?.querySelector('input[type="file"]');
  if (uploadForm && uploadInput) uploadInput.addEventListener('change', () => {
    if (uploadInput.files?.length) uploadForm.requestSubmit();
  });
})();
