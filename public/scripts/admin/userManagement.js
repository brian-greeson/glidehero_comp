export function initializeAdminUserManagement(documentRef = document) {
  documentRef.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const message = form.dataset.confirm;
    if (message && !globalThis.confirm(message)) event.preventDefault();
  });
}

if (typeof document !== 'undefined') initializeAdminUserManagement(document);
