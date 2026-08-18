import { parseCorsAllowedOrigins } from '../../src/core/gateway/cors';

describe('parseCorsAllowedOrigins', () => {
  it('keeps local desktop origins and normalizes valid origins outside production', () => {
    expect(parseCorsAllowedOrigins(' https://app.example.com,https://admin.example.com,https://app.example.com ', 'development')).toEqual([
      'http://localhost:6130',
      'http://127.0.0.1:6130',
      'tauri://localhost',
      'starlight-micro://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
      'https://localhost',
      'asset://localhost',
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('rejects wildcard, non-HTTPS, and non-origin production values', () => {
    expect(parseCorsAllowedOrigins('*,http://app.example.com,https://app.example.com/path,not a url', 'development')).toEqual([
      'http://localhost:6130',
      'http://127.0.0.1:6130',
      'tauri://localhost',
      'starlight-micro://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
      'https://localhost',
      'asset://localhost',
    ]);
  });

  it('keeps desktop origins while only accepting validated explicit web origins in production', () => {
    expect(parseCorsAllowedOrigins('https://app.example.com,http://localhost:6130,tauri://localhost', 'production')).toEqual([
      'http://localhost:6130',
      'http://127.0.0.1:6130',
      'tauri://localhost',
      'starlight-micro://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
      'https://localhost',
      'asset://localhost',
      'https://app.example.com',
    ]);
  });
});
