import nodemailer from 'nodemailer';
import { resolveVerificationEmailConfig } from '../../../core/auth/config/mail';
import { PendingAlertDelivery } from './alert-outbox';

export const SMTP_DELIVERY_TIMEOUT_MS = 10_000;

const registryEmailContent = (delivery: PendingAlertDelivery): { subject: string; text: string } | null => {
  const status = String(delivery.payload.status || 'active');
  const message = String(delivery.payload.message || '');
  const service = String(delivery.payload.service || '服务');

  if (delivery.alertId === 'gateway-registry-readiness' || delivery.alertId.startsWith('gateway-registry-readiness-')) {
    return status === 'resolved'
      ? { subject: '[星光] 服务注册表已恢复', text: message || '服务注册表已恢复，所有必需服务均已重新注册。' }
      : { subject: '[星光] 严重告警：服务注册表异常', text: message || '服务注册表异常，请检查必需服务的注册状态。' };
  }

  if (delivery.alertId.startsWith('registry-missing-')) {
    return status === 'resolved'
      ? { subject: `[星光] 服务恢复：${service} 已重新注册`, text: message || `服务“${service}”已重新注册，服务连接已恢复。` }
      : { subject: `[星光] 服务告警：${service} 未注册`, text: message || `服务“${service}”未注册或连接已断开，请检查服务进程和 Kafka 服务发现。` };
  }

  return null;
};

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('SMTP delivery timed out')), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
};

export const deliverEmail = async (delivery: PendingAlertDelivery, timeoutMs = SMTP_DELIVERY_TIMEOUT_MS): Promise<void> => {
  if (delivery.channel !== 'Email') throw new Error(`No email transport configured for ${delivery.channel}`);
  const address = typeof delivery.target.address === 'string' ? delivery.target.address : '';
  if (!address) throw new Error('Email delivery target is missing an address');
  const config = resolveVerificationEmailConfig();
  if (!config.enabled) throw new Error('SMTP email delivery is disabled');
  const transporter = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, connectionTimeout: timeoutMs, greetingTimeout: timeoutMs, socketTimeout: timeoutMs, auth: { user: config.user, pass: config.password } });
  try {
    const registryContent = registryEmailContent(delivery);
    await withTimeout(transporter.sendMail({
      from: config.from,
      to: address,
      subject: registryContent?.subject || `[Darwin] ${String(delivery.payload.level || 'warning')} alert`,
      text: registryContent?.text || String(delivery.payload.message || 'A Darwin alert requires attention.'),
    }), timeoutMs);
  } finally { transporter.close(); }
};
