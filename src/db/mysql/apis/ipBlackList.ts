import _ from "lodash";
import { DataBaseTableNames, IPAddressBanStatus } from "typings/enum";
import { mainConnection } from "..";
import {
  IIPBlackListTableAttributes,
  IPBlackListTable,
} from "../models/ipBlackList";

/**
 * 批量新增ip地址黑名单
 */
export async function saveOrUpdateIpBlackList(
  ipList: IIPBlackListTableAttributes[],
) {
  const model = await mainConnection.getModel<IPBlackListTable>(
    DataBaseTableNames.IPBlackList,
  );

  // 先尝试找到所有已存在的ip
  const saveList = ipList.map((ip) => ip?.ipv4 || ip?.ipv6);
  const list = _.compact(saveList);
  const existingIPs = await queryIpBlackList(list);

  const existingMap = new Map(
    existingIPs.map((ec) => [ec?.ipv4 || ec?.ipv6, ec]),
  );

  const toCreate: IIPBlackListTableAttributes[] = [];
  const toUpdate: IIPBlackListTableAttributes[] = [];

  // 分类处理：需要创建的和需要更新的
  for (const address of ipList) {
    if (existingMap.has(address?.ipv4 || address?.ipv6 || "")) {
      toUpdate.push(address);
    } else {
      toCreate.push(address);
    }
  }

  // 批量创建不存在的配置
  if (toCreate.length) {
    await model.bulkCreate(toCreate, {
      updateOnDuplicate: ["ipv4", "ipv6", "reason", "status", "isArtificial"],
    });
  }

  // 更新已存在的配置
  for (const address of toUpdate) {
    const existingIP = existingMap.get(address?.ipv4 || address?.ipv6 || "");
    if (existingIP) {
      await existingIP.update({
        reason: address?.reason || "",
        status: address?.status || IPAddressBanStatus.active,
      });
    }
  }

  return ipList;
}

/**
 * 获取所有的配置项
 */
export async function getAllIpBlackList() {
  const model = await mainConnection.getModel<IPBlackListTable>(
    DataBaseTableNames.IPBlackList,
  );

  return model
    .findAll({
      attributes: ["id", "ipv4", "ipv6", "reason", "status", "isArtificial"],
    })
    .then((res) => {
      if (res) {
        return res.map((item) => {
          return item.toJSON();
        });
      } else {
        return [];
      }
    });
}

/**
 * 查询某些配置项，根据ipv4地址或ipv6地址
 */
export async function queryIpBlackList(ipList: string[]) {
  const model = await mainConnection.getModel<IPBlackListTable>(
    DataBaseTableNames.IPBlackList,
  );

  return await model.findAll({
    where: {
      [mainConnection.Sequelize.Op.or]: [
        {
          ipv4: {
            [mainConnection.Sequelize.Op.in]: ipList,
          },
        },
        {
          ipv6: {
            [mainConnection.Sequelize.Op.in]: ipList,
          },
        },
      ],
    },
    raw: true,
  });
}

/**
 * 批量删除黑名单根据id
 */
export async function deleteConfigs(ids: string[]) {
  const model = await mainConnection.getModel<IPBlackListTable>(
    DataBaseTableNames.IPBlackList,
  );

  await model.destroy({
    where: {
      id: ids,
    },
  });

  return true;
}
