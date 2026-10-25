/**
 * Mapbox Isochrone API 封装。
 * 一次请求返回多档嵌套等时圈（contours_minutes 最多 4 档）。
 * API 文档: https://docs.mapbox.com/api/mapbox/isochrone/
 */
import { assertToken } from './config';

export type TravelMode = 'walking' | 'cycling' | 'driving';

export interface IsochroneFeature {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: { [key: string]: unknown };
}

export interface IsochroneResult {
  type: 'FeatureCollection';
  features: IsochroneFeature[];
}

export class IsochroneError extends Error {}

const API_BASE = 'https://api.mapbox.com/isochrone/v1/mapbox';

/** Mapbox 单次请求最多支持 4 档，超过则自动分批并发请求后合并 */
const MAX_PER_REQUEST = 4;

/** 分钟数以 Mapbox 限制为准：整数 1~60 */
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 60;

async function requestChunk(
  token: string,
  lng: number,
  lat: number,
  mode: TravelMode,
  minutes: number[]
): Promise<IsochroneFeature[]> {
  const params = new URLSearchParams({
    contours_minutes: minutes.join(','),
    polygons: 'true',
    access_token: token,
  });

  const url = `${API_BASE}/${mode}/${lng.toFixed(6)},${lat.toFixed(6)}?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;
    } catch {
      /* ignore */
    }
    throw new IsochroneError(`等时圈查询失败：${msg}`);
  }
  const data = (await res.json()) as IsochroneResult;
  return data.features ?? [];
}

export async function fetchIsochrones(
  lng: number,
  lat: number,
  mode: TravelMode,
  minutes: number[]
): Promise<IsochroneResult> {
  const token = assertToken();

  // 去重 + 过滤非法值 + 升序
  const list = [...new Set(minutes)]
    .filter((m) => Number.isFinite(m) && m >= MIN_MINUTES && m <= MAX_MINUTES)
    .map((m) => Math.round(m))
    .sort((a, b) => a - b);

  if (list.length === 0) {
    throw new IsochroneError(`请至少选择一个等时档位（${MIN_MINUTES}~${MAX_MINUTES} 分钟）`);
  }

  // 超过 4 档时按 4 个一组分批请求，再合并结果
  const chunks: number[][] = [];
  for (let i = 0; i < list.length; i += MAX_PER_REQUEST) {
    chunks.push(list.slice(i, i + MAX_PER_REQUEST));
  }

  const batches = await Promise.all(
    chunks.map((chunk) => requestChunk(token, lng, lat, mode, chunk))
  );

  // 关键：Mapbox 返回的属性名是 contour，这里统一规范化为 minutes，
  // 下游（统计/图层 filter/导出）一律只认 minutes。
  const features = batches.flat().map((f) => ({
    ...f,
    properties: {
      ...f.properties,
      minutes: Number((f.properties as { contour?: unknown })?.contour ?? f.properties?.minutes ?? 0),
    },
  }));

  return { type: 'FeatureCollection', features };
}
