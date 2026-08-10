import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('getUserInfo profile contract', () => {
  it('always returns onboarding completion using a versioned profile cache key', async () => {
    const source = await readFile(path.join(__dirname, '..', 'getUserInfo.ts'), 'utf8');

    expect(source).toContain('const cacheKey = `user:profile:${userId}:v2`;');
    expect(source).toContain(
      'safeUserInfo.isOnboardingCompleted = userInfo.isOnboardingCompleted ?? false;',
    );
    expect(source).not.toContain("ctx.meta?.appId === 'starlight'");
  });
});
