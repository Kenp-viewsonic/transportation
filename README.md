# 等时圈查询与统计工具

基于 [ni1o1/amapreachcircle](https://github.com/ni1o1/amapreachcircle)（MIT）二次开发的等时圈工具：
Mapbox 底图 + Mapbox Isochrone API，支持步行/骑行/驾车的多档嵌套等时圈，
并统计每档覆盖面积与覆盖人口（七普区县级数据按面积加权估算）。

## 功能

- 点击地图或拖拽中心点选点，自动重查
- 出行方式：驾车 / 骑行 / 步行（公交/地铁模式预留，接入高德后可点亮）
- 等时档位：15 / 30 / 45 / 60 分钟可任选（Mapbox 单次最多 4 档）
- 统计面板：各档面积（km²）、覆盖人口、人口密度
- 导出 GeoJSON（properties 附带统计信息，WGS84）
- 深色底图、移动端适配

## 快速开始

```bash
# 1. 配置 Token（免费申请: https://account.mapbox.com/）
cp .env.example .env.local
# 编辑 .env.local 填入 VITE_MAPBOX_TOKEN

# 2. 安装依赖并启动
npm install
npm run dev
```

## 人口数据

覆盖人口统计使用 [leiii/census](https://github.com/leiii/census)（MIT）整理的
**第七次全国人口普查区县级常住人口**数据（约 2600 区县，自带边界）：

```bash
npm run build:data
# CSV 不存在时自动从 GitHub 下载（约 9MB），生成 public/data/pop-districts.json（约 7MB）
```

- 人口按面积加权分摊：$P_{covered} = \sum_d P_d \cdot \frac{A(iso \cap d)}{A(d)}$
- 数据覆盖约 90% 人口（少量区县缺边界被跳过），结果为估算值，仅供参考
- 无数据文件时自动降级为"仅面积统计"

## 部署到 GitHub Pages

1. 在 GitHub 创建仓库并推送代码
2. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**
3. push 到 `main` 即自动部署，地址为 `https://<用户名>.github.io/<仓库名>/`

注意：本项目使用 Vite 相对路径构建（`base: './'`），无需额外配置。

**Token 安全**：公开部署时前端 Token 会被看到。请到
[Mapbox 控制台](https://account.mapbox.com/access-tokens/) 新建一个**受限 Token**：
只勾选 `styles`、`tiles`、`isochrone` 三个 scope，并添加 **URL restriction**
（限定 `https://<用户名>.github.io/*`），防止被盗用。

## 项目结构

```
├── index.html            # 页面
├── .github/workflows/deploy.yml  # GitHub Pages 自动部署
├── src/
│   ├── main.ts           # 入口与状态
│   ├── map.ts            # Mapbox GL 地图与渲染
│   ├── isochrone.ts      # Isochrone API 封装
│   ├── stats.ts          # 面积 + 人口统计
│   ├── export.ts         # GeoJSON 导出
│   ├── ui.ts             # 控件与表格
│   ├── coord.ts          # WGS84/GCJ02 转换（数据管线用）
│   └── config.ts         # Token 配置
├── scripts/build-data.mjs # 人口数据管线（一次性）
└── public/data/           # 管线产物
```

## 许可

MIT。基于 ni1o1/amapreachcircle 修改，坐标转换算法移植自原项目。
