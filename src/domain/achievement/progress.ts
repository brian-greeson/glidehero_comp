export const launchVisitMilestones = [3, 5, 10, 25, 50] as const;
export const generalExplorationMilestones = [1, 5, 10, 25, 50, 100, 200] as const;
export const generalCoverageMilestones = [10, 25, 50, 75, 100] as const;
export const regionalMilestones = [1, 3, 5, 10, 25, 50] as const;

export function nextFixedMilestone(current: number, milestones: readonly number[]): number | null {
  if (!Number.isFinite(current) || current < 0) throw new RangeError('Achievement progress must be a non-negative finite number.');
  return milestones.find((milestone) => milestone > current) ?? null;
}

export function milestoneProgressPercent(current: number, target: number): number {
  if (!Number.isFinite(current) || current < 0 || !Number.isFinite(target) || target <= 0) {
    throw new RangeError('Achievement progress values must be finite with a positive target.');
  }
  const rounded = Math.min(100, Math.max(0, Math.round((current / target) * 100)));
  return current < target ? Math.min(99, rounded) : 100;
}
