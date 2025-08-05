import { ConfigKeysMap } from './enum';

export interface IConfig {
  key: string | ConfigKeysMap;
  value: any;
}
