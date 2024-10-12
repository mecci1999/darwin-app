/**
 * 发送邮箱验证码的选项
 */
export interface verifyCodeOptions {
  /** The e-mail address of the sender. All e-mail addresses can be plain 'sender@server.com' or formatted 'Sender Name <sender@server.com>' */
  from?: string | undefined;
  /** An e-mail address that will appear on the Sender: field */
  sender?: string | undefined;
  /** Comma separated list or an array of recipients e-mail addresses that will appear on the To: field */
  to?: string | Array<string> | undefined;
  /** Comma separated list or an array of recipients e-mail addresses that will appear on the Cc: field */
  cc?: string | Array<string> | undefined;
  /** Comma separated list or an array of recipients e-mail addresses that will appear on the Bcc: field */
  bcc?: string | Array<string> | undefined;
  /** Comma separated list or an array of e-mail addresses that will appear on the Reply-To: field */
  replyTo?: string | Array<string> | undefined;
  /** The message-id this message is replying */
  inReplyTo?: string | undefined;
  /** Message-id list (an array or space separated string) */
  references?: string | string[] | undefined;
  /** The subject of the e-mail */
  subject?: string | undefined;
  /** An object or array of additional header fields */
  headers?: Headers | undefined;
  /** optional Message-Id value, random value will be generated if not set */
  messageId?: string | undefined;
  /** optional Date value, current UTC string will be used if not set */
  date?: Date | string | undefined;
  /** optional transfer encoding for the textual parts */
  encoding?: string | undefined;
  /** if set to true then fails with an error when a node tries to load content from URL */
  disableUrlAccess?: boolean | undefined;
  /** if set to true then fails with an error when a node tries to load content from a file */
  disableFileAccess?: boolean | undefined;
  /** method to normalize header keys for custom caseing */
  normalizeHeaderKey?(key: string): string;
  priority?: 'high' | 'normal' | 'low' | undefined;
  /** if set to true then converts data:images in the HTML content of message to embedded attachments */
  attachDataUrls?: boolean | undefined;
}
