import { buildVerifyCodeEmail } from '../../src/core/auth/actions/verifyCodeEmail';

describe('buildVerifyCodeEmail', () => {
  const code = '482913';
  const from = '星光 <noreply@example.com>';

  it.each([
    ['register', '星光 注册验证码', '你正在注册星光账号，请使用以下验证码完成注册。'],
    ['login', '星光 登录验证码', '你正在登录星光，请使用以下验证码确认本次登录。'],
    ['forget', '星光 重置密码验证码', '你正在重置星光登录密码，请使用以下验证码继续操作。'],
    ['update', '星光 更新密码验证码', '你正在更新星光登录密码，请使用以下验证码确认操作。'],
  ])('builds the %s email variant', (type, subject, requestMessage) => {
    const email = buildVerifyCodeEmail(code, type, from);

    expect(email.from).toBe(from);
    expect(email.subject).toBe(subject);
    expect(email.html).toContain(requestMessage);
    expect(email.html).toContain('482913');
    expect(email.html).toContain('验证码将在 <strong style="color:#172033;">5 分钟</strong> 后失效。');
    expect(email.html).toContain('请勿向任何人透露此验证码；星光工作人员不会通过任何方式向你索取验证码。');
    expect(email.text).toContain(requestMessage);
    expect(email.text).toContain('验证码：482913');
    expect(email.text).toContain('验证码将在 5 分钟后失效。');
  });

  it('uses accessible, mobile-safe table markup without external dependencies', () => {
    const email = buildVerifyCodeEmail(code, 'login', from);

    expect(email.html).toContain('<html lang="zh-CN">');
    expect(email.html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain('max-width:600px');
    expect(email.html).toContain('aria-label="你的六位验证码是 4 8 2 9 1 3"');
    expect(email.html).not.toMatch(/<script|https?:\/\/|@import|font-face/i);
  });

  it('uses a generic safe fallback and never interpolates unknown purpose text', () => {
    const email = buildVerifyCodeEmail(code, '<img src=x onerror=alert(1)>', from);

    expect(email.subject).toBe('星光 验证码');
    expect(email.html).toContain('你正在进行星光账号验证，请使用以下验证码继续操作。');
    expect(email.text).toContain('你正在进行星光账号验证，请使用以下验证码继续操作。');
    expect(email.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(email.text).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('renders a harmless placeholder when the supplied code is not six digits', () => {
    const email = buildVerifyCodeEmail('<script>alert(1)</script>', 'register', from);

    expect(email.html).toContain('------');
    expect(email.text).toContain('验证码：------');
    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.text).not.toContain('<script>alert(1)</script>');
  });
});
