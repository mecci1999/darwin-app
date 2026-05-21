import { Context } from 'node-universe';
import { HttpResponseCode, HttpResponseItem, Starlight } from 'typings';
import { queryAllUsers } from 'db/mysql/apis/user';
import { normalizeMetricsScope } from '../utils/system-telemetry';

const ALERT_STATE_PREFIX = 'metrics:alerts:state:';
const ALERT_NOTIFICATION_PREFIX = 'metrics:alerts:notification:';
const ALERT_RULE_PREFIX = 'metrics:alerts:rule:';

const levelFromHealth = (health: string) => {
  if (health === 'critical' || health === 'unhealthy') return 'critical';
  if (health === 'degraded' || health === 'warning') return 'warning';
  return 'info';
};

const statusFromHealth = (health: string) => {
  if (health === 'healthy') return 'resolved';
  if (health === 'critical' || health === 'unhealthy') return 'active';
  return 'suppressed';
};

const redisGetJson = async (serviceContext: any, key: string) => {
  try {
    const raw = await serviceContext.redis?.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const redisSetJson = async (serviceContext: any, key: string, value: any) => {
  try {
    await serviceContext.redis?.set(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const redisDelete = async (serviceContext: any, key: string) => {
  try {
    await serviceContext.redis?.del(key);
    return true;
  } catch {
    return false;
  }
};

const loadAlertState = async (serviceContext: any, alertId: string) => {
  return redisGetJson(serviceContext, `${ALERT_STATE_PREFIX}${alertId}`);
};

const saveAlertState = async (serviceContext: any, alertId: string, payload: any) => {
  return redisSetJson(serviceContext, `${ALERT_STATE_PREFIX}${alertId}`, payload);
};

const loadNotificationState = async (serviceContext: any, notificationId: string) => {
  return redisGetJson(serviceContext, `${ALERT_NOTIFICATION_PREFIX}${notificationId}`);
};

const saveNotificationState = async (serviceContext: any, notificationId: string, payload: any) => {
  return redisSetJson(serviceContext, `${ALERT_NOTIFICATION_PREFIX}${notificationId}`, payload);
};

const loadAlertRules = async (serviceContext: any) => {
  const keys = (await serviceContext.redis?.keys(`${ALERT_RULE_PREFIX}*`)) || [];
  const values = await Promise.all(keys.map((key: string) => redisGetJson(serviceContext, key)));
  return values.filter(Boolean);
};

const saveAlertRule = async (serviceContext: any, rule: any) => {
  return redisSetJson(serviceContext, `${ALERT_RULE_PREFIX}${rule.id}`, rule);
};

const normalizeImportedRule = (rule: any) => ({
  id: rule.id || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: rule.name || '未命名规则',
  service: rule.service || 'all',
  metric: rule.metric || '错误率',
  operator: rule.operator || '>',
  threshold: Number(rule.threshold || 0),
  unit: rule.unit || '',
  duration: Number(rule.duration || 5),
  level: rule.level || 'warning',
  enabled: rule.enabled !== false,
  channels: Array.isArray(rule.channels)
    ? rule.channels
    : Array.isArray(rule.notificationChannels)
      ? rule.notificationChannels
      : ['Email'],
  updatedAt: Date.now(),
});

export const buildAlerts = async (serviceContext: any, params: any) => {
  const scope = normalizeMetricsScope(params?.scope);
  const servicesResult = await serviceContext.getServicesList({
    page: 1,
    pageSize: 200,
    keyword: params?.keyword,
    scope,
  });
  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
  const startTime = params?.startTime ? Number(params.startTime) : null;
  const endTime = params?.endTime ? Number(params.endTime) : null;

  const alerts = await Promise.all(
    services
      .filter((service: any) => service.health !== 'healthy' || Number(service.errorRate || 0) > 0)
      .slice(0, 50)
      .map(async (service: any) => {
        const id = `alert-${service.id}`;
        const stored = await loadAlertState(serviceContext, id);
        const time = stored?.updatedAt
          ? new Date(stored.updatedAt).toISOString()
          : new Date().toISOString();
        return {
          id,
          time,
          serviceId: service.id,
          service: service.name,
          level: levelFromHealth(service.health),
          message: `服务 ${service.name} 当前错误率 ${Number(service.errorRate || 0).toFixed(2)}%，延迟 ${Math.round(Number(service.latency || 0))}ms`,
          status: stored?.status || statusFromHealth(service.health),
          duration: '5m',
          assigneeUserId: stored?.assigneeUserId || '',
          assigneeName: stored?.assigneeName || '',
        };
      }),
  );

  return alerts.filter((alert: any) => {
    const timestamp = new Date(alert.time).getTime();
    if (params?.serviceId && alert.serviceId !== params.serviceId) return false;
    if (params?.level && alert.level !== params.level) return false;
    if (params?.status && alert.status !== params.status) return false;
    if (params?.assigneeUserId && alert.assigneeUserId !== params.assigneeUserId) return false;
    if (startTime && timestamp < startTime) return false;
    if (endTime && timestamp > endTime) return false;
    return true;
  });
};

const buildAlertAssignees = async () => {
  const users = (await queryAllUsers()) || [];
  return users.map((user: any) => ({
    userId: user.userId,
    nickname: user.nickname || user.userId,
    isAdmin: user.power === 999,
  }));
};

const buildAlertRules = async (serviceContext: any, params: any) => {
  const scope = normalizeMetricsScope(params?.scope);
  const servicesResult = await serviceContext.getServicesList({ page: 1, pageSize: 20, scope });
  const services = Array.isArray(servicesResult?.services) ? servicesResult.services : [];
  const existingRules = await loadAlertRules(serviceContext);

  if (existingRules.length === 0) {
    await Promise.all(
      services.slice(0, 5).map((service: any, index: number) =>
        saveAlertRule(serviceContext, {
          id: `rule-${index + 1}`,
          name: `${service.name} 错误率告警`,
          service: service.id,
          metric: '错误率',
          operator: '>',
          threshold: 5,
          unit: '%',
          duration: 5,
          level:
            service.health === 'critical' || service.health === 'unhealthy'
              ? 'critical'
              : 'warning',
          enabled: true,
          channels: ['Email', 'Webhook'],
          updatedAt: Date.now(),
        }),
      ),
    );
  }

  const rules = (await loadAlertRules(serviceContext)) || [];
  const startTime = params?.startTime ? Number(params.startTime) : null;
  const endTime = params?.endTime ? Number(params.endTime) : null;
  return rules.filter((rule: any) => {
    if (params?.serviceId && rule.service !== params.serviceId) return false;
    if (startTime && Number(rule.updatedAt || 0) < startTime) return false;
    if (endTime && Number(rule.updatedAt || 0) > endTime) return false;
    return true;
  });
};

const buildNotifications = async (serviceContext: any, params: any) => {
  const alerts = await buildAlerts(serviceContext, params || {});
  return Promise.all(
    alerts.slice(0, 20).map(async (alert: any, index: number) => {
      const id = `notification-${index + 1}`;
      const stored = await loadNotificationState(serviceContext, id);
      return {
        id,
        type: alert.level,
        channel: index % 2 === 0 ? 'email' : 'webhook',
        status: stored?.status || (alert.status === 'active' ? 'sent' : 'delivered'),
        target: index % 2 === 0 ? 'ops@starlight.local' : 'https://hooks.starlight.local/alerts',
        content: alert.message,
        sentAt: stored?.updatedAt ? new Date(stored.updatedAt).toISOString() : alert.time,
        serviceId: alert.serviceId,
        service: alert.service,
      };
    }),
  );
};

const alerts = (star: Starlight) => ({
  'v1.alerts': {
    metadata: { auth: true },
    params: {
      level: { type: 'string', optional: true },
      status: { type: 'string', optional: true },
      serviceId: { type: 'string', optional: true },
      assigneeUserId: { type: 'string', optional: true },
      scope: { type: 'string', optional: true },
      keyword: { type: 'string', optional: true },
      startTime: { type: 'number', optional: true },
      endTime: { type: 'number', optional: true },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        const content = await buildAlerts(this as any, ctx.params || {});
        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取告警列表成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get alerts failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取告警列表失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.alerts/assignees': {
    metadata: { auth: true },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        const content = await buildAlertAssignees();
        const fallbackUserId = (ctx.meta as any)?.user?.userId || '';
        const fallbackNickname = (ctx.meta as any)?.user?.nickname || fallbackUserId;
        const finalContent =
          content.length > 0
            ? content
            : fallbackUserId
              ? [
                  {
                    userId: fallbackUserId,
                    nickname: fallbackNickname,
                    isAdmin: Boolean((ctx.meta as any)?.user?.isAdmin),
                  },
                ]
              : [];
        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content: finalContent,
            message: '获取告警指派人成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get alert assignees failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取告警指派人失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.alert-rules': {
    metadata: { auth: true },
    params: {
      serviceId: { type: 'string', optional: true },
      scope: { type: 'string', optional: true },
      startTime: { type: 'number', optional: true },
      endTime: { type: 'number', optional: true },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        const content = await buildAlertRules(this as any, ctx.params || {});
        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取告警规则成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get alert rules failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取告警规则失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.alert-rules/create': {
    metadata: { auth: true },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const payload = { ...(ctx.params || {}), id: `rule-${Date.now()}`, updatedAt: Date.now() };
      const success = await saveAlertRule(this as any, payload);
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '创建告警规则失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: payload,
          message: '创建告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.alert-rules/bulk-update': {
    metadata: { auth: true },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const { ids = [], enabled } = (ctx.params || {}) as { ids?: string[]; enabled: boolean };
      const updated: any[] = [];

      for (const id of ids) {
        const key = `${ALERT_RULE_PREFIX}${id}`;
        const prev = (await redisGetJson(this as any, key)) || {};
        const next = { ...prev, enabled, updatedAt: Date.now() };
        const success = await saveAlertRule(this as any, next);
        if (success) updated.push(next);
      }

      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: updated,
          message: '批量更新告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.alert-rules/export': {
    metadata: { auth: true },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const rules = await buildAlertRules(this as any, ctx.params || {});
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: { rules, exportedAt: new Date().toISOString() },
          message: '导出告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.alert-rules/import': {
    metadata: { auth: true },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const rules = Array.isArray((ctx.params as any)?.rules) ? (ctx.params as any).rules : [];
      const imported: any[] = [];
      for (const rule of rules) {
        const normalized = normalizeImportedRule(rule);
        const success = await saveAlertRule(this as any, normalized);
        if (success) imported.push(normalized);
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: imported,
          message: '导入告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.alert-rules/:id': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const key = `${ALERT_RULE_PREFIX}${ctx.params.id}`;
      const prev = (await redisGetJson(this as any, key)) || {};
      const next = { ...prev, ...(ctx.params || {}), updatedAt: Date.now() };
      const success = await saveAlertRule(this as any, next);
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '更新告警规则失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: next,
          message: '更新告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.alert-rules/:id/delete': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const success = await redisDelete(this as any, `${ALERT_RULE_PREFIX}${ctx.params.id}`);
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '删除告警规则失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: { success: true, id: ctx.params.id },
          message: '删除告警规则成功',
          success: true,
        },
      };
    },
  },
  'v1.notifications': {
    metadata: { auth: true },
    params: {
      keyword: { type: 'string', optional: true },
      channel: { type: 'string', optional: true },
      status: { type: 'string', optional: true },
      serviceId: { type: 'string', optional: true },
      scope: { type: 'string', optional: true },
      startTime: { type: 'number', optional: true },
      endTime: { type: 'number', optional: true },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      try {
        const content = await buildNotifications(this as any, ctx.params || {});
        return {
          status: 200,
          data: {
            code: HttpResponseCode.Success,
            content,
            message: '获取通知列表成功',
            success: true,
          },
        };
      } catch (error) {
        star.logger?.error('Get notifications failed:', error);
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '获取通知列表失败',
            success: false,
          },
        };
      }
    },
  },
  'v1.alerts/:id/resolve': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const prev = (await loadAlertState(this as any, ctx.params.id)) || {};
      const success = await saveAlertState(this as any, ctx.params.id, {
        ...prev,
        status: 'resolved',
        updatedAt: Date.now(),
      });
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '告警状态更新失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: { success: true, id: ctx.params.id, status: 'resolved' },
          message: '告警已标记为已解决',
          success: true,
        },
      };
    },
  },
  'v1.alerts/:id/suppress': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const prev = (await loadAlertState(this as any, ctx.params.id)) || {};
      const success = await saveAlertState(this as any, ctx.params.id, {
        ...prev,
        status: 'suppressed',
        updatedAt: Date.now(),
      });
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '告警状态更新失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: { success: true, id: ctx.params.id, status: 'suppressed' },
          message: '告警已静默',
          success: true,
        },
      };
    },
  },
  'v1.alerts/:id/assign': {
    metadata: { auth: true },
    params: {
      id: { type: 'string', required: true },
      assigneeUserId: { type: 'string', optional: true },
      assigneeName: { type: 'string', optional: true },
    },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const prev = (await loadAlertState(this as any, ctx.params.id)) || {};
      const next = {
        ...prev,
        assigneeUserId: ctx.params.assigneeUserId || '',
        assigneeName: ctx.params.assigneeName || '',
        updatedAt: Date.now(),
      };
      const success = await saveAlertState(this as any, ctx.params.id, next);
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '指派告警失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: next,
          message: '告警已更新指派人',
          success: true,
        },
      };
    },
  },
  'v1.notifications/:id/resend': {
    metadata: { auth: true },
    params: { id: { type: 'string', required: true } },
    async handler(ctx: Context): Promise<HttpResponseItem> {
      const success = await saveNotificationState(this as any, ctx.params.id, {
        status: 'sent',
        updatedAt: Date.now(),
      });
      if (!success) {
        return {
          status: 500,
          data: {
            code: HttpResponseCode.ServiceActionFaild,
            content: null,
            message: '通知重发失败',
            success: false,
          },
        };
      }
      return {
        status: 200,
        data: {
          code: HttpResponseCode.Success,
          content: { success: true, id: ctx.params.id, status: 'sent' },
          message: '通知已重新发送',
          success: true,
        },
      };
    },
  },
});

export default alerts;
