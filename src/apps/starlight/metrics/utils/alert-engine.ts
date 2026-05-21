import { Star } from 'node-universe';

export interface AlertRule {
  id: string;
  userId: string;
  name: string;
  metric: string;
  condition: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  threshold: number;
  duration: number; // 持续时间（秒）
  channels: string[]; // 通知渠道 (email, webhook, etc.)
  enabled: boolean;
  lastTriggered?: number;
}

export class AlertEngine {
  private star: Star;
  private rules: Map<string, AlertRule> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private evaluationEnabled = false;

  constructor(star: Star) {
    this.star = star;
  }

  /**
   * 加载规则 (模拟从数据库加载)
   */
  async loadRules() {
    this.rules.clear();
    this.evaluationEnabled = false;
    this.star.logger?.warn('Alert engine rule source not configured; alert evaluation disabled');
  }

  /**
   * 启动告警检查
   */
  start(intervalMs: number = 60000) {
    if (!this.evaluationEnabled || this.rules.size === 0) {
      this.star.logger?.warn('Alert engine start skipped because no real rule source/evaluator is configured');
      return;
    }
    this.checkInterval = setInterval(() => this.checkRules(), intervalMs);
    this.star.logger?.info('Alert engine started');
  }

  /**
   * 停止告警检查
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.star.logger?.info('Alert engine stopped');
  }

  /**
   * 检查所有规则
   */
  private async checkRules() {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      await this.checkRule(rule);
    }
  }

  /**
   * 检查单个规则
   */
  private async checkRule(rule: AlertRule) {
    try {
      if (!this.evaluationEnabled) {
        this.star.logger?.warn(`Alert evaluation skipped for rule ${rule.id}: no real evaluator configured`);
        return;
      }

      const currentValue = 0;

      // 2. 判断是否满足条件
      let triggered = false;
      switch (rule.condition) {
        case 'gt': triggered = currentValue > rule.threshold; break;
        case 'lt': triggered = currentValue < rule.threshold; break;
        case 'eq': triggered = currentValue === rule.threshold; break;
        case 'gte': triggered = currentValue >= rule.threshold; break;
        case 'lte': triggered = currentValue <= rule.threshold; break;
      }

      // 3. 触发告警
      if (triggered) {
        // 防止重复频繁告警 (简单消抖)
        const now = Date.now();
        if (!rule.lastTriggered || now - rule.lastTriggered > 300000) { // 5分钟冷却
          await this.triggerAlert(rule, currentValue);
          rule.lastTriggered = now;
        }
      }
    } catch (error) {
      this.star.logger?.error(`Failed to check rule ${rule.id}:`, error);
    }
  }

  /**
   * 触发告警通知
   */
  private async triggerAlert(rule: AlertRule, value: number) {
    this.star.logger?.warn(`ALERT TRIGGERED: ${rule.name} (Value: ${value}, Threshold: ${rule.threshold})`);

    // 发送通知 (调用通知服务或 Gateway WebSocket)
    try {
      // 示例: 通过 Gateway 推送 WebSocket 消息
      // await this.star.call('gateway.websocket.trigger', {
      //   channel: `user:${rule.userId}`,
      //   event: 'alert',
      //   data: { ruleId: rule.id, name: rule.name, value, timestamp: Date.now() }
      // });
      
      // 或者发送到 Kafka 告警 Topic
      // await this.star.emit('alert.triggered', { ... });
    } catch (error) {
      this.star.logger?.error('Failed to send alert notification:', error);
    }
  }
}
