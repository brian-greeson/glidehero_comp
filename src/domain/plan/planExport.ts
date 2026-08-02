export type PlanExportFormat = 'cup' | 'tsk' | 'wpt' | 'xctsk';
export type PlanExportVariant = 'main-turnpoints' | 'optimized-track';
export type ElevatedPlanPoint = { latitude: number; longitude: number; elevationMeters: number };

export type PlanExportArtifact = {
  body: string;
  contentType: string;
  extension: PlanExportFormat;
};

const TURNPOINT_RADIUS_METERS = 400;

function name(prefix: string, index: number): string {
  return `${prefix}${String(index + 1).padStart(3, '0')}`;
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function degreesMinutes(value: number, degreeWidth: number, hemispheres: string): string {
  const absolute = Math.abs(value);
  let degrees = Math.floor(absolute);
  let minutes = Number(((absolute - degrees) * 60).toFixed(3));
  if (minutes >= 60) {
    degrees += 1;
    minutes = 0;
  }
  const hemisphere = value < 0 ? hemispheres[1] : hemispheres[0];
  return `${String(degrees).padStart(degreeWidth, '0')}${minutes.toFixed(3).padStart(6, '0')}${hemisphere}`;
}

function degreesMinutesSeconds(value: number, degreeWidth: number, hemispheres: string): string {
  const absolute = Math.abs(value);
  let degrees = Math.floor(absolute);
  let minutes = Math.floor((absolute - degrees) * 60);
  let seconds = Number((((absolute - degrees) * 60 - minutes) * 60).toFixed(2));
  if (seconds >= 60) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }
  const hemisphere = value < 0 ? hemispheres[1] : hemispheres[0];
  return `${hemisphere} ${String(degrees).padStart(degreeWidth, '0')} ${String(minutes).padStart(2, '0')} ${seconds.toFixed(2).padStart(5, '0')}`;
}

function cup(points: readonly ElevatedPlanPoint[], prefix: string): PlanExportArtifact {
  const rows = points.map((point, index) => {
    const waypointName = name(prefix, index);
    return [
      csv(waypointName), csv(waypointName), '',
      degreesMinutes(point.latitude, 2, 'NS'), degreesMinutes(point.longitude, 3, 'EW'),
      `${Math.round(point.elevationMeters)}m`, '1', '', '', '', csv(''),
    ].join(',');
  });
  const relatedTask = [csv('GlideHero Task'), csv('???'), ...points.map((_, index) => csv(name(prefix, index))), csv('???')].join(',');
  return {
    body: ['name,code,country,lat,lon,elev,style,rwdir,rwlen,freq,desc', ...rows, '-----Related Tasks-----', relatedTask, ''].join('\r\n'),
    contentType: 'application/x-cup; charset=utf-8',
    extension: 'cup',
  };
}

function tsk(points: readonly ElevatedPlanPoint[], prefix: string): PlanExportArtifact {
  const body = points.map((point, index) => {
    const type = index === 0 ? 'Start' : index === points.length - 1 ? 'Finish' : 'Turn';
    return `  <Point type="${type}">\n    <Waypoint name="${xml(name(prefix, index))}" comment="">\n      <Location latitude="${point.latitude.toFixed(6)}" longitude="${point.longitude.toFixed(6)}"/>\n      <ObservationZone type="Cylinder" radius="${TURNPOINT_RADIUS_METERS}" altitude="${Math.round(point.elevationMeters)}"/>\n    </Waypoint>\n  </Point>`;
  }).join('\n');
  return {
    body: `<?xml version="1.0" encoding="UTF-8"?>\n<Task type="RT">\n${body}\n</Task>\n`,
    contentType: 'application/tsk+xml; charset=utf-8',
    extension: 'tsk',
  };
}

function wpt(points: readonly ElevatedPlanPoint[], prefix: string): PlanExportArtifact {
  const rows = points.map((point, index) => (
    `${name(prefix, index).padEnd(8)} ${degreesMinutesSeconds(point.latitude, 2, 'NS')}    ${degreesMinutesSeconds(point.longitude, 3, 'EW')}  ${String(Math.round(point.elevationMeters)).padStart(5)}  `
  ));
  return {
    body: ['$FormatGEO', ...rows, ''].join('\r\n'),
    contentType: 'application/x-wpt; charset=utf-8',
    extension: 'wpt',
  };
}

function xctsk(points: readonly ElevatedPlanPoint[], prefix: string): PlanExportArtifact {
  return {
    body: JSON.stringify({
      taskType: 'CLASSIC',
      version: 1,
      earthModel: 'WGS84',
      turnpoints: points.map((point, index) => ({
        radius: TURNPOINT_RADIUS_METERS,
        waypoint: {
          name: name(prefix, index),
          lat: Number(point.latitude.toFixed(6)),
          lon: Number(point.longitude.toFixed(6)),
          altSmoothed: Math.round(point.elevationMeters),
        },
      })),
    }),
    contentType: 'application/xctsk; charset=utf-8',
    extension: 'xctsk',
  };
}

export function createPlanExportArtifact(input: {
  format: PlanExportFormat;
  prefix: string;
  points: readonly ElevatedPlanPoint[];
}): PlanExportArtifact {
  if (input.points.length < 2) throw new RangeError('A plan export requires at least two points.');
  if (!/^[A-Z0-9]{1,8}$/.test(input.prefix)) throw new RangeError('Waypoint prefix must contain 1–8 letters or numbers.');
  for (const point of input.points) {
    if (!Number.isFinite(point.latitude) || point.latitude < -85 || point.latitude > 85) throw new RangeError('Export latitude is invalid.');
    if (!Number.isFinite(point.longitude) || point.longitude <= -180 || point.longitude >= 180) throw new RangeError('Export longitude is invalid.');
    if (!Number.isFinite(point.elevationMeters)) throw new RangeError('Export elevation is invalid.');
  }
  if (input.format === 'cup') return cup(input.points, input.prefix);
  if (input.format === 'tsk') return tsk(input.points, input.prefix);
  if (input.format === 'wpt') return wpt(input.points, input.prefix);
  return xctsk(input.points, input.prefix);
}
