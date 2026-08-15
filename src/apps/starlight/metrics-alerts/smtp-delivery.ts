import nodemailer from 'nodemailer';
import { resolveVerificationEmailConfig } from '../../../core/auth/config/mail';
import { PendingAlertDelivery } from './alert-outbox';

export const SMTP_DELIVERY_TIMEOUT_MS = 10_000;

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
    await withTimeout(transporter.sendMail({ from: config.from, to: address, subject: `[Darwin] ${String(delivery.payload.level || 'warning')} alert`, text: String(delivery.payload.message || 'A Darwin alert requires attention.') }), timeoutMs);
  } finally { transporter.close(); }
};
