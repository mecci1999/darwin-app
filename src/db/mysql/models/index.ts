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

    if ((file.endsWith('.ts') && !file.endsWith('.d.ts')) || (file.endsWith('.js') && !file.endsWith('.d.js'))) {
      // 统一处理模型文件
      const fileName = path.parse(file).name;
      const modelKey = fileName.endsWith('Table') ? fileName.replace('Table', '') : fileName;

      // 查找匹配的表名（忽略大小写）
      const matchedTable = tables.find((t) => t.toLowerCase() === modelKey.toLowerCase());

      if (matchedTable) {
        try {
          // 这里使用 path.join 可能导致 require 路径问题，应该使用 require 的相对路径或者绝对路径
          // 但是 require(fullPath) 在 ts-node 下通常是可以的
          // 关键问题是 importedModule 可能是 default export 也可能是 named export
          const importedModule = require(fullPath);
          const modelInit = importedModule.default || importedModule;
          
          if (typeof modelInit === 'function') {
             models[matchedTable] = modelInit(sequelize);
          } else {
             console.error(`Model ${file} does not export a default initialization function`);
          }
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
