import { Sequelize } from "sequelize";
import { UserTable } from "./user";
import * as fs from "fs";
import * as path from "path";

export interface IDatabaseTables {
  user?: UserTable;
}

export default function (
  sequelize: Sequelize,
  tables: string[],
): IDatabaseTables {
  const models: IDatabaseTables = {};

  // 获取当前文件所在目录的绝对路径
  const directoryPath = path.join(__dirname);

  // 遍历目录下的文件
  fs.readdirSync(directoryPath).forEach((file) => {
    // 只处理以 `.ts` 结尾的文件
    if (file.endsWith(".ts")) {
      const fileName = path.parse(file).name;
      if (tables.includes(fileName)) {
        try {
          // 动态导入模块并执行 default 方法
          const importedModule = require(path.join(__dirname, file)).default;
          models[fileName] = importedModule(sequelize);
        } catch (e) {
          // 处理错误
        }
      }
    }
  });

  return models;
}
