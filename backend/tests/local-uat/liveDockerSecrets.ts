import fs from 'node:fs';

const MOUNTED_SECRET_ROOT = '/run/secrets';
const SECRET_NAMES = new Set([
  'db_password',
  'jwt_secret',
  'admin_initial_password',
  'geoapify_api_key',
  'resend_api_key',
  'resend_from_email',
  'approved_email_recipient',
]);

export function parseLiveDockerSecret(name: string, content: string, allowEmpty = false): string {
  if (!SECRET_NAMES.has(name) || content.length > 4096 || /[\0]/.test(content)) {
    throw new Error('Live Docker UAT secret mount is invalid.');
  }
  const value = content.trim();
  if ((!value && !allowEmpty) || /[\r\n]/.test(value)) {
    throw new Error('Live Docker UAT secret mount is empty or malformed.');
  }
  return value;
}

export function readLiveDockerSecret(name: string, allowEmpty = false): string {
  if (!SECRET_NAMES.has(name)) throw new Error('Live Docker UAT secret mount is not allowlisted.');
  const path = `${MOUNTED_SECRET_ROOT}/${name}`;
  try {
    const stat = fs.statSync(path);
    if (!stat.isFile() || stat.size > 4096) throw new Error('invalid');
    return parseLiveDockerSecret(name, fs.readFileSync(path, 'utf8'), allowEmpty);
  } catch {
    throw new Error('Required live Docker UAT secret mount is unavailable.');
  }
}

type LiveDockerSecretReader = (name: string, allowEmpty?: boolean) => string;

export function loadLiveDockerDatabaseSecrets(readSecret: LiveDockerSecretReader = readLiveDockerSecret): void {
  process.env.DB_PASSWORD = readSecret('db_password');
  process.env.JWT_SECRET = readSecret('jwt_secret');
  process.env.ADMIN_INITIAL_PASSWORD = readSecret('admin_initial_password');
}

export function loadLiveDockerServerSecrets(
  emailEnabled: boolean,
  readSecret: LiveDockerSecretReader = readLiveDockerSecret
): void {
  process.env.DB_PASSWORD = readSecret('db_password');
  process.env.JWT_SECRET = readSecret('jwt_secret');
  process.env.GEOAPIFY_API_KEY = readSecret('geoapify_api_key');

  const approvedRecipient = readSecret('approved_email_recipient', true);
  if (emailEnabled) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(approvedRecipient)) {
      throw new Error('Owner-approved Resend recipient is required before enabling OTP.');
    }
    process.env.RESEND_API_KEY = readSecret('resend_api_key');
    process.env.RESEND_FROM_EMAIL = readSecret('resend_from_email');
    process.env.LOCAL_UAT_APPROVED_EMAIL_RECIPIENT = approvedRecipient;
    delete process.env.LOCAL_UAT_RESEND_BLOCKED;
    return;
  }

  if (approvedRecipient) {
    throw new Error('Owner-approved recipient is configured; restart through the live Docker UAT launcher to enable OTP.');
  }
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.LOCAL_UAT_APPROVED_EMAIL_RECIPIENT;
  process.env.LOCAL_UAT_RESEND_BLOCKED = 'owner_recipient_missing';
}
