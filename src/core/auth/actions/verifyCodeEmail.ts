import { verifyCodeOptions } from 'typings';

const VERIFY_CODE_EXPIRY_MINUTES = 5;
const VERIFY_CODE_PLACEHOLDER = '------';

type VerifyCodePurpose = 'register' | 'login' | 'forget' | 'update';

interface VerifyCodeEmailPurposeContent {
  subject: string;
  title: string;
  requestMessage: string;
}

const VERIFY_CODE_EMAIL_PURPOSES: Record<VerifyCodePurpose, VerifyCodeEmailPurposeContent> = {
  register: { subject: '星光 注册验证码', title: '完成注册，开启星光之旅', requestMessage: '你正在注册星光账号，请使用以下验证码完成注册。' },
  login: { subject: '星光 登录验证码', title: '确认本次登录请求', requestMessage: '你正在登录星光，请使用以下验证码确认本次登录。' },
  forget: { subject: '星光 重置密码验证码', title: '重置你的登录密码', requestMessage: '你正在重置星光登录密码，请使用以下验证码继续操作。' },
  update: { subject: '星光 更新密码验证码', title: '确认密码更新请求', requestMessage: '你正在更新星光登录密码，请使用以下验证码确认操作。' },
};

const DEFAULT_VERIFY_CODE_EMAIL_PURPOSE: VerifyCodeEmailPurposeContent = {
  subject: '星光 验证码',
  title: '确认你的验证请求',
  requestMessage: '你正在进行星光账号验证，请使用以下验证码继续操作。',
};

function resolveVerifyCodePurpose(type: string): VerifyCodeEmailPurposeContent {
  if (Object.prototype.hasOwnProperty.call(VERIFY_CODE_EMAIL_PURPOSES, type)) {
    return VERIFY_CODE_EMAIL_PURPOSES[type as VerifyCodePurpose];
  }
  return DEFAULT_VERIFY_CODE_EMAIL_PURPOSE;
}

function sanitizeVerificationCode(code: string): string {
  return /^\d{6}$/.test(code) ? code : VERIFY_CODE_PLACEHOLDER;
}

export function buildVerifyCodeEmail(code: string, type: string, from: string): verifyCodeOptions {
  const purpose = resolveVerifyCodePurpose(type);
  const safeCode = sanitizeVerificationCode(code);

  return {
    from,
    subject: purpose.subject,
    text: `${purpose.title}\n\n${purpose.requestMessage}\n\n验证码：${safeCode}\n\n验证码将在 ${VERIFY_CODE_EXPIRY_MINUTES} 分钟后失效。请勿向任何人透露此验证码；星光工作人员不会向你索取验证码。\n\n如非你本人操作，请忽略此邮件。`,
    html: `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="x-apple-disable-message-reformatting"><title>${purpose.subject}</title></head>
<body style="margin:0; padding:0; background-color:#f4f7fb;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse; background-color:#f4f7fb;"><tr><td align="center" style="padding:32px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; border-collapse:collapse; background-color:#ffffff; border:1px solid #dbe3ef; border-radius:12px;"><tr><td style="padding:32px 32px 24px; font-family:'PingFang SC','Microsoft YaHei',sans-serif; color:#172033;"><p style="margin:0 0 12px; font-size:14px; line-height:20px; font-weight:700; letter-spacing:1.2px; color:#2563eb;">星光</p><h1 style="margin:0; font-size:24px; line-height:34px; font-weight:700; color:#172033;">${purpose.title}</h1><p style="margin:16px 0 0; font-size:16px; line-height:26px; color:#4b5565;">${purpose.requestMessage}</p></td></tr><tr><td style="padding:0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse; background-color:#eff6ff; border:1px solid #bfdbfe; border-radius:8px;"><tr><td align="center" style="padding:24px 16px; font-family:'PingFang SC','Microsoft YaHei',sans-serif;"><p style="margin:0 0 8px; font-size:14px; line-height:20px; color:#475569;">验证码</p><p aria-label="你的六位验证码是 ${safeCode.split('').join(' ')}" style="margin:0; font-size:32px; line-height:40px; font-weight:700; letter-spacing:8px; color:#1d4ed8;">${safeCode}</p></td></tr></table></td></tr><tr><td style="padding:24px 32px 32px; font-family:'PingFang SC','Microsoft YaHei',sans-serif;"><p style="margin:0 0 12px; font-size:14px; line-height:22px; color:#4b5565;">验证码将在 <strong style="color:#172033;">${VERIFY_CODE_EXPIRY_MINUTES} 分钟</strong> 后失效。</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; border-collapse:collapse; background-color:#fff7ed; border-left:4px solid #f97316;"><tr><td style="padding:12px 14px; font-size:14px; line-height:22px; color:#7c2d12;">请勿向任何人透露此验证码；星光工作人员不会通过任何方式向你索取验证码。</td></tr></table><p style="margin:16px 0 0; font-size:14px; line-height:22px; color:#6b7280;">如非你本人操作，请忽略此邮件。</p></td></tr></table><p style="margin:16px 0 0; font-family:'PingFang SC','Microsoft YaHei',sans-serif; font-size:12px; line-height:18px; color:#64748b;">此邮件由星光自动发送，请勿直接回复。</p></td></tr></table></body></html>`,
  };
}
