import { describe, expect, it } from 'vitest';
import {
  generalCoverageMilestones,
  launchVisitMilestones,
  milestoneProgressPercent,
  nextFixedMilestone,
  regionalMilestones,
} from '../../src/domain/achievement/progress.js';

describe('achievement progress milestones', () => {
  it('selects the first threshold strictly above current progress', () => {
    expect(nextFixedMilestone(0, launchVisitMilestones)).toBe(3);
    expect(nextFixedMilestone(3, launchVisitMilestones)).toBe(5);
    expect(nextFixedMilestone(17, launchVisitMilestones)).toBe(25);
    expect(nextFixedMilestone(50, launchVisitMilestones)).toBeNull();
    expect(nextFixedMilestone(99.9, generalCoverageMilestones)).toBe(100);
    expect(nextFixedMilestone(50, regionalMilestones)).toBeNull();
  });

  it('calculates bounded progress toward the next target', () => {
    expect(milestoneProgressPercent(0, 10)).toBe(0);
    expect(milestoneProgressPercent(3, 5)).toBe(60);
    expect(milestoneProgressPercent(999, 1_000)).toBe(99);
    expect(milestoneProgressPercent(100, 100)).toBe(100);
  });

  it('rejects invalid progress values', () => {
    expect(() => nextFixedMilestone(-1, launchVisitMilestones)).toThrow('non-negative');
    expect(() => milestoneProgressPercent(1, 0)).toThrow('positive target');
  });
});
