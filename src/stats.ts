/**
 * 统计模块：面积计算 + 覆盖人口估算。
 *
 * 面积：turf.area 直接计算。
 * 人口：七普区县级人口按面积加权分摊 ——
 *   P_covered = Σ P_d * A(iso ∩ d) / A(d)
 * 人口数据（public/data/pop-districts.json）由 scripts/build-data.mjs 生成；
 * 数据缺失时人口列显示 "-"，其余功能不受影响。
 */
import * as turf from '@turf/turf';

export interface DistrictRecord {
  adcode: number;
  name: string;
  pop: number; // 七普常住人口
  area: number; // 预计算面积 m²
  bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  polygon: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

export interface ContourStat {
  minutes: number;
  areaKm2: number;
  population: number | null;
  density: number | null; // 人/km²
}

let districts: DistrictRecord[] | null = null;
let districtsLoaded = false;

export async function loadDistricts(): Promise<DistrictRecord[] | null> {
  if (districtsLoaded) return districts;
  districtsLoaded = true;
  try {
    const res = await fetch('data/pop-districts.json');
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { districts: DistrictRecord[] };
    districts = data.districts;
  } catch {
    districts = null; // 数据缺失时静默降级
  }
  return districts;
}

/** 计算单个等时圈多边形的面积（km²） */
export function contourAreaKm2(feature: IsochroneFeatureLike): number {
  return turf.area(feature as never) / 1e6;
}

export interface IsochroneFeatureLike {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties?: { [k: string]: unknown };
}

/** 估算等时圈覆盖人口（面积加权）。无数据返回 null。 */
export function estimatePopulation(
  feature: IsochroneFeatureLike,
  records: DistrictRecord[] | null
): number | null {
  if (!records || records.length === 0) return null;
  const isoBbox = turf.bbox(feature as never);
  let total = 0;
  let touched = false;

  for (const d of records) {
    // bbox 预筛：不相交直接跳过
    if (
      d.bbox[2] < isoBbox[0] ||
      d.bbox[0] > isoBbox[2] ||
      d.bbox[3] < isoBbox[1] ||
      d.bbox[1] > isoBbox[3]
    ) {
      continue;
    }
    // turf 7 的 intersect 接收 FeatureCollection（至少 2 个几何），
    // 与 turf 6 的 (poly1, poly2) 双参数签名不同
    const inter = turf.intersect(
      turf.featureCollection([
        turf.feature(d.polygon as never),
        feature as never,
      ]) as never
    );
    if (!inter || inter.geometry.type === 'GeometryCollection') continue;
    touched = true;
    const interArea = turf.area(inter as never);
    if (d.area > 0 && interArea > 0) {
      total += (d.pop * interArea) / d.area;
    }
  }
  return touched ? Math.round(total) : null;
}

/** 汇总一档等时圈的完整统计 */
export function computeStats(
  feature: IsochroneFeatureLike,
  records: DistrictRecord[] | null
): ContourStat {
  const areaKm2 = contourAreaKm2(feature);
  const population = estimatePopulation(feature, records);
  const density = population !== null && areaKm2 > 0 ? population / areaKm2 : null;
  return { minutes: Number(feature.properties?.minutes ?? 0), areaKm2, population, density };
}

export function formatNumber(n: number | null): string {
  if (n === null) return '-';
  if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(2) + ' 万';
  return Math.round(n).toLocaleString('zh-CN');
}
