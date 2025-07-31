import { Context, Star } from 'node-universe';
/**
 * 验证微服务的事件
 */
const authEvents = (star: Star) => {
  return {
    'user.login': async (ctx: Context) => {
      const { userId, ip, userAgent, method } = ctx.params;

      // 记录登录事件
      // await AuditService.logLoginEvent({
      //   userId,
      //   success: true,
      //   ip,
      //   userAgent,
      //   method,
      //   timestamp: new Date(),
      // });

      star.logger?.info('User logged in:', { userId, ip, method });
    },

    'user.logout': async (ctx) => {
      const { userId, tokenId } = ctx.params;

      // 记录登出事件
      // await AuditService.log({
      //   userId,
      //   action: 'user.logout',
      //   result: 'success',
      //   timestamp: new Date(),
      // });

      star.logger?.info('User logged out:', { userId });
    },

    'user.register': async (ctx) => {
      const { userId, email } = ctx.params;

      // 记录注册事件
      // await AuditService.log({
      //   userId,
      //   action: 'user.register',
      //   result: 'success',
      //   timestamp: new Date(),
      // });

      // 分配默认角色
      // await PermissionService.assignRole(userId, PermissionService.ROLES.USER);

      star.logger?.info('User registered:', { userId, email });
    },

    'auth.failed': async (ctx) => {
      const { userId, ip, userAgent, error, method } = ctx.params;

      // 记录失败的登录尝试
      // await AuditService.logLoginEvent({
      //   userId,
      //   success: false,
      //   ip,
      //   userAgent,
      //   method,
      //   error,
      //   timestamp: new Date(),
      // });

      star.logger?.warn('Authentication failed:', { userId, ip, error });
    },

    'auth.locked': async (ctx) => {
      const { userId, reason, duration } = ctx.params;

      // 记录账户锁定事件
      // await AuditService.logSecurityEvent({
      //   type: 'account_locked',
      //   userId,
      //   timestamp: new Date(),
      //   severity: 'high',
      //   metadata: { reason, duration },
      // });

      star.logger?.warn('Account locked:', { userId, reason });
    },

    'token.expired': async (ctx) => {
      const { userId, tokenId } = ctx.params;

      star.logger?.info('Token expired:', { userId, tokenId });
    },

    'permission.denied': async (ctx) => {
      const { userId, action, resource, requiredPermissions, ip } = ctx.params;

      // 记录权限拒绝事件
      // await AuditService.logSecurityEvent({
      //   type: 'permission_denied',
      //   userId,
      //   action,
      //   ip,
      //   timestamp: new Date(),
      //   metadata: {
      //     resource,
      //     requiredPermissions,
      //   },
      // });

      star.logger?.warn('Permission denied:', { userId, action, resource });
    },

    'security.alert': async (ctx) => {
      const { type, userId, severity, metadata } = ctx.params;

      // 记录安全告警
      // await AuditService.logSecurityEvent({
      //   type,
      //   userId,
      //   severity,
      //   timestamp: new Date(),
      //   metadata,
      // });

      star.logger?.warn('Security alert:', { type, userId, severity });
    },
  };
};

export default authEvents;
