export interface VerificationEmail {
  email: string;
  code: string;
  locale: 'sk' | 'en';
}

export interface EmailVerificationProvider {
  sendVerificationCode(message: VerificationEmail): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor() {
    super('Email verification delivery failed.');
    this.name = 'EmailDeliveryError';
  }
}

export class ResendEmailVerificationProvider implements EmailVerificationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    if (!apiKey.trim() || !fromEmail.trim()) {
      throw new Error('Resend credentials are required when email verification is enabled.');
    }
  }

  async sendVerificationCode(message: VerificationEmail): Promise<void> {
    const copy = message.locale === 'sk'
      ? {
          subject: 'Kód na potvrdenie e-mailu',
          text: `Váš jednorazový kód na potvrdenie e-mailu je ${message.code}. Platí 10 minút. Ak ste oň nepožiadali, ignorujte túto správu.`,
        }
      : {
          subject: 'Email verification code',
          text: `Your one-time email verification code is ${message.code}. It expires in 10 minutes. If you did not request it, ignore this message.`,
        };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await this.fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.fromEmail,
          to: [message.email],
          subject: copy.subject,
          text: copy.text,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new EmailDeliveryError();
    } catch {
      throw new EmailDeliveryError();
    } finally {
      clearTimeout(timeout);
    }
  }
}
