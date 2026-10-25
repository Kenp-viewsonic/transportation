/**
 * 人口数据管线：scripts/pop-census.csv -> public/data/pop-districts.json
 *
 * 数据源：leiii/census（MIT）「China county-level population data (census)」
 *   https://github.com/leiii/census
 *   census_county_2010-2020_v1.csv：七普(2020)区县常住人口 + 区县边界（WKT）
 *
 * 运行：npm run build:data
 *   - CSV 不存在时自动从 GitHub 下载（约 9MB）
 *   - 解析 WKT 边界 -> GeoJSON（WGS84）
 *   - Douglas-Peucker 简化 + 坐标取整，控制产物体积
 *   - 预计算各区面积与 bbox，运行时零重复计算
 *   - 校验人口总量（七普全国 14.1178 亿）
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const CSV_PATH = path.join(ROOT, 'scripts', 'pop-census.csv');
const CSV_URL =
  'https://raw.githubusercontent.com/leiii/census/main/data/census/census_county_2010-2020_v1.csv';

/** 简化容差（度）。0.001° ≈ 100m，对人口分摊精度足够 */
const SIMPLIFY_TOLERANCE = 0.001;
/** 坐标小数位数（4 位 ≈ 11m 精度） */
const COORD_PRECISION = 4;

// ---------- CSV 解析（处理带引号字段，WKT 内含逗号） ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

// ---------- WKT 解析 ----------
function parseWkt(wkt) {
  const s = wkt.trim();
  if (s.startsWith('POLYGON')) {
    const rings = parseRings(s.slice(s.indexOf('(')));
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (s.startsWith('MULTIPOLYGON')) {
    const body = s.slice(s.indexOf('('));
    const polys = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '(') {
        depth++;
        if (depth === 2) start = i;
      } else if (body[i] === ')') {
        depth--;
        if (depth === 1 && start >= 0) {
          const rings = parseRings(body.slice(start, i + 1));
          if (rings.length) polys.push(rings);
          start = -1;
        }
      }
    }
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
  }
  return null;
}

/** 输入形如 "((x y, x y, ...),(...))"，返回环数组 */
function parseRings(str) {
  const rings = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') {
      depth++;
      if (depth === 2) start = i;
    } else if (str[i] === ')') {
      depth--;
      if (depth === 1 && start >= 0) {
        const ring = str
          .slice(start + 1, i)
          .split(',')
          .map((pair) => pair.trim().split(/\s+/).map(Number))
          .filter((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (ring.length >= 4) rings.push(ring);
        start = -1;
      }
    }
  }
  return rings;
}

// ---------- Douglas-Peucker 简化 ----------
function perpendicularDistance(p, a, b) {
  const [x, y] = p;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / len2;
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + clamped * dx), y - (y1 + clamped * dy));
}

function simplifyRing(ring, tolerance) {
  if (ring.length <= 8) return ring; // 环太小不简化
  // 首尾闭合点不参与简化
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  const keep = new Array(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;

  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1;
    let maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpendicularDistance(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > tolerance && maxI > 0) {
      keep[maxI] = true;
      stack.push([s, maxI], [maxI, e]);
    }
  }

  const out = pts.filter((_, i) => keep[i]);
  if (closed) out.push(out[0]);
  return out.length >= 4 ? out : ring;
}

function simplifyGeometry(geom, tolerance) {
  const roundTo = (v) => Number(v.toFixed(COORD_PRECISION));
  const round = (c) => c.map((p) => [roundTo(p[0]), roundTo(p[1])]);
  if (geom.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geom.coordinates.map((r) => round(simplifyRing(r, tolerance))),
    };
  }
  return {
    type: 'MultiPolygon',
    coordinates: geom.coordinates.map((poly) => poly.map((r) => round(simplifyRing(r, tolerance)))),
  };
}

// ---------- 球面面积 ----------
const R = 6378137;
function ringAreaM2(ring) {
  let total = 0;
  const n = ring.length;
  if (n < 3) return 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    total += ((x1 - x2) * Math.PI) / 180 * (Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
  }
  return Math.abs((total * R * R) / 2);
}

