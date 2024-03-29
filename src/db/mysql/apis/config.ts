import { DataBaseTableNames } from "typings/enum";
import { mainConnection } from "..";
import { IConfigTableAttributes, ConfigTable } from "../models/config";
import { ConfigKeysMap, IConfig } from "typings/config";

/**
 * 批量新增配置项
 */
export async function saveOrUpdateConfigs(configs: IConfig[]) {
  const model = await mainConnection.getModel<ConfigTable>(
    DataBaseTableNames.Config,
  );

  // 先尝试找到所有已存在的记录
  const existingKeys = configs.map((config) => config.key);
  const existingConfigs = await model.findAll({
    where: {
      key: existingKeys,
    },
  });

  const existingMap = new Map(existingConfigs.map((ec) => [ec.key, ec]));

  const toCreate: IConfig[] = [];
  const toUpdate: IConfig[] = [];

  // 分类处理：需要创建的和需要更新的
  for (const config of configs) {
    if (existingMap.has(config.key)) {
      toUpdate.push(config);
    } else {
      toCreate.push({
        key: config.key,
        value: config.value,
      });
    }
  }

  // 批量创建不存在的配置
  if (toCreate.length) {
    await model.bulkCreate(toCreate, { updateOnDuplicate: ["value"] });
  }

  // 更新已存在的配置
  for (const config of toUpdate) {
    const existingConfig = existingMap.get(config.key);
    if (existingConfig) {
      await existingConfig.update({ value: config.value });
    }
  }

  return configs;
}

/**
 * 获取所有的配置项
 */
export async function getAllConfigList() {
  const model = await mainConnection.getModel<ConfigTable>(
    DataBaseTableNames.Config,
  );

  return model.findAll({ attributes: ["key", "value"] }).then((res) => {
    if (res) {
      return res.map((item) => {
        return item.toJSON();
      });
    }
  });
}

/**
 * 查询某些配置项
 */
export async function queryConfigs(keys: ConfigKeysMap[] | string[]) {
  const model = await mainConnection.getModel<ConfigTable>(
    DataBaseTableNames.Config,
  );

  return await model.findAll({
    where: {
      key: {
        [mainConnection.Sequelize.Op.in]: keys,
      },
    },
    raw: true,
  });
}

/**
 * 批量删除配置项
 */
export async function deleteConfigs(keys: ConfigKeysMap[] | string[]) {
  const model = await mainConnection.getModel<ConfigTable>(
    DataBaseTableNames.Config,
  );

  await model.destroy({
    where: {
      key: keys,
    },
  });

  return true;
}
