/**
 * 导出模块：GeoJSON 下载（properties 附带统计信息）。
 */
import type { ContourStat } from './stats';
import type { IsochroneResult } from './isochrone';

export function exportGeoJson(result: IsochroneResult, stats: ContourStat[]): void {
  const statByMinutes = new Map(stats.map((s) => [s.minutes, s]));
  const fc: IsochroneResult = {
    type: 'FeatureCollection',
    features: result.features.map((f) => {
      const minutes = Number(f.properties?.minutes);
      const s = statByMinutes.get(minutes);
      return {
        ...f,
        properties: {
          minutes,
          mode: f.properties?.mode,
          area_km2: s ? Number(s.areaKm2.toFixed(4)) : null,
          population: s?.population ?? null,
          density_per_km2: s?.density !== null && s ? Math.round(s.density) : null,
        },
      };
    }),
  };
  const blob = new Blob([JSON.stringify(fc)], { type: 'application/geo+json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `isochrones-${Date.now()}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}
