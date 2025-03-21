import { GenericObject } from 'typings/index';
import { cloneDeep } from 'lodash';

export function handlerActionSchema(actions: Array<GenericObject>) {
  let result: {
    [name: string]: Array<GenericObject>;
  } = {};

  actions.forEach((action) => {
    Object.keys(action).forEach((key) => {
      if (result[key]) {
        result[key] = cloneDeep(result[key]).concat(action[key]);
      } else {
        result[key] = cloneDeep([action[key]]);
      }
    });
  });

  return result;
}
