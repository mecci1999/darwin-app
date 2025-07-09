import * as fs from 'fs';
import * as path from 'path';
import { Sequelize } from 'sequelize';

// 递归加载模型文件的帮助函数
const loadModelsRecursive = (
  directoryPath: string,
  sequelize: Sequelize,
  tables: string[],
): Record<string, any> => {
  const models: Record<string, any> = {};

  // 检查目录是否存在
  if (!fs.existsSync(directoryPath)) {
    return models;
  }

  fs.readdirSync(directoryPath).forEach((file) => {
    const fullPath = path.join(directoryPath, file);
    // const stat = fs.statSync(fullPath);

    if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      // 统一处理模型文件
      const fileName = path.parse(file).name;
      const modelKey = fileName.endsWith('Table') ? fileName.replace('Table', '') : fileName;

      if (tables.includes(modelKey)) {
        try {
          const importedModule = require(fullPath).default;
          models[modelKey] = importedModule(sequelize);
        } catch (e) {
          console.error(`Error loading model ${file}:`, e);
        }
      }
    }
  });

  return models;
};

export default function (sequelize: Sequelize, tables: string[]) {
  // 从根目录和各个子目录加载其他模型
  const rootModels = loadModelsRecursive(__dirname, sequelize, tables);
  const authModels = loadModelsRecursive(path.join(__dirname, 'auth'), sequelize, tables);
  const subscriptionModels = loadModelsRecursive(
    path.join(__dirname, 'subscription'),
    sequelize,
    tables,
  );
  const quotaModels = loadModelsRecursive(path.join(__dirname, 'quota'), sequelize, tables);
  const apiModels = loadModelsRecursive(path.join(__dirname, 'api'), sequelize, tables);
  const paymentModels = loadModelsRecursive(path.join(__dirname, 'payment'), sequelize, tables);
  const billingModels = loadModelsRecursive(path.join(__dirname, 'billing'), sequelize, tables);

  return {
    ...rootModels,
    ...authModels,
    ...subscriptionModels,
    ...quotaModels,
    ...apiModels,
    ...paymentModels,
    ...billingModels,
  };
}
