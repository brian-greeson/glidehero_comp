/** Progressive enhancement for the refreshed Activity page. */
export function initializeActivityUi(documentRef = document, fetchImpl = fetch) {
  const onboardingCard = documentRef.querySelector('[data-onboarding-card]');
  const onboardingDialog = documentRef.querySelector('[data-onboarding-dialog]');
  const onboardingClose = documentRef.querySelector('[data-onboarding-dialog-close]');
  if (onboardingDialog?.showModal && !onboardingDialog.open) onboardingDialog.showModal();
  const clearInstructionLocation = () => {
    const locationRef = globalThis.window?.location;
    const historyRef = globalThis.window?.history;
    if (!locationRef?.href || !historyRef?.replaceState) return;
    const url = new URL(locationRef.href);
    if (!url.searchParams.has('onboardingStep')) return;
    url.searchParams.delete('onboardingStep');
    historyRef.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const closeInstructions = () => {
    if (onboardingDialog?.open) onboardingDialog.close();
    clearInstructionLocation();
  };
  onboardingClose?.addEventListener('click', closeInstructions);
  onboardingDialog?.addEventListener('click', (event) => {
    if (event.target === onboardingDialog || event.target?.closest?.('[data-upload-trigger]')) closeInstructions();
  });
  onboardingDialog?.addEventListener('close', clearInstructionLocation);
  for (const link of documentRef.querySelectorAll?.('a[href="#activity-pilot-query"]') ?? []) {
    link.addEventListener('click', () => documentRef.querySelector('#activity-pilot-query')?.focus?.());
  }

  const collapse = onboardingCard?.querySelector?.('[data-onboarding-collapse]');
  const onboardingBody = onboardingCard?.querySelector?.('[data-onboarding-body]');
  collapse?.addEventListener('click', () => {
    const expanded = collapse.getAttribute('aria-expanded') !== 'true';
    collapse.setAttribute('aria-expanded', String(expanded));
    onboardingBody.hidden = !expanded;
  });
  onboardingCard?.addEventListener('click', (event) => {
    const row = event.target?.closest?.('[data-onboarding-step]');
    if (!row || event.target?.closest?.('a, button')) return;
    row.querySelector?.('.onboarding-step__copy')?.click?.();
  });

  const postAndNavigate = async (form, destination) => {
    const response = await fetchImpl(form.action, { method: 'POST', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Onboarding request failed.');
    globalThis.window?.location?.assign?.(destination);
  };
  const dismissForm = onboardingCard?.querySelector?.('[data-onboarding-dismiss-form]');
  dismissForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void postAndNavigate(dismissForm, '/activity?onboardingDismissed=1').catch(() => dismissForm.submit());
  });
  for (const restoreForm of documentRef.querySelectorAll?.('[data-onboarding-restore-form]') ?? []) {
    restoreForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void postAndNavigate(restoreForm, '/activity').catch(() => restoreForm.submit());
    });
  }
  documentRef.querySelector('[data-onboarding-notice-close]')?.addEventListener('click', (event) => {
    event.target.closest('[data-onboarding-hidden-notice]')?.remove();
  });

  if (onboardingCard?.dataset.poll === 'true') {
    const statusKey = onboardingCard.dataset.statusKey;
    const firstFlightWasComplete = onboardingCard.dataset.firstFlightComplete === 'true';
    const pollOnboarding = async () => {
      try {
        const response = await fetchImpl('/v1/onboarding/status', { headers: { Accept: 'application/json' } });
        const result = await response.json();
        if (response.ok && result.onboarding?.statusKey !== statusKey) {
          const firstFlight = result.onboarding?.steps?.find?.((step) => step.key === 'first-flight');
          if (!firstFlightWasComplete && firstFlight?.complete && firstFlight.href?.startsWith('/flights/')) globalThis.window?.location?.assign?.(firstFlight.href);
          else globalThis.window?.location?.reload?.();
          return;
        }
      } catch { /* The next page visit will reconcile progress. */ }
      if (onboardingCard.isConnected !== false) globalThis.window?.setTimeout?.(pollOnboarding, 5_000);
    };
    globalThis.window?.setTimeout?.(pollOnboarding, 5_000);
  }

  const statistics = documentRef.querySelector('[data-activity-stats]');
  if (statistics) {
    statistics.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-activity-stats-button]');
      const period = button?.dataset.activityStatsButton;
      if (!button || (period !== 'monthly' && period !== 'daily')) return;
      for (const candidate of statistics.querySelectorAll('[data-activity-stats-button]')) {
        candidate.setAttribute('aria-pressed', candidate === button ? 'true' : 'false');
      }
      for (const panel of statistics.querySelectorAll('[data-activity-stats-panel]')) {
        panel.hidden = panel.dataset.activityStatsPanel !== period;
      }
    });
  }

  const feed = documentRef.querySelector('[data-activity-feed]');
  if (!feed) return;

  const likeSubmit = async (event) => {
    const form = event.target?.closest?.('[data-like-form]');
    if (!form || form.dataset.likePending === 'true') return;
    event.preventDefault();
    const button = form.querySelector('[data-like-button]');
    const label = form.querySelector('[data-like-label]');
    const count = form.querySelector('[data-like-count]');
    const status = form.querySelector('[data-like-status]');
    if (!button || !label || !count) return;
    const previous = { pressed: button.getAttribute('aria-pressed'), label: label.textContent, count: count.textContent };
    form.dataset.likePending = 'true';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const response = await fetchImpl(form.action, { method: 'POST', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Like request failed.');
      const result = await response.json();
      if (typeof result?.reacted !== 'boolean' || !Number.isFinite(Number(result.totalCount))) throw new Error('Like response was invalid.');
      button.setAttribute('aria-pressed', result.reacted ? 'true' : 'false');
      label.textContent = result.reacted ? 'Like sent' : 'Send a Like';
      button.setAttribute('aria-label', label.textContent);
      count.textContent = String(Math.max(0, Number(result.totalCount)));
      if (status) status.textContent = result.reacted ? 'Like sent.' : 'Like removed.';
    } catch {
      if (previous.pressed === null) button.removeAttribute('aria-pressed'); else button.setAttribute('aria-pressed', previous.pressed);
      label.textContent = previous.label;
      count.textContent = previous.count;
      if (status) { status.setAttribute('role', 'alert'); status.textContent = 'Could not update Like. Please try again.'; }
    } finally {
      delete form.dataset.likePending;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  };
  feed.addEventListener('submit', likeSubmit);

  let loading = false;
  const loadMore = async (event) => {
    const link = event.target?.closest?.('[data-activity-load-more]');
    if (!link || loading) return;
    event.preventDefault();
    loading = true;
    link.setAttribute('aria-busy', 'true');
    const status = feed.querySelector('[data-activity-load-more-status]');
    if (status) status.textContent = 'Loading more activity…';
    try {
      const response = await fetchImpl(link.dataset.fragmentHref || link.href, { headers: { Accept: 'text/html' } });
      if (!response.ok) throw new Error('Activity request failed.');
      const html = await response.text();
      const fragment = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-activity-feed]');
      if (!fragment) throw new Error('Activity response was invalid.');
      for (const card of fragment.querySelectorAll('[data-activity-kind]')) feed.insertBefore(documentRef.importNode(card, true), link);
      const nextLink = fragment.querySelector('[data-activity-load-more]');
      if (nextLink) link.replaceWith(documentRef.importNode(nextLink, true)); else link.remove();
      if (status) status.textContent = '';
    } catch {
      link.removeAttribute('aria-busy');
      if (status) { status.setAttribute('role', 'alert'); status.textContent = 'Could not load more activity. Please try again.'; }
    } finally { loading = false; }
  };
  feed.addEventListener('click', loadMore);
}

if (typeof document !== 'undefined') initializeActivityUi();
