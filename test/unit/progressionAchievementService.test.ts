import { describe, expect, it } from 'vitest';
import {
  nextUniqueCellMilestone,
  uniqueCellMilestonesCrossed,
} from '../../src/services/progressionAchievementService.js';

describe('unique cell milestone thresholds', () => {
  it.each([
    [0, 10],
    [9, 10],
    [10, 25],
    [24, 25],
    [25, 50],
    [999, 1_000],
    [1_000, 2_000],
    [1_001, 2_000],
    [1_999, 2_000],
    [2_000, 3_000],
    [1_000_000, 1_001_000],
  ])('returns the first threshold strictly greater than %i', (currentTotal, expected) => {
    expect(nextUniqueCellMilestone(currentTotal)).toBe(expected);
  });

  it('awards nothing below the first threshold', () => {
    expect(uniqueCellMilestonesCrossed(0, 9)).toEqual([]);
  });

  it('returns every fixed threshold crossed by one flight', () => {
    expect(uniqueCellMilestonesCrossed(8, 30)).toEqual([10, 25]);
  });

  it('awards exact threshold values and does not repeat an already reached threshold', () => {
    expect(uniqueCellMilestonesCrossed(9, 10)).toEqual([10]);
    expect(uniqueCellMilestonesCrossed(10, 10)).toEqual([]);
    expect(uniqueCellMilestonesCrossed(24, 25)).toEqual([25]);
  });

  it('generates the recurring thousand-cell thresholds', () => {
    expect(uniqueCellMilestonesCrossed(900, 2_100)).toEqual([1_000, 2_000]);
    expect(uniqueCellMilestonesCrossed(2_100, 3_100)).toEqual([3_000]);
    expect(uniqueCellMilestonesCrossed(2_100, 2_200)).toEqual([]);
  });
});
