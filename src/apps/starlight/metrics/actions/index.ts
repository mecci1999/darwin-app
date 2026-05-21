import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import appkey from './appkey';
import ingest from './ingest';
import query from './query';
import realtime from './realtime';
import schema from './schema';
import topology from './topology';
import layout from './layout';

import { InfluxDBHandler } from '../utils/influxdb-handler';

const metricsActions = (star: Starlight) => {
  const ingestAction = ingest(star);
  const queryAction = query(star);
  const schemaAction = schema(star);
  const appkeyAction = appkey(star);
  const topologyAction = topology(star);
  const realtimeAction = realtime(star);
  const layoutAction = layout(star);

  return {
    ...ingestAction,
    ...queryAction,
    ...schemaAction,
    ...appkeyAction,
    ...topologyAction,
    ...realtimeAction,
    ...layoutAction,
  };
};

export default metricsActions;
