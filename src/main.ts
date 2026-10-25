/**
 * 入口：组装地图、UI、查询与统计。
 */
import './styles.css';
import type mapboxgl from 'mapbox-gl';
import { createMap, renderIsochrones, clearIsochrones, fitToIsochrones, buildLegendHtml } from './map';
import { fetchIsochrones, type IsochroneResult, type TravelMode, MIN_MINUTES, MAX_MINUTES } from './isochrone';
import { loadDistricts, computeStats, type ContourStat, type DistrictRecord } from './stats';
import {
  initUi,
  setLngLatInput,
  readLngLatInput,
  setStatus,
  setExportEnabled,
  renderStats,
  renderLegend,
  hideStats,
} from './ui';
import { exportGeoJson } from './export';

const MODES = [
  { value: 'driving', label: '驾车' },
  { value: 'cycling', label: '骑行' },
  { value: 'walking', label: '步行' },
  // 公交/地铁模式预留：接入高德 ArrivalRange 后在此追加
];

/** 常用预设档位（快捷增减）。注意：Mapbox 上限 60 分钟，故不含更大值 */
const PRESET_CONTOURS = [5, 15, 30, 45, 60];

const state = {
  mode: 'driving' as TravelMode,
  contours: [15, 30, 45, 60] as number[],
  lastResult: null as IsochroneResult | null,
  lastStats: [] as ContourStat[],
  districts: null as DistrictRecord[] | null,
  districtsReady: false,
};

let map: mapboxgl.Map;

async function runQuery(lng: number, lat: number): Promise<void> {
  const minutes = [...state.contours].sort((a, b) => a - b);
  if (minutes.length === 0) {
    setStatus('请至少选择一个等时档位', 'error');
    return;
  }
  setStatus(`查询中…（${minutes.join('/')} 分钟 · ${state.mode}）`, 'busy');
  setExportEnabled(false);
  try {
    const result = await fetchIsochrones(lng, lat, state.mode, minutes);
    state.lastResult = result;
    state.lastStats = result.features
      .map((f) => computeStats(f, state.districts))
      .sort((a, b) => a.minutes - b.minutes);
    renderIsochrones(map, result);
    renderLegend(buildLegendHtml(result));
    fitToIsochrones(map, result);
    renderStats(state.lastStats, { popAvailable: state.districtsReady && !!state.districts });
    setExportEnabled(result.features.length > 0);
    setStatus(`完成：${result.features.length} 档等时圈`, 'ok');
  } catch (err) {
    hideStats();
    renderLegend('');
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  }
}

function queryFromInput(): void {
  const pos = readLngLatInput();
  if (!pos) {
    setStatus('坐标格式不正确，应为 "经度, 纬度"', 'error');
    return;
  }
  void runQuery(pos.lng, pos.lat);
}

function clearAll(): void {
  clearIsochrones(map);
  renderLegend('');
  state.lastResult = null;
  state.lastStats = [];
  hideStats();
  setExportEnabled(false);
  setStatus('');
}

function locate(): void {
  if (!navigator.geolocation) {
    setStatus('浏览器不支持定位', 'error');
    return;
  }
  setStatus('定位中…', 'busy');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { longitude, latitude } = pos.coords;
      setLngLatInput(longitude, latitude);
      map.setCenter([longitude, latitude]);
      void runQuery(longitude, latitude);
    },
    () => setStatus('定位失败（需要 HTTPS 且授权）', 'error')
  );
}

async function main(): Promise<void> {
  initUi(
    {
      modes: MODES,
      activeMode: state.mode,
      activeContours: state.contours,
      presets: PRESET_CONTOURS,
      minMinutes: MIN_MINUTES,
      maxMinutes: MAX_MINUTES,
    },
    {
      onSearch: queryFromInput,
      onClear: clearAll,
      onExport: () => state.lastResult && exportGeoJson(state.lastResult, state.lastStats),
      onModeChange: (m) => {
        state.mode = m as TravelMode;
        queryFromInput();
      },
      onContoursChange: (list) => {
        state.contours = list;
      },
      onLocate: locate,
    }
  );

  map = createMap({
    onPick: (lng, lat) => {
      setLngLatInput(lng, lat);
      void runQuery(lng, lat);
    },
    onDragEnd: (lng, lat) => {
      setLngLatInput(lng, lat);
      void runQuery(lng, lat);
    },
  });

  // 人口数据异步加载，不阻塞首屏
  void loadDistricts().then((d) => {
    state.districts = d;
    state.districtsReady = true;
    // 数据到达后若已有统计结果，重算一次以补上人口列
    if (state.lastResult) {
      state.lastStats = state.lastResult.features
        .map((f) => computeStats(f, d))
        .sort((a, b) => a.minutes - b.minutes);
      renderStats(state.lastStats, { popAvailable: !!d });
    }
  });

  setStatus('点击地图选择出发位置');
}

void main();
