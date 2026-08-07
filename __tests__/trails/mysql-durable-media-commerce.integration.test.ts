import { Sequelize } from 'sequelize';

const enabled = process.env.TRAILS_MYSQL_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration('durable media commerce MySQL schema', () => {
  let sequelize: Sequelize;
  beforeAll(async () => {
    sequelize = new Sequelize('darwin_trails_it', 'darwin_trails_it', 'darwin_trails_it', { host: '127.0.0.1', port: 3308, dialect: 'mysql', logging: false });
    await sequelize.authenticate();
    await require('../../scripts/migrations').applyTrailsCategoryMigrations(sequelize);
  });
  afterAll(async () => { await sequelize.close(); });
  it('creates indexed commerce and mutation tables in the disposable database', async () => {
    const query = sequelize.getQueryInterface();
    const tables = await query.showAllTables();
    expect(tables.map(String)).toEqual(expect.arrayContaining(['TrailsDurableMediaCommerce', 'TrailsDurableMediaCommerceMutation']));
    const indexes = await query.showIndex('TrailsDurableMediaCommerce') as Array<{ name: string }>;
    expect(indexes.map(index => index.name)).toEqual(expect.arrayContaining(['trails_commerce_owner_type_status', 'trails_commerce_buyer_type']));
  });
});
