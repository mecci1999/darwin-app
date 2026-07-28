import { Sequelize } from 'sequelize';
import getModels from '../../src/db/mysql/models';
import { DataBaseTableNames } from '../../src/typings/enum';

describe('production database model registry', () => {
  it('registers every DatabaseService model key with its table definition', () => {
    const sequelize = new Sequelize('database', 'user', 'password', { dialect: 'mysql', logging: false });
    const modelKeys = Object.values(DataBaseTableNames);

    getModels(sequelize, modelKeys);

    expect(Object.keys(sequelize.models)).toEqual(expect.arrayContaining(modelKeys));
    expect(Object.keys(sequelize.models)).toHaveLength(modelKeys.length);
    for (const modelKey of modelKeys) {
      expect(sequelize.models[modelKey].getTableName()).toBeTruthy();
    }
  });
});
