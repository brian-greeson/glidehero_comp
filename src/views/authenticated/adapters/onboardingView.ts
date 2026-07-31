import type { OnboardingState, OnboardingStepKey } from '../../../services/onboardingService.js';
import type { OnboardingStepView, OnboardingView } from '../models.js';

const definitions: Record<OnboardingStepKey, Omit<OnboardingStepView, 'complete'>> = {
  profile: {
    key: 'profile', label: 'Create your profile', description: 'Tell us about yourself and your flying.', actionLabel: 'View profile', href: '/profile',
    instructions: [
      { number: 1, title: 'Review your profile', detail: 'Make sure your pilot name represents you.' },
      { number: 2, title: 'Add a few details', detail: 'A complete profile helps other pilots recognize you.' },
    ],
  },
  'first-flight': {
    key: 'first-flight', label: 'Upload your first flight', description: 'Share a recent flight. It takes just a minute.', actionLabel: 'Upload flight', href: '#flight-upload-dialog', uploadMode: 'recent',
    instructions: [
      { number: 1, title: 'Prepare your IGC file', detail: 'Export the IGC file from your flight instrument or app.' },
      { number: 2, title: 'Upload your flight', detail: 'Choose one or more flights from the last 30 days. GlideHero evaluates them from oldest to newest using the dates inside each file.' },
      { number: 3, title: 'View your results', detail: 'Your flight detail, Personal Map, cells, and achievement progress update after processing.' },
    ],
  },
  'personal-map': {
    key: 'personal-map', label: 'View your Personal Map', description: 'See your flights on the map and track progress.', actionLabel: 'Open map', href: '/personal',
    instructions: [
      { number: 1, title: 'Open your Personal Map', detail: 'Your completed flights build a map that belongs to you.' },
      { number: 2, title: 'Explore your territory', detail: 'Zoom and move around to see the cells your flights have claimed.' },
    ],
  },
  'follow-pilots': {
    key: 'follow-pilots', label: 'Follow three pilots', description: 'Connect with other pilots you admire.', actionLabel: 'Find pilots', href: '#activity-pilot-query',
    instructions: [
      { number: 1, title: 'Find pilots', detail: 'Search by pilot name from Activity.' },
      { number: 2, title: 'Follow three pilots', detail: 'Their recent flights and achievements will appear in your Following feed.' },
    ],
  },
  glider: {
    key: 'glider', label: 'Add your glider', description: 'Add your glider so it appears in the community.', actionLabel: 'Add glider', href: '/profile?editGlider=1',
    instructions: [
      { number: 1, title: 'Open your profile', detail: 'Use the glider editor in your pilot profile.' },
      { number: 2, title: 'Choose your glider', detail: 'Add its model and details so other pilots can see what you fly.' },
    ],
  },
  history: {
    key: 'history', label: 'Import older flight history', description: 'Reveal more of your map and achievement history.', actionLabel: 'Import history', href: '#flight-upload-dialog', uploadMode: 'history',
    instructions: [
      { number: 1, title: 'Prepare one ZIP file', detail: 'Put your older IGC flight files into a single ZIP archive.' },
      { number: 2, title: 'Import your history', detail: 'GlideHero reads the dates inside every IGC and evaluates flights from oldest to newest. The order of files in the ZIP does not affect achievement progress.' },
      { number: 3, title: 'Let GlideHero rebuild your progress', detail: 'Older flights update your Personal Map and achievements after import. They are not added to the Activity feed.' },
    ],
  },
};

export function createOnboardingView(state: OnboardingState, selectedKey?: OnboardingStepKey): OnboardingView {
  const steps = (Object.keys(definitions) as OnboardingStepKey[]).map((key) => {
    const definition = definitions[key];
    if (key === 'first-flight' && state.firstFlightStatus === 'processing') {
      return { ...definition, complete: false, description: 'Your flight is processing in the background.', actionLabel: 'View upload status' };
    }
    if (key === 'first-flight' && state.firstFlightStatus === 'completed' && state.firstFlightId) {
      return { ...definition, complete: true, description: 'Your first flight is ready.', actionLabel: 'View results', href: `/flights/${state.firstFlightId}`, uploadMode: undefined };
    }
    if (key === 'history' && ['preparing', 'processing', 'replaying'].includes(state.historyStatus)) {
      return { ...definition, complete: false, description: 'Your older flights are being added chronologically.', actionLabel: 'View upload status' };
    }
    return { ...definition, complete: state.steps[key] };
  });
  return {
    dismissed: state.dismissed,
    completeCount: state.completeCount,
    totalCount: state.totalCount,
    coreComplete: state.coreComplete,
    allComplete: state.allComplete,
    shouldPoll: state.shouldPoll,
    statusKey: `${state.completeCount}:${state.firstFlightStatus}:${state.historyStatus}`,
    firstFlightComplete: state.steps['first-flight'],
    steps,
    selectedStep: selectedKey ? steps.find((step) => step.key === selectedKey) : undefined,
  };
}
