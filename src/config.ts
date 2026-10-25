/**
 * 运行时配置。
 * Token 从环境变量读取（.env.local 中 VITE_MAPBOX_TOKEN），
 * 未配置时给出明确提示而不是静默失败。
 */
const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

export const config = {
  mapboxToken: token && !token.includes('填入') ? token : '',
};

export function assertToken(): string {
  if (!config.mapboxToken) {
    throw new Error(
      '未配置 Mapbox Token：请复制 .env.example 为 .env.local，填入你的公开 Token 后重启 dev server。'
    );
  }
  return config.mapboxToken;
}
