export type MapGridCellFeature = {
  type: 'Feature';
  properties: {
    cellSize: number;
    x: number;
    y: number;
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
};
export type MapGridGeoJson = {
  type: 'FeatureCollection';
  features: MapGridCellFeature[];
};
