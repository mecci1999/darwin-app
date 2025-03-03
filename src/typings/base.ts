/**
 * 动作文件的定义
 */
export interface ServiceActionSchema {
  name: string;
  action: GenericObject;
}

export interface GenericObject {
  [name: string]: any;
}