function polygonAreaM2(coords) {
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const a = ringAreaM2(coords[i]);
    area += i === 0 ? a : -a;
  }
  return Math.abs(area);
}

function geometryAreaM2(geom) {
  if (geom.type === 'Polygon') return polygonAreaM2(geom.coordinates);
  return geom.coordinates.reduce((s, c) => s + polygonAreaM2(c), 0);
}

function bboxOf(geom) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    coords.forEach(walk);
  };
  walk(geom.coordinates);
  return [minLng, minLat, maxLng, maxLat];
}

// ---------- 主流程 ----------
async function main() {
  // 1. 确保 CSV 存在（必要时下载）
  if (!existsSync(CSV_PATH)) {
    console.log('[0/3] 未找到 CSV，开始下载（约 9MB）…');
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`);
    await writeFile(CSV_PATH, await res.text());
    console.log('      下载完成');
  }

  console.log('[1/3] 解析 CSV…');
  const rows = parseCsv(await readFile(CSV_PATH, 'utf-8'));
  const header = rows[0];
  const col = (name) => header.indexOf(name);
  const iCode = col('county_code');
  const iName = col('county');
  const iPop = col('popu_2020');
  const iCoord = col('coord');
  if (iCode < 0 || iPop < 0 || iCoord < 0) {
    throw new Error(`CSV 列缺失：需要 county_code / popu_2020 / coord，实际表头 ${header.join(',')}`);
  }

  console.log('[2/3] 解析 WKT 边界 + 简化 + 计算面积…');
  const districts = [];
  let skipped = 0;
  let totalPop = 0;

  for (const row of rows.slice(1)) {
    const adcode = Number(row[iCode]);
    const pop = Number(row[iPop]);
    const wkt = row[iCoord];
    const hasWkt = wkt && (wkt.startsWith('POLYGON') || wkt.startsWith('MULTIPOLYGON'));
    if (!Number.isFinite(adcode) || !Number.isFinite(pop) || pop <= 0 || !hasWkt) {
      skipped++;
      continue;
    }
    const geom = parseWkt(wkt);
    if (!geom) {
      skipped++;
      continue;
    }
    const simplified = simplifyGeometry(geom, SIMPLIFY_TOLERANCE);
    const area = geometryAreaM2(simplified);
    if (area <= 0) {
      skipped++;
      continue;
    }
    totalPop += pop;
    districts.push({
      adcode,
      name: row[iName] ?? '',
      pop,
      area,
      bbox: bboxOf(simplified),
      polygon: simplified,
    });
  }

  // 3. 校验与输出
  const EXPECTED = 1_411_780_000; // 七普全国常住人口
  const ratio = totalPop / EXPECTED;
  console.log(`      区县 ${districts.length} 个，跳过 ${skipped} 行`);
  console.log(`      人口合计 ${(totalPop / 1e8).toFixed(4)} 亿（占七普全国 ${(ratio * 100).toFixed(2)}%）`);
  if (ratio < 0.9 || ratio > 1.05) {
    console.warn('      ⚠ 人口总量偏离预期，请检查数据源');
  }

  console.log('[3/3] 写出 public/data/pop-districts.json…');
  await mkdir(OUT_DIR, { recursive: true });
  const out = {
    meta: {
      source: 'leiii/census (MIT) · 第七次全国人口普查区县级常住人口',
      coord: 'WGS84',
      simplified: `Douglas-Peucker ${SIMPLIFY_TOLERANCE}°`,
      generatedAt: new Date().toISOString(),
      count: districts.length,
      totalPop,
    },
    districts,
  };
  await writeFile(path.join(OUT_DIR, 'pop-districts.json'), JSON.stringify(out));
  const mb = (JSON.stringify(out).length / 1024 / 1024).toFixed(1);
  console.log(`完成 ✓  产物 ${mb} MB（gzip 后约 ${Math.round(mb * 0.35)} MB）`);
}

main().catch((err) => {
  console.error('构建失败:', err);
  process.exit(1);
});
