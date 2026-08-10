const LOCAL_AND_TAURI_ORIGINS = [
  'http://localhost:6130',
  'http://127.0.0.1:6130',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'https://localhost',
  'asset://localhost',
];

const isAllowedProductionOrigin = (origin: string) => {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin;
  } catch {
    return false;
  }
};

export const parseCorsAllowedOrigins = (value = '', nodeEnvironment = process.env.NODE_ENV) => {
  const productionOrigins = value
    .split(',')
    .map(origin => origin.trim())
    .filter(isAllowedProductionOrigin);

  return [...new Set([...LOCAL_AND_TAURI_ORIGINS, ...productionOrigins])];
};
