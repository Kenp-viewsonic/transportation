/**
 * WGS84 <-> GCJ02 坐标转换。
 * 移植自 ni1o1/amapreachcircle（MIT License），仅用于：
 * 1. 数据管线：把 DataV 的 GCJ02 行政区边界转为 WGS84
 * 2. 导出选项：需要时把 WGS84 结果转回 GCJ02
 * 运行时主链路全部使用 WGS84，不做任何转换。
 */

const PI = 3.1415926535897932384626;
const EE = 0.00669342162296594323;
const A = 6378245.0;

export type LngLat = [number, number];

function transformLat(lng: number, lat: number): number {
  let ret =
    -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  ret += ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(lat * PI) + 40.0 * Math.sin((lat / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((lat / 12.0) * PI) + 320 * Math.sin((lat * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(lng: number, lat: number): number {
  let ret =
    300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  ret += ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(lng * PI) + 40.0 * Math.sin((lng / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((lng / 12.0) * PI) + 300.0 * Math.sin((lng / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}

function delta(lng: number, lat: number): [number, number] {
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [dLng, dLat];
}

/** WGS84 -> GCJ02 */
export function wgs84ToGcj02(lng: number, lat: number): LngLat {
  if (outOfChina(lng, lat)) return [lng, lat];
  const [dLng, dLat] = delta(lng, lat);
  return [lng + dLng, lat + dLat];
}

/** GCJ02 -> WGS84（近似逆变换，误差约 1-2m，足够制图使用） */
export function gcj02ToWgs84(lng: number, lat: number): LngLat {
  if (outOfChina(lng, lat)) return [lng, lat];
  const [dLng, dLat] = delta(lng, lat);
  return [lng * 2 - (lng + dLng), lat * 2 - (lat + dLat)];
}

export function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

/** 深度遍历 GeoJSON 坐标数组，对每个位置应用转换函数 */
export function transformGeoJsonCoordinates(
  coords: unknown,
  fn: (lng: number, lat: number) => LngLat
): unknown {
  if (typeof coords[0] === 'number') {
    const [lng, lat] = coords as number[];
    return fn(lng, lat);
  }
  return (coords as unknown[]).map((c) => transformGeoJsonCoordinates(c, fn));
}
