import { Star } from 'node-universe';
import { DataTypes, QueryInterface } from 'sequelize';
import { isTransportDebugEnabled } from 'config';
import { DatabaseService } from 'db/mysql/index';
import { Starlight } from 'typings';
import { registerDarwinLogForwarding } from '../logs/utils/darwin-log-capture';
import microAppActions from './actions';

const APP_NAME = 'micro-app';

const hasColumn = (columns: object, columnName: string) => Object.prototype.hasOwnProperty.call(columns, columnName);

const addColumnIfMissing = async (
  queryInterface: QueryInterface,
  tableName: string,
  columns: object,
  columnName: string,
  attribute: Parameters<QueryInterface['addColumn']>[2],
) => {
  if (hasColumn(columns, columnName)) return;
  await queryInterface.addColumn(tableName, columnName, attribute);
};

const ensureMicroAppSchema = async (star: Starlight) => {
  const connection = star.db.getConnection();
  if (!connection) throw new Error('micro-app database connection is not initialized');

  const queryInterface = connection.getQueryInterface();
  const microAppColumns = await queryInterface.describeTable('MicroApp');
  await addColumnIfMissing(queryInterface, 'MicroApp', microAppColumns, 'rollout_tenants', {
    type: DataTypes.TEXT,
    defaultValue: '[]',
  });
  await addColumnIfMissing(queryInterface, 'MicroApp', microAppColumns, 'rollout_percent', {
    type: DataTypes.INTEGER,
    defaultValue: 100,
  });
  await addColumnIfMissing(queryInterface, 'MicroApp', microAppColumns, 'release_channel', {
    type: DataTypes.ENUM('stable', 'beta', 'dev'),
    defaultValue: 'stable',
  });

  const microAppVersionColumns = await queryInterface.describeTable('MicroAppVersion');
  await addColumnIfMissing(queryInterface, 'MicroAppVersion', microAppVersionColumns, 'scan_report_json', {
    type: DataTypes.TEXT('long'),
  });
  await addColumnIfMissing(queryInterface, 'MicroAppVersion', microAppVersionColumns, 'previous_published_version', {
    type: DataTypes.STRING(64),
  });
};

async function initializeMicroAppService() {
  try {
    const star = new Star({
      namespace: 'darwin-app',
      nodeID: `${APP_NAME}-${process.env.NODE_ENV || 'development'}`,
      transporter: {
        type: 'KAFKA',
        debug: isTransportDebugEnabled(),
        host: process.env.KAFKA_HOST || 'localhost:9092',
        options: {
          sasl: {
            mechanism: 'plain',
            username: process.env.KAFKA_USER || 'darwin_app',
            password: process.env.KAFKA_PASSWORD || 'K@fk@_S3cur3_P@ssw0rd_2025!',
          },
          ssl: false,
        },
      },
      serializer: { type: 'NotePack' },
      logger: true,
      cacher: {
        type: 'Redis',
        clone: true,
        options: {
          redis: {
            port: parseInt(process.env.REDIS_PORT || '6379'),
            host: process.env.REDIS_HOST || 'localhost',
            password: process.env.REDIS_PASSWORD || 'R3d1s_S3cur3_P@ssw0rd_2024!@#',
          },
        },
      },
      metrics: { enabled: true, reporter: { type: 'Event' } },
      requestTimeout: 30 * 1000,
    }) as Starlight;

    registerDarwinLogForwarding(star);

    star.createService({
      name: APP_NAME,
      actions: microAppActions(star),
      created() {
        star.db = new DatabaseService(star, APP_NAME);
      },
      async started() {
        await star.db.simpleInitialize();
        await ensureMicroAppSchema(star);
        star.logger?.info('Micro-app service started successfully');
      },
      async stopped() {
        await star.db.cleanup();
      },
    });

    await star.start();
    star.logger?.info(`微服务 ${APP_NAME} 启动成功`);
  } catch (error) {
    console.error('Failed to initialize micro-app service:', error);
    process.exit(1);
  }
}

initializeMicroAppService().catch((error) => {
  console.error('Failed to initialize micro-app service:', error);
  process.exit(1);
});
