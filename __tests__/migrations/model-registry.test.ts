import { Sequelize } from 'sequelize';
import getModels from '../../src/db/mysql/models';
import { DataBaseTableNames } from '../../src/typings/enum';

const getIndexFieldName = (field: unknown) => {
  if (typeof field === 'string') {
    return field;
  }

  if (field && typeof field === 'object') {
    if ('name' in field && typeof field.name === 'string') {
      return field.name;
    }

    if ('attribute' in field && typeof field.attribute === 'string') {
      return field.attribute;
    }
  }

  return undefined;
};

describe('production database model registry', () => {
  it('registers every DatabaseService model key with its table definition', () => {
    const sequelize = new Sequelize('database', 'user', 'password', {
      dialect: 'mysql',
      logging: false,
      define: { underscored: true },
    });
    const modelKeys = Object.values(DataBaseTableNames);

    getModels(sequelize, modelKeys);

    expect(Object.keys(sequelize.models)).toEqual(expect.arrayContaining(modelKeys));
    expect(Object.keys(sequelize.models)).toHaveLength(modelKeys.length);
    for (const modelKey of modelKeys) {
      expect(sequelize.models[modelKey].getTableName()).toBeTruthy();
    }
  });

  it('uses physical model columns in every production index', () => {
    const sequelize = new Sequelize('database', 'user', 'password', {
      dialect: 'mysql',
      logging: false,
      define: { underscored: true },
    });
    const modelKeys = Object.values(DataBaseTableNames);

    getModels(sequelize, modelKeys);

    for (const modelKey of modelKeys) {
      const model = sequelize.models[modelKey];
      const physicalColumns = new Set(Object.values(model.getAttributes()).map(attribute => attribute.field));

      for (const index of model.options.indexes ?? []) {
        for (const field of index.fields ?? []) {
          const column = getIndexFieldName(field);
          expect(column).toBeDefined();
          expect(physicalColumns).toContain(column);
        }
      }
    }
  });

  it('uses snake_case physical timestamp columns in every production model', () => {
    const sequelize = new Sequelize('database', 'user', 'password', {
      dialect: 'mysql',
      logging: false,
      define: { underscored: true },
    });
    const modelKeys = Object.values(DataBaseTableNames);

    getModels(sequelize, modelKeys);

    for (const modelKey of modelKeys) {
      const attributes = sequelize.models[modelKey].getAttributes();

      if (attributes.createdAt) {
        expect(attributes.createdAt.field).toBe('created_at');
      }
      if (attributes.updatedAt) {
        expect(attributes.updatedAt.field).toBe('updated_at');
      }
      if (attributes.deletedAt) {
        expect(attributes.deletedAt.field).toBe('deleted_at');
      }
    }
  });
});
