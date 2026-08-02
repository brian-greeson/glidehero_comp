import { describe, expect, it } from 'vitest';
import { createPlanExportArtifact } from '../../src/domain/plan/planExport.js';

const points = [
  { latitude: 39.123456, longitude: -105.654321, elevationMeters: 1_654.4 },
  { latitude: 39.25, longitude: -104.75, elevationMeters: 2_005.6 },
];

describe('Plan exports', () => {
  it('creates a SeeYou task with named waypoints and elevations', () => {
    const artifact = createPlanExportArtifact({ format: 'cup', prefix: 'GH', points });
    expect(artifact.extension).toBe('cup');
    expect(artifact.body).toContain('GH001');
    expect(artifact.body).toContain('3907.407N');
    expect(artifact.body).toContain('10539.259W');
    expect(artifact.body).toContain('1654m');
    expect(artifact.body).toContain('-----Related Tasks-----');
  });

  it('creates an XCSoar task with start and finish cylinders', () => {
    const artifact = createPlanExportArtifact({ format: 'tsk', prefix: 'GH', points });
    expect(artifact.contentType).toContain('application/tsk+xml');
    expect(artifact.body).toContain('<Point type="Start">');
    expect(artifact.body).toContain('<Point type="Finish">');
    expect(artifact.body).toContain('radius="400"');
  });

  it('creates a GPSDump FormatGEO waypoint file', () => {
    const artifact = createPlanExportArtifact({ format: 'wpt', prefix: 'GH', points });
    expect(artifact.body).toMatch(/^\$FormatGEO\r\n/);
    expect(artifact.body).toContain('GH001');
    expect(artifact.body).toContain('N 39');
    expect(artifact.body).toContain('W 105');
  });

  it('creates an XCTrack classic task', () => {
    const artifact = createPlanExportArtifact({ format: 'xctsk', prefix: 'GH', points });
    expect(JSON.parse(artifact.body)).toEqual({
      taskType: 'CLASSIC', version: 1, earthModel: 'WGS84',
      turnpoints: [
        { radius: 400, waypoint: { name: 'GH001', lat: 39.123456, lon: -105.654321, altSmoothed: 1654 } },
        { radius: 400, waypoint: { name: 'GH002', lat: 39.25, lon: -104.75, altSmoothed: 2006 } },
      ],
    });
  });

  it('rejects invalid prefixes and coordinates', () => {
    expect(() => createPlanExportArtifact({ format: 'cup', prefix: 'bad prefix', points })).toThrow('prefix');
    expect(() => createPlanExportArtifact({ format: 'cup', prefix: 'GH', points: [{ ...points[0]!, latitude: 90 }, points[1]!] })).toThrow('latitude');
  });
});
