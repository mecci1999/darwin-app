import batchIngest from './batch-ingest';
import ingest from './ingest';
import readModel from './read-model';
import search from './search';
import stats from './stats';
import exportLogs from './export';
import exceptionAnalysis from './exception-analysis';
import captureDarwin from './capture-darwin';
// import trends from './trends';
// import reports from './reports';
// import exportStatus from './export-status';
import { Starlight } from 'typings';
import stream from './stream';
// import streamManagement from './stream-management';
// import apiKeys from './api-keys';
// import apiKeyValidation from './api-key-validation';
// import quotas from './quotas';
// import quotaAlerts from './quota-alerts';
// import system from './system';
// import health from './health';
// import elasticsearch from './elasticsearch';
// import indices from './indices';
// import alerts from './alerts';
// import alertRules from './alert-rules';
// import dashboards from './dashboards';
// import widgets from './widgets';

/**
 * 日志微服务的动作
 */
const logsAction = (star: Starlight) => {
  const ingestAction = ingest(star);
  const batchIngestAction = batchIngest(star);
  const readModelAction = readModel(star);
  const searchAction = search(star);
  const statsAction = stats(star);
  const exportAction = exportLogs(star);
  const exceptionAnalysisAction = exceptionAnalysis(star);
  const captureDarwinAction = captureDarwin(star);
  // const trendsAction = trends(star);
  // const reportsAction = reports(star);
  // const exportStatusAction = exportStatus(star);
  const streamAction = stream(star);
  // const streamManagementAction = streamManagement(star);
  // const apiKeysAction = apiKeys(star);
  // const apiKeyValidationAction = apiKeyValidation(star);
  // const quotasAction = quotas(star);
  // const quotaAlertsAction = quotaAlerts(star);
  // const systemAction = system(star);
  // const healthAction = health(star);
  // const elasticsearchAction = elasticsearch(star);
  // const indicesAction = indices(star);
  // const alertsAction = alerts(star);
  // const alertRulesAction = alertRules(star);
  // const dashboardsAction = dashboards(star);
  // const widgetsAction = widgets(star);

  return {
    ...ingestAction,
    ...batchIngestAction,
    ...readModelAction,
    ...searchAction,
    ...statsAction,
    ...exportAction,
    ...exceptionAnalysisAction,
    ...captureDarwinAction,
    // ...trendsAction,
    // ...reportsAction,
    // ...exportStatusAction,
    ...streamAction,
    // ...streamManagementAction,
    // ...apiKeysAction,
    // ...apiKeyValidationAction,
    // ...quotasAction,
    // ...quotaAlertsAction,
    // ...systemAction,
    // ...healthAction,
    // ...elasticsearchAction,
    // ...indicesAction,
    // ...alertsAction,
    // ...alertRulesAction,
    // ...dashboardsAction,
    // ...widgetsAction,
  };
};

export default logsAction;
