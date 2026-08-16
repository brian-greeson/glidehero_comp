function optionLabel(option) {
  return option?.querySelector?.('span')?.textContent?.trim() ?? '';
}

export function initializeStyledSelects({ documentRef = document } = {}) {
  const roots = [...(documentRef.querySelectorAll?.('[data-styled-select]') ?? [])];
  let openController = null;

  const controllers = roots.map((root) => {
    const native = root.querySelector('[data-styled-select-native]');
    const trigger = root.querySelector('[data-styled-select-trigger]');
    const value = root.querySelector('[data-styled-select-value]');
    const menu = root.querySelector('[data-styled-select-menu]');
    const options = [...root.querySelectorAll('[data-styled-select-option]')];
    if (!native || !trigger || !value || !menu || !options.length) return null;

    const sync = () => {
      const selected = options.find((option) => option.dataset.styledSelectOption === native.value) ?? options[0];
      value.textContent = optionLabel(selected);
      options.forEach((option) => option.setAttribute('aria-selected', String(option === selected)));
    };
    const close = ({ focus = false } = {}) => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      root.classList.remove('is-open');
      if (openController?.root === root) openController = null;
      if (focus) trigger.focus();
    };
    const open = () => {
      openController?.close();
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      root.classList.add('is-open');
      openController = { root, close };
      (options.find((option) => option.getAttribute('aria-selected') === 'true') ?? options[0]).focus();
    };
    const choose = (option) => {
      native.value = option.dataset.styledSelectOption;
      sync();
      native.dispatchEvent(new Event('change', { bubbles: true }));
      close({ focus: true });
    };

    trigger.addEventListener('click', () => menu.hidden ? open() : close());
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open();
      }
    });
    options.forEach((option, index) => {
      option.addEventListener('click', () => choose(option));
      option.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); close({ focus: true }); return; }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0
          : event.key === 'End' ? options.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[next].focus();
      });
    });
    native.addEventListener('change', sync);
    native.addEventListener('styled-select-sync', sync);
    sync();
    return { root, close };
  }).filter(Boolean);

  documentRef.addEventListener?.('click', (event) => {
    if (openController && !openController.root.contains(event.target)) openController.close();
  });
  documentRef.addEventListener?.('keydown', (event) => {
    if (event.key === 'Escape' && openController) {
      event.preventDefault();
      openController.close({ focus: true });
    }
  });
  return controllers;
}
