import type { ApiConfig, Logger } from '@testrex/config';
import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  /** False when no SMTP server is configured; links are then shared manually. */
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

export function createMailer(config: ApiConfig, logger: Logger): Mailer {
  if (!config.SMTP_URL) {
    return {
      enabled: false,
      async send() {
        throw new Error('Email delivery is not configured (SMTP_URL).');
      },
    };
  }
  const transport = nodemailer.createTransport(config.SMTP_URL);
  return {
    enabled: true,
    async send(message) {
      await transport.sendMail({ from: config.SMTP_FROM, ...message });
      logger.info({ to: message.to, subject: message.subject }, 'email sent');
    },
  };
}
