jest.mock('../../src/core/user/utils', () => ({
  EventHandler: {
    getInstance: () => ({
      publishUserUpdated: jest.fn(),
    }),
  },
  ValidationHandler: {},
}));

jest.mock(
  'core/file/types',
  () => ({
    FileCategory: { AVATAR: 'avatar' },
  }),
  { virtual: true },
);

import updateUser from '../../src/core/user/actions/updateUser';
import uploadAvatar from '../../src/core/user/actions/uploadAvatar';

const currentUser = {
  userId: 'user-1',
  nickname: '原昵称',
  avatar: 'https://cdn.starlight.host/avatars/old.webp',
  status: 'active',
  source: 'email',
  version: 4,
};

const createStar = () => {
  const cacher = { delete: jest.fn().mockResolvedValue(undefined) };
  const db = {
    user: {
      findUserByUserId: jest.fn().mockResolvedValue(currentUser),
      saveOrUpdateUsers: jest.fn().mockImplementation(async (users) => users),
    },
  };
  return {
    cacher,
    db,
    call: jest.fn().mockResolvedValue({
      status: 200,
      data: {
        success: true,
        content: {
          fileId: 'avatar-file-1',
          url: 'https://cdn.starlight.host/avatars/new.webp',
        },
      },
    }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
};

describe('user profile cache invalidation', () => {
  it('invalidates the cached profile after general profile updates', async () => {
    const star = createStar();
    const result = await updateUser(star as any)['v1.update'].handler({
      params: { userId: currentUser.userId, nickname: '新昵称' },
    } as any);

    expect(result.status).toBe(200);
    expect(star.cacher.delete).toHaveBeenCalledWith(`user:profile:${currentUser.userId}:v2`);
  });

  it('invalidates the cached profile after the legacy avatar upload action', async () => {
    const star = createStar();
    const result = await uploadAvatar(star as any)['v1.uploadAvatar'].handler({
      params: {
        userId: currentUser.userId,
        filename: 'user-1-avatar.webp',
        mimetype: 'image/webp',
        file: 'YXY=',
      },
    } as any);

    expect(result.status).toBe(200);
    expect(star.cacher.delete).toHaveBeenCalledWith(`user:profile:${currentUser.userId}:v2`);
  });

  it('keeps a completed update successful when the cache is temporarily unavailable', async () => {
    const star = createStar();
    star.cacher.delete.mockRejectedValueOnce(new Error('Redis unavailable'));

    const result = await updateUser(star as any)['v1.update'].handler({
      params: { userId: currentUser.userId, nickname: '新昵称' },
    } as any);

    expect(result.status).toBe(200);
    expect(star.logger.warn).toHaveBeenCalledWith(
      '用户资料缓存失效失败',
      expect.objectContaining({ userId: currentUser.userId }),
    );
  });
});
