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
  // 从根目录和auth目录加载
  const rootModels = loadModelsRecursive(__dirname, sequelize, tables);
  const authModels = loadModelsRecursive(path.join(__dirname, 'auth'), sequelize, tables);

  return {
    ...rootModels,
    ...authModels,
  };
}
