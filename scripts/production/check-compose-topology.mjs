import assert from 'node:assert/strict';
import fs from 'node:fs';

const configPath = process.argv[2];
if (!configPath) throw new Error('Usage: node check-compose-topology.mjs <docker-compose-config.json|->');

const serialized = configPath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(serialized);
const services = config.services ?? {};
const networks = config.networks ?? {};
const secrets = (service) => (service.secrets ?? []).map((item) => typeof item === 'string' ? item : item.source);
const memberships = (service) => Object.keys(service.networks ?? {});

for (const name of ['db', 'backend', 'nginx', 'public-app', 'admin-app', 'migrations', 'migration-check', 'bootstrap']) {
  assert.ok(services[name], `Missing production service: ${name}`);
}

for (const name of ['db', 'backend', 'migrations', 'migration-check', 'bootstrap']) {
  assert.equal((services[name].ports ?? []).length, 0, `${name} must not publish host ports`);
}
for (const name of ['public-app', 'admin-app']) {
  assert.equal((services[name].ports ?? []).length, 0, `${name} must not publish host ports`);
  assert.deepEqual(memberships(services[name]), ['web-private']);
  assert.equal(services[name].read_only, true);
  assert.equal(services[name].user, '101:101');
  assert.ok(services[name].healthcheck, `${name} must expose readiness before edge startup`);
}

const publishedPorts = services.nginx.ports.map((port) => ({
  host_ip: port.host_ip,
  target: Number(port.target),
  published: Number(port.published),
})).sort((a, b) => a.target - b.target);
assert.deepEqual(publishedPorts, [
  { host_ip: '127.0.0.1', target: 8080, published: 80 },
  { host_ip: '127.0.0.1', target: 8443, published: 443 },
], 'production edge ports must remain loopback-only for VPN-tunneled access');

assert.deepEqual(memberships(services.nginx).sort(), ['api-private', 'edge-ingress', 'web-private']);
assert.equal(
  services.nginx.networks['api-private'].ipv4_address,
  '172.30.0.2',
  'Nginx must keep the reserved private proxy address trusted by the backend',
);
assert.equal(networks['edge-ingress']?.driver, 'bridge');
assert.equal(networks['edge-ingress']?.internal, undefined);
assert.equal(
  networks['edge-ingress']?.driver_opts?.['com.docker.network.bridge.enable_ip_masquerade'],
  'false',
  'published edge access must work without outbound NAT on the ingress network',
);
assert.equal(
  services.backend.networks['api-private'].ipv4_address,
  '172.30.0.3',
  'backend must not take the reserved Nginx proxy address',
);
assert.equal(services.nginx.depends_on['public-app'].condition, 'service_healthy');
assert.equal(services.nginx.depends_on['admin-app'].condition, 'service_healthy');
assert.deepEqual(memberships(services.db), ['db-private']);
assert.deepEqual(memberships(services.backend).sort(), ['api-private', 'db-private', 'provider-egress']);
assert.deepEqual(memberships(services.migrations), ['db-private']);
assert.deepEqual(memberships(services['migration-check']), ['db-private']);
assert.deepEqual(memberships(services.bootstrap), ['db-private']);
assert.equal(services['migration-check'].read_only, true);

assert.equal(networks['api-private']?.internal, true);
assert.equal(networks['db-private']?.internal, true);
assert.equal(networks['web-private']?.internal, true);
assert.notEqual(networks['provider-egress']?.internal, true);
assert.equal(services.backend.read_only, true);
assert.equal(services.nginx.read_only, true);
assert.equal(services.nginx.user, '101:101');
assert.ok(services.nginx.healthcheck, 'nginx edge must expose container readiness');
assert.equal(services['public-app'].build.target, 'public-runtime');
assert.equal(services['admin-app'].build.target, 'admin-runtime');
assert.notEqual(services['public-app'].image, services['admin-app'].image);
assert.equal(services.nginx.build.dockerfile, 'frontend/Dockerfile.edge');
assert.match(services.backend.image, /^public-lighting-backend:/);
assert.equal(services.backend.build.args.MIGRATION_VERSION, '0005');
assert.match(services.nginx.image, /^public-lighting-edge:/);
assert.match(services['public-app'].image, /^public-lighting-public:/);
assert.match(services['admin-app'].image, /^public-lighting-admin:/);
assert.equal(services.migrations.image, services.backend.image);
assert.equal(services['migration-check'].image, services.backend.image);
assert.equal(services.bootstrap.image, services.backend.image);

