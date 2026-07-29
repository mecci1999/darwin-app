jest.mock(
  'config',
  () => ({
    MYSQL_DATABASE: 'test',
    MYSQL_HOST: 'localhost',
    MYSQL_PASSWORD: 'test',
    MYSQL_PORT: 3306,
    MYSQL_USER: 'test',
  }),
  { virtual: true },
);

import {
  createEmailRegistrationOperation,
  EmailRegistrationDatabase,
} from '../../src/db/mysql/apis/auth';
import { IEmailAuthAttributes } from '../../src/db/mysql/models/auth/emailAuth';
import { IUserTableAttributes } from '../../src/db/mysql/models/user';

interface FakeTransaction {
  users: IUserTableAttributes[];
  emailAuths: IEmailAuthAttributes[];
  releaseBootstrapLock?: () => void;
}

const createDatabase = (options: { failEmailInsert?: boolean } = {}) => {
  const users: IUserTableAttributes[] = [];
  const emailAuths: IEmailAuthAttributes[] = [];
  let lockTail = Promise.resolve();

  const database: EmailRegistrationDatabase<FakeTransaction> = {
    async transaction<T>(callback: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
      const transaction: FakeTransaction = { users: [], emailAuths: [] };
      try {
        const result = await callback(transaction);
        users.push(...transaction.users);
        emailAuths.push(...transaction.emailAuths);
        return result;
      } finally {
        transaction.releaseBootstrapLock?.();
      }
    },
    async lockAdminBootstrap(transaction: FakeTransaction): Promise<void> {
      const previousLock = lockTail;
      let releaseLock: () => void = () => undefined;
      lockTail = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      await previousLock;
      transaction.releaseBootstrapLock = releaseLock;
    },
    async findEmailAuth(email: string, transaction: FakeTransaction) {
      return [...emailAuths, ...transaction.emailAuths].find((emailAuth) => emailAuth.email === email) ?? null;
    },
    async countActiveAdmins(transaction: FakeTransaction) {
      return [...users, ...transaction.users].filter((user) => user.power === 999).length;
    },
    async createUser(user: IUserTableAttributes, transaction: FakeTransaction) {
      transaction.users.push(user);
    },
    async createEmailAuth(emailAuth: IEmailAuthAttributes, transaction: FakeTransaction) {
      if (options.failEmailInsert) {
        throw new Error('email insert failed');
      }
      transaction.emailAuths.push(emailAuth);
    },
  };

  return { database, emailAuths, users };
};

const registration = (userId: string, email: string) => ({
  userId,
  email,
  passwordHash: 'password-hash',
  salt: 'salt',
});

describe('registerEmailUser transaction', () => {
  it('makes the first registration an admin and leaves the second user unprivileged', async () => {
    const { database, users } = createDatabase();
    const register = createEmailRegistrationOperation(database);

    await expect(register(registration('first', 'first@example.com'), '')).resolves.toEqual({
      status: 'created',
      userId: 'first',
      power: 999,
    });
    await expect(register(registration('second', 'second@example.com'), '')).resolves.toEqual({
      status: 'created',
      userId: 'second',
      power: 0,
    });

    expect(users.map((user) => user.power)).toEqual([999, 0]);
  });

  it('grants admin to case-insensitive comma-separated allowlisted emails without promoting existing users', async () => {
    const { database, users } = createDatabase();
    const register = createEmailRegistrationOperation(database);

    await register(registration('first', 'member@example.com'), ' ADMIN@example.com , ');
    await expect(register(registration('admin', 'AdMiN@example.com'), ' ADMIN@example.com , ')).resolves.toEqual({
      status: 'created',
      userId: 'admin',
      power: 999,
    });

    expect(users.map((user) => ({ userId: user.userId, power: user.power }))).toEqual([
      { userId: 'first', power: 999 },
      { userId: 'admin', power: 999 },
    ]);
  });

  it('allows only one concurrent bootstrap claim', async () => {
    const { database, users } = createDatabase();
    const register = createEmailRegistrationOperation(database);

    const results = await Promise.all([
      register(registration('first', 'first@example.com'), ''),
      register(registration('second', 'second@example.com'), ''),
    ]);

    expect(results.filter((result) => result.status === 'created' && result.power === 999)).toHaveLength(1);
    expect(users.filter((user) => user.power === 999)).toHaveLength(1);
  });

  it('rolls back the user when email auth insertion fails', async () => {
    const { database, emailAuths, users } = createDatabase({ failEmailInsert: true });
    const register = createEmailRegistrationOperation(database);

    await expect(register(registration('user', 'user@example.com'), '')).rejects.toThrow('email insert failed');

    expect(users).toEqual([]);
    expect(emailAuths).toEqual([]);
  });

  it('returns email_exists without creating another user', async () => {
    const { database, emailAuths, users } = createDatabase();
    const register = createEmailRegistrationOperation(database);

    await register(registration('first', 'duplicate@example.com'), '');
    await expect(register(registration('second', 'duplicate@example.com'), '')).resolves.toEqual({
      status: 'email_exists',
    });

    expect(users).toHaveLength(1);
    expect(emailAuths).toHaveLength(1);
  });
});
