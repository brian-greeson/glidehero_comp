export const ALL_TIME_COMPETITION_PERIOD = 'all-time';
export const CURRENT_MONTH_COMPETITION_PERIOD = 'current-month';

export function formatBrowserLocalMonth(date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function competitionMonthFromSearch(search = '') {
  const month = new URLSearchParams(search).get('month');
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  return month;
}

export function formatCompetitionMonthLabel(month, locale) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    .format(new Date(year, monthNumber - 1, 1));
}

export function competitionPageUrl(path, month) {
  return month ? `${path}?month=${encodeURIComponent(month)}` : path;
}

export function initializeCompetitionPeriodControl({
  documentRef = document,
  locationRef = typeof window === 'undefined' ? { pathname: '', search: '' } : window.location,
  historyRef = typeof window === 'undefined' ? undefined : window.history,
  now = () => new Date(),
  onChange = () => undefined,
} = {}) {
  const buttons = Array.from(documentRef.querySelectorAll?.('[data-competition-period-option]') ?? []);
  const currentMonthOption = documentRef.querySelector?.('[data-current-month-option]');
  const periodLinks = Array.from(documentRef.querySelectorAll?.('[data-competition-period-link]') ?? []);
  const returnToInputs = Array.from(documentRef.querySelectorAll?.('[data-competition-return-to]') ?? []);
  const rawMonth = new URLSearchParams(locationRef.search).get('month');
  let month = competitionMonthFromSearch(locationRef.search);
  let period = month ? CURRENT_MONTH_COMPETITION_PERIOD : ALL_TIME_COMPETITION_PERIOD;

  function pageUrl() {
    const query = new URLSearchParams(locationRef.search);
    if (month) query.set('month', month);
    else query.delete('month');
    const search = query.toString();
    return `${locationRef.pathname}${search ? `?${search}` : ''}`;
  }

  function render() {
    for (const button of buttons) {
      const selected = button.dataset.competitionPeriodOption === period;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    if (currentMonthOption) {
      currentMonthOption.textContent = month ? formatCompetitionMonthLabel(month) : 'Current Month';
    }
    for (const link of periodLinks) {
      link.href = competitionPageUrl(link.dataset.competitionPeriodLink, month);
    }
    for (const input of returnToInputs) input.value = pageUrl();
  }

  function replaceUrl() {
    historyRef?.replaceState(null, '', pageUrl());
  }

  for (const button of buttons) {
    button.addEventListener('click', async () => {
      const nextPeriod = button.dataset.competitionPeriodOption;
      if (nextPeriod === period || ![
        ALL_TIME_COMPETITION_PERIOD,
        CURRENT_MONTH_COMPETITION_PERIOD,
      ].includes(nextPeriod)) return;
      period = nextPeriod;
      month = period === CURRENT_MONTH_COMPETITION_PERIOD ? formatBrowserLocalMonth(now()) : null;
      replaceUrl();
      render();
      await onChange({ period, month });
    });
  }

  if (rawMonth && !month) replaceUrl();
  render();
  return {
    get month() { return month; },
    get period() { return period; },
  };
}
