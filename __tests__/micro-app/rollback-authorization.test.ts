import microAppActions from '../../src/apps/starlight/micro-app/actions';

type VersionStatus = 'pending_review' | 'approved' | 'rejected' | 'published';

const appId = 'starlight-trails-workspace';
const adminContext = (targetVersion: string) => ({
  params: { appId, targetVersion },
  meta: { tenantId: 'tenant-1', user: { userId: 'admin-1', isAdmin: true } },
});

const createActions = (targetVersion: string, initialStatus: VersionStatus) => {
  const version = {
    appId,
    version: targetVersion,
    status: initialStatus,
    manifestJson: JSON.stringify({ appId, version: targetVersion }),
    packageSha256: 'package-hash',
  };
  const updateMicroAppVersionStatus = jest.fn(async (_appId: string, _version: string, status: VersionStatus, details: { publishedAt: Date }) => {
    version.status = status;
    return { ...version, ...details };
  });
  const createMicroAppAuditLog = jest.fn(async () => undefined);
  const star = {
    db: {
      microApp: {
        findMicroAppVersion: jest.fn(async () => ({ ...version })),
        findLatestPublishedVersion: jest.fn(async () => ({ ...version })),
        updateMicroAppVersionStatus,
        createMicroAppAuditLog,
      },
    },
  };
  return { actions: microAppActions(star as never), version, updateMicroAppVersionStatus, createMicroAppAuditLog };
};

describe('micro-app rollback authorization', () => {
  const originalSecret = process.env.MICRO_APP_TICKET_SECRET;

  beforeEach(() => {
    process.env.MICRO_APP_TICKET_SECRET = 'rollback-test-secret';
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.MICRO_APP_TICKET_SECRET;
    else process.env.MICRO_APP_TICKET_SECRET = originalSecret;
  });

  it.each<VersionStatus>(['pending_review', 'rejected'])('does not republish a %s target or write a rollback audit entry', async (initialStatus) => {
    const fixture = createActions('1.0.0', initialStatus);

    const response = await fixture.actions['v1.rollback'].handler(adminContext('1.0.0') as never);

    expect(response.data.success).toBe(false);
    expect(fixture.version.status).toBe(initialStatus);
    expect(fixture.updateMicroAppVersionStatus).not.toHaveBeenCalled();
    expect(fixture.createMicroAppAuditLog).not.toHaveBeenCalled();
  });

  it('does not publish an approved but ungranted Trails Workspace target', async () => {
    const fixture = createActions('2.0.0', 'approved');

    const response = await fixture.actions['v1.rollback'].handler(adminContext('2.0.0') as never);

    expect(response.status).toBe(403);
    expect(response.data.success).toBe(false);
    expect(fixture.version.status).toBe('approved');
    expect(fixture.updateMicroAppVersionStatus).not.toHaveBeenCalled();
    expect(fixture.createMicroAppAuditLog).not.toHaveBeenCalled();
  });

  it.each<VersionStatus>(['approved', 'published'])('preserves normal rollback for an authorized %s target', async (initialStatus) => {
    const fixture = createActions('1.0.0', initialStatus);

    const response = await fixture.actions['v1.rollback'].handler(adminContext('1.0.0') as never);

    expect(response.data.success).toBe(true);
    expect(fixture.version.status).toBe('published');
    expect(fixture.updateMicroAppVersionStatus).toHaveBeenCalledWith(appId, '1.0.0', 'published', { publishedAt: expect.any(Date) });
    expect(fixture.createMicroAppAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'rollback', appId, version: '1.0.0', afterStatus: 'published' }));
  });
});
