import { describe, expect, it } from 'vitest';
import { createOnboardingView } from '../../src/views/authenticated/adapters/onboardingView.js';

describe('onboarding view', () => {
  it('explains chronological achievement processing and links completed first flights to results', () => {
    const view = createOnboardingView({
      dismissed: false,
      completeCount: 2,
      totalCount: 7,
      coreComplete: false,
      allComplete: false,
      shouldPoll: false,
      firstFlightId: 'flight-id',
      firstFlightStatus: 'completed',
      historyStatus: 'not-started',
      steps: { profile: true, 'first-flight': true, 'personal-map': false, 'follow-pilots': false, 'competitive-map': false, glider: false, history: false },
    }, 'history');

    expect(view.steps[1]).toMatchObject({ label: 'Upload your first flight', href: '/flights/flight-id', actionLabel: 'View results' });
    expect(view.selectedStep?.instructions.map((instruction) => instruction.detail).join(' ')).toContain('oldest to newest');
    expect(view.selectedStep?.instructions.map((instruction) => instruction.detail).join(' ')).toContain('does not affect achievement progress');
    expect(view.selectedStep?.instructions.map((instruction) => instruction.detail).join(' ')).toContain('not added to the Activity feed');
  });

  it('presents the Competitive Map as a monthly contest with the user-created group', () => {
    const view = createOnboardingView({
      dismissed: false,
      completeCount: 1,
      totalCount: 7,
      coreComplete: false,
      allComplete: false,
      shouldPoll: false,
      firstFlightId: null,
      firstFlightStatus: 'not-started',
      historyStatus: 'not-started',
      steps: { profile: true, 'first-flight': false, 'personal-map': false, 'follow-pilots': false, 'competitive-map': false, glider: false, history: false },
    }, 'competitive-map');

    expect(view.selectedStep).toMatchObject({
      label: 'Explore the Competitive Map',
      href: '/following',
      actionLabel: 'Open Competitive Map',
    });
    const instructions = view.selectedStep?.instructions.map((instruction) => instruction.detail).join(' ');
    expect(instructions).toContain('pilots you follow');
    expect(instructions).toContain('month-long contest');
    expect(instructions).toContain('you and your group');
  });
});
