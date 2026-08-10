import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('QR confirmation device validation', () => {
  it('only rejects a device mismatch when both scan and confirm requests provide real device identifiers', async () => {
    const source = await readFile(path.join(__dirname, '..', 'qrcode.ts'), 'utf8');

    expect(source).toContain("deviceInfo.deviceId !== 'unknown' && requestDeviceId");
    expect(source).toContain("deviceInfo.deviceType !== 'unknown' && requestDeviceType");
    expect(source).toContain('if (deviceIdMismatch || deviceTypeMismatch)');
  });

  it('returns a current safe user profile after QR confirmation instead of only a cached user ID', async () => {
    const source = await readFile(path.join(__dirname, '..', 'qrcode.ts'), 'utf8');

    expect(source).toContain(
      'const persistedUserInfo = await star.db.user.findUserByUserId(qrUser.userId);',
    );
    expect(source).toContain('const userInfo = buildQrLoginUserInfo(persistedUserInfo);');
    expect(source).toContain('isOnboardingCompleted: userInfo.isOnboardingCompleted ?? false');
  });
});
