/**
 * 地图模块：Mapbox GL 初始化、中心点 Marker（可拖拽）、等时圈图层渲染与图例。
 *
 * 渲染策略：数据驱动配色（按 minutes 属性 match 到颜色），
 * 因此支持任意档位数量，不再固定 4 个图层。
 */
import mapboxgl from 'mapbox-gl';
import { assertToken } from './config';
import type { IsochroneResult } from './isochrone';

export interface MapCallbacks {
  onPick: (lng: number, lat: number) => void;
  onDragEnd: (lng: number, lat: number) => void;
}

const SRC_ID = 'isochrones';
const FILL_ID = 'iso-fill';
const LINE_ID = 'iso-outline';

/** 由深到浅的顺序配色（最短时档最深，最外侧最浅） */
const PALETTE = [
  '#0b6e4f',
  '#1a9850',
  '#66bd63',
  '#a6d96a',
  '#d9ef8b',
  '#fee08b',
  '#fdae61',
  '#f46d43',
];

const CENTER: [number, number] = [121.4737, 31.2304];

export function createMap(callbacks: MapCallbacks): mapboxgl.Map {
  const token = assertToken();
  mapboxgl.accessToken = token;

  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/navigation-night-v1',
    center: CENTER,
    zoom: 10,
  });

  // 可拖拽中心点
  const marker = new mapboxgl.Marker({ draggable: true })
    .setLngLat(CENTER)
    .addTo(map);

  map.on('click', (e) => {
    marker.setLngLat(e.lngLat);
    callbacks.onPick(e.lngLat.lng, e.lngLat.lat);
  });
  marker.on('dragend', () => {
    const { lng, lat } = marker.getLngLat();
    callbacks.onDragEnd(lng, lat);
  });

  map.on('load', () => {
    map.addSource(SRC_ID, { type: 'geojson', data: emptyFeatureCollection() });

    map.addLayer({
      id: FILL_ID,
      type: 'fill',
      source: SRC_ID,
      paint: {
        'fill-color': '#1a9850',
        'fill-opacity': 0.4,
      },
    });

    map.addLayer({
      id: LINE_ID,
      type: 'line',
      source: SRC_ID,
      paint: { 'line-color': '#ffffff', 'line-width': 1, 'line-opacity': 0.55 },
    });
  });

  return map;
}

function emptyFeatureCollection(): IsochroneResult {
  return { type: 'FeatureCollection', features: [] };
}

/** 按档位排名分配颜色：短时档深、长时档浅 */
export function colorForRank(rank: number, total: number): string {
  if (total <= 1) return PALETTE[0];
  const idx = Math.round((rank / (total - 1)) * (PALETTE.length - 1));
  return PALETTE[Math.max(0, Math.min(PALETTE.length - 1, idx))];
}

/**
 * 渲染等时圈。
 * 用 match 表达式把 minutes 映射到颜色，一次 setData 即可完成配色，
 * 支持任意档位数量（不受固定图层数限制）。
 */
export function renderIsochrones(map: mapboxgl.Map, result: IsochroneResult): void {
  const src = map.getSource(SRC_ID) as mapboxgl.GeoJSONSource | undefined;
  if (!src) return;

  const features = [...result.features]
    .map((f) => ({
      ...f,
      properties: { ...f.properties, minutes: Number(f.properties?.minutes) },
    }))
    .filter((f) => Number.isFinite(f.properties.minutes))
    .sort((a, b) => a.properties.minutes - b.properties.minutes);

  if (!map.getLayer(FILL_ID)) {
    src.setData({ type: 'FeatureCollection', features });
    return;
  }

  if (features.length === 0) {
    map.setPaintProperty(FILL_ID, 'fill-color', '#1a9850');
    src.setData({ type: 'FeatureCollection', features });
    return;
  }

  // 数据顺序：大圈在前、小圈在后，使小圈绘制在上层（嵌套关系正确）
  src.setData({ type: 'FeatureCollection', features: [...features].reverse() });

  // 构造 ['match', ['get','minutes'], m1, c1, m2, c2, ..., fallback]
  const matchExpr: unknown[] = ['match', ['get', 'minutes']];
  features.forEach((f, i) => {
    matchExpr.push(f.properties.minutes, colorForRank(i, features.length));
  });
  matchExpr.push('#888888');

  map.setPaintProperty(FILL_ID, 'fill-color', matchExpr as never);
}

export function clearIsochrones(map: mapboxgl.Map): void {
  const src = map.getSource(SRC_ID) as mapboxgl.GeoJSONSource | undefined;
  if (src) src.setData(emptyFeatureCollection());
}

/** 生成图例 HTML（由调用方插入 DOM） */
export function buildLegendHtml(result: IsochroneResult): string {
  const features = [...result.features].sort(
    (a, b) => Number(a.properties?.minutes) - Number(b.properties?.minutes)
  );
  if (features.length === 0) return '';
  const rows = features
    .map((f, i) => {
      const color = colorForRank(i, features.length);
      const m = Number(f.properties?.minutes);
      return `<div class="legend-row">
        <span class="legend-swatch" style="background:${color}"></span>
        <span class="legend-label">${m} 分钟</span>
      </div>`;
    })
    .join('');
  return `<div class="legend-title">等时圈</div>${rows}`;
}

export function fitToIsochrones(map: mapboxgl.Map, result: IsochroneResult): void {
  if (result.features.length === 0) return;
  const lngs: number[] = [];
  const lats: number[] = [];
  for (const f of result.features) {
    for (const ring of f.geometry.coordinates) {
      for (const [lng, lat] of ring) {
        lngs.push(lng);
        lats.push(lat);
      }
    }
  }
  map.fitBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: 60, maxZoom: 13, duration: 600 }
  );
}
