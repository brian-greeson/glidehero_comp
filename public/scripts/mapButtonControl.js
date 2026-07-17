export function createMapButtonControl({ documentRef = document, label, symbol, onClick }) {
  const container = documentRef.createElement('div');
  container.className = 'maplibregl-ctrl maplibregl-ctrl-group flight-aid-control';
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = 'flight-aid-button';
  button.textContent = symbol;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', onClick);
  container.append(button);

  return {
    onAdd() { return container; },
    onRemove() { container.remove?.(); },
    setPressed(pressed) { button.setAttribute('aria-pressed', String(pressed)); },
    setHidden(hidden) { container.hidden = hidden; },
    setLabel(nextLabel) {
      button.title = nextLabel;
      button.setAttribute('aria-label', nextLabel);
    },
  };
}