const backendEnv = services.backend.environment ?? {};
assert.equal(backendEnv.DB_USER, 'lighting_runtime');
const maintenanceAndDbaCredentialPrefixes = [
  'BACKUP_DB_', 'RETENTION_DB_',
  'LIGHTING_BACKUP_', 'LIGHTING_RETENTION_',
  'DB_BACKUP_', 'DB_RETENTION_',
  'DB_LIGHTING_BACKUP_', 'DB_LIGHTING_RETENTION_',
  'DB_ADMIN_', 'DBA_',
];
const forbiddenBackendCredentialPrefixes = [
  'MIGRATION_DB_', 'BOOTSTRAP_DB_', ...maintenanceAndDbaCredentialPrefixes,
];
for (const name of ['backend', 'public-app', 'admin-app']) {
  const environment = services[name].environment ?? {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== null && value !== undefined) {
      assert.equal(
        forbiddenBackendCredentialPrefixes.some((prefix) => key.startsWith(prefix)),
        false,
        `${name} must not receive operational credential variable ${key}`,
      );
    }
  }
}
assert.equal(backendEnv.ADMIN_INITIAL_PASSWORD, undefined);
assert.equal(backendEnv.LOCAL_TEST_SUBMIT_ENABLED, 'false');
assert.equal(backendEnv.NOMINATIM_AUTO_GEOCODE, 'false');
assert.equal(backendEnv.GEOAPIFY_ENABLED, 'true');
assert.equal(backendEnv.GEOAPIFY_BASE_URL, 'https://api-eu.geoapify.com');
assert.ok(['disabled', 'local-persistence'].includes(backendEnv.REPORT_SUBMISSION_MODE));
assert.equal(
  backendEnv.EMAIL_VERIFICATION_ENABLED,
  backendEnv.REPORT_SUBMISSION_MODE === 'local-persistence' ? 'true' : 'false',
  'local-persistence must require email verification; disabled mode must not require it',
);
assert.equal(backendEnv.RESEND_API_KEY_FILE, '/run/secrets/resend_api_key');
if (backendEnv.REPORT_SUBMISSION_MODE === 'local-persistence') {
  assert.ok(backendEnv.RESEND_FROM_EMAIL, 'enabled mode must configure a sender address');
}

assert.deepEqual(secrets(services.backend).sort(), [
  'db_runtime_password', 'geoapify_api_key', 'jwt_secret', 'resend_api_key',
]);
assert.deepEqual(secrets(services.db), ['db_admin_password']);
assert.deepEqual(secrets(services.migrations), ['db_migration_password']);
assert.deepEqual(secrets(services['migration-check']), ['db_migration_password']);
assert.deepEqual(secrets(services.bootstrap), ['db_bootstrap_password']);
for (const name of ['migrations', 'migration-check', 'bootstrap']) {
  const env = services[name].environment ?? {};
  const disallowedPrefixes = [
    ...(name === 'bootstrap' ? ['MIGRATION_DB_'] : ['BOOTSTRAP_DB_']),
    ...maintenanceAndDbaCredentialPrefixes,
  ];
  assert.equal(Object.keys(env).some((key) =>
    disallowedPrefixes.some((prefix) => key.startsWith(prefix))), false,
  `${name} must not receive backup, retention, or DBA credential variables`);
  assert.equal(secrets(services[name]).some((secret) =>
    ['db_backup_password', 'db_retention_password', 'db_admin_password'].includes(secret)), false,
  `${name} must not receive maintenance or DBA credentials`);
}
for (const name of ['backend', 'migrations', 'migration-check', 'bootstrap', 'public-app', 'admin-app']) {
  assert.equal(secrets(services[name]).some((secret) =>
    ['db_backup_password', 'db_retention_password'].includes(secret)), false,
  `${name} must not receive maintenance credentials`);
}
assert.deepEqual(secrets(services.nginx), []);
assert.deepEqual(secrets(services['public-app']), []);
assert.deepEqual(secrets(services['admin-app']), []);
assert.equal(services.migrations.profiles.includes('release'), true);
assert.equal(services['migration-check'].profiles.includes('release'), true);
assert.equal(services.bootstrap.profiles.includes('bootstrap'), true);

console.log('Production Compose topology passed: Nginx alone publishes 80/443 on loopback; public/admin static images, API, DB, migration, bootstrap, and provider boundaries are separated.');
