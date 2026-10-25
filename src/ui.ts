/**
 * UI 模块：控件生成、状态提示、统计表格渲染。
 */
import type { ContourStat } from './stats';
import { formatNumber } from './stats';

export interface UiHandlers {
  onSearch: () => void;
  onClear: () => void;
  onExport: () => void;
  onModeChange: (mode: string) => void;
  /** 档位集合变化（增、删）后回调最新列表 */
  onContoursChange: (minutes: number[]) => void;
  onLocate: () => void;
}

export interface UiState {
  modes: { value: string; label: string }[];
  activeMode: string;
  /** 当前已选档位 */
  activeContours: number[];
  /** 常用预设档位 */
  presets: number[];
  minMinutes: number;
  maxMinutes: number;
}

/** 档位数量上限（防止误加过多导致请求过慢） */
const MAX_CONTOURS = 8;

export function initUi(state: UiState, handlers: UiHandlers): void {
  renderModeChips(state, handlers);
  renderContourEditor(state, handlers);

  document.getElementById('btn-search')!.addEventListener('click', handlers.onSearch);
  document.getElementById('btn-clear')!.addEventListener('click', handlers.onClear);
  document.getElementById('btn-export')!.addEventListener('click', handlers.onExport);
  document.getElementById('btn-locate')!.addEventListener('click', handlers.onLocate);
}

function renderModeChips(state: UiState, handlers: UiHandlers): void {
  const modesEl = document.getElementById('modes')!;
  modesEl.innerHTML = '';
  for (const m of state.modes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (m.value === state.activeMode ? ' active' : '');
    btn.dataset.mode = m.value;
    btn.textContent = m.label;
    btn.addEventListener('click', () => {
      modesEl.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      handlers.onModeChange(m.value);
    });
    modesEl.appendChild(btn);
  }
}

/**
 * 档位编辑器：
 *  - #contours  已选档位（每个带 × 可删除）
 *  - #presets   预设快捷添加按钮
 *  - #custom-minutes（range 拉杆）+ #custom-minutes-value + #btn-add-contour
 *
 * 注意：拉杆与「添加」按钮是静态 DOM 节点，其监听器只在首次绑定时注册一次
 * （见 bindContourControls），避免每次重渲染重复绑定导致一次点击触发多次。
 */
const contourControlsBound = { value: false };

function renderContourEditor(state: UiState, handlers: UiHandlers): void {
  const selected = [...new Set(state.activeContours)].sort((a, b) => a - b);

  const commit = (next: number[]) => {
    const list = [...new Set(next)].sort((a, b) => a - b);
    state.activeContours = list;
    renderContourEditor(state, handlers);
    handlers.onContoursChange(list);
  };

  // —— 已选档位 ——
  const contoursEl = document.getElementById('contours')!;
  contoursEl.innerHTML = '';
  if (selected.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = '尚未选择档位，请从下方添加';
    contoursEl.appendChild(hint);
  }
  for (const m of selected) {
    const chip = document.createElement('span');
    chip.className = 'chip selected';
    chip.textContent = `${m} 分钟`;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chip-del';
    del.title = `移除 ${m} 分钟`;
    del.textContent = '×';
    del.addEventListener('click', () => commit(selected.filter((v) => v !== m)));

    chip.appendChild(del);
    contoursEl.appendChild(chip);
  }

  // —— 预设档位（点一下添加，已选则移除）——
  const presetsEl = document.getElementById('presets')!;
  presetsEl.innerHTML = '';
  for (const m of state.presets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (selected.includes(m) ? ' active' : '');
    btn.textContent = `${m}`;
    btn.title = selected.includes(m) ? `移除 ${m} 分钟` : `添加 ${m} 分钟`;
    btn.addEventListener('click', () => {
      commit(selected.includes(m) ? selected.filter((v) => v !== m) : [...selected, m]);
    });
    presetsEl.appendChild(btn);
  }

  // —— 拉杆 + 添加按钮 ——
  const slider = document.getElementById('custom-minutes') as HTMLInputElement | null;
  const readout = document.getElementById('custom-minutes-value');
  if (!slider || !readout) return;

  // 与 API 限制保持一致
  slider.min = String(state.minMinutes);
  slider.max = String(state.maxMinutes);

  // 同步当前值到界面
  const current = clampToStep(slider, Number(slider.value) || state.minMinutes);
  slider.value = String(current);
  readout.textContent = String(current);

  if (!contourControlsBound.value) {
    contourControlsBound.value = true;
    // 拖动时实时更新读数
    slider.addEventListener('input', () => {
      if (readout) readout.textContent = slider.value;
    });
    document.getElementById('btn-add-contour')?.addEventListener('click', () => {
      const v = Number(slider.value);
      const latest = [...new Set(state.activeContours)].sort((a, b) => a - b);
      if (latest.includes(v)) {
        setStatus(`${v} 分钟已在列表中`, 'error');
        return;
      }
      if (latest.length >= MAX_CONTOURS) {
        setStatus(`档位最多 ${MAX_CONTOURS} 个，请先移除部分`, 'error');
        return;
      }
      setStatus('');
      commit([...latest, v]);
    });
  }
}

/** 把拉杆值限制在其 min/max/step 范围内 */
function clampToStep(slider: HTMLInputElement, value: number): number {
  const min = Number(slider.min || 1);
  const max = Number(slider.max || 60);
  const step = Number(slider.step || 1) || 1;
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round((clamped - min) / step) * step + min;
}

export function renderLegend(html: string): void {
  const el = document.getElementById('legend');
  if (!el) return;
  el.innerHTML = html;
  el.classList.toggle('hidden', html === '');
}

export function setLngLatInput(lng: number, lat: number): void {
  (document.getElementById('lnglat') as HTMLInputElement).value = `${lng.toFixed(6)}, ${lat.toFixed(6)}`;
}

export function readLngLatInput(): { lng: number; lat: number } | null {
  const raw = (document.getElementById('lnglat') as HTMLInputElement).value.trim();
  const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lng = parseFloat(m[1]);
  const lat = parseFloat(m[2]);
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { lng, lat };
}

export function setStatus(text: string, kind: 'idle' | 'busy' | 'error' | 'ok' = 'idle'): void {
  const el = document.getElementById('status')!;
  el.textContent = text;
  el.className = 'status ' + (kind === 'idle' ? '' : kind);
}

export function setExportEnabled(on: boolean): void {
  (document.getElementById('btn-export') as HTMLButtonElement).disabled = !on;
}

export function renderStats(stats: ContourStat[], opts?: { popAvailable?: boolean }): void {
  const wrap = document.getElementById('stats')!;
  const body = document.getElementById('stats-body')!;
  const note = document.getElementById('stats-note');
  if (stats.length === 0) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  body.innerHTML = '';
  for (const s of stats) {
    const tr = document.createElement('tr');
    const density = s.density !== null ? Math.round(s.density).toLocaleString('zh-CN') : '-';
    tr.innerHTML = `<td>${s.minutes} 分钟</td>
      <td>${s.areaKm2.toFixed(2)}</td>
      <td>${formatNumber(s.population)}</td>
      <td>${density}</td>`;
    body.appendChild(tr);
  }
  if (note) {
    note.innerHTML =
      opts?.popAvailable === false
        ? '人口数据未就绪：请运行 <code>npm run build:data</code> 生成区县人口数据（需先准备 <code>scripts/pop-census.csv</code>）。'
        : '*人口为七普区县级数据按面积加权估算，仅供参考。';
    note.classList.toggle('warn', opts?.popAvailable === false);
  }
}

export function hideStats(): void {
  document.getElementById('stats')!.classList.add('hidden');
}
