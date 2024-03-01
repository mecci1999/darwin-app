import { Sequelize } from "sequelize";
import { UserTable } from "./user";

export interface IDatabaseTables {
  user?: UserTable;
}

export default function (
  sequelize: Sequelize,
  tables: string[],
): IDatabaseTables {
  const models: any = {};

  // @ts-ignore
  const context = require.context(".", false, /\.ts$/, "sync");
  const files = context.keys();
  for (let i = 0, len = files.length; i < len; i++) {
    const match = files[i].match(/[\/\\](.*)\.[tj]s$/);
    if (match && match[1]) {
      if (tables.includes(match[1])) {
        try {
          models[match[1]] = context(files[i]).default(sequelize);
        } catch (e) {
          //
        }
      }
    }
  }

  return models;
}
