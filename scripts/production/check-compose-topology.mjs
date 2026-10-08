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

for (const name of ['db', 'backend', 'nginx', 'public-app', 'admin-app', 'migrations', 'bootstrap']) {
  assert.ok(services[name], `Missing production service: ${name}`);
}

for (const name of ['db', 'backend', 'migrations', 'bootstrap']) {
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
  target: Number(port.target),
  published: Number(port.published),
})).sort((a, b) => a.target - b.target);
assert.deepEqual(publishedPorts, [
  { target: 8080, published: 80 },
  { target: 8443, published: 443 },
]);

assert.deepEqual(memberships(services.nginx).sort(), ['api-private', 'web-private']);
assert.equal(services.nginx.depends_on['public-app'].condition, 'service_healthy');
assert.equal(services.nginx.depends_on['admin-app'].condition, 'service_healthy');
assert.deepEqual(memberships(services.db), ['db-private']);
assert.deepEqual(memberships(services.backend).sort(), ['api-private', 'db-private', 'provider-egress']);
assert.deepEqual(memberships(services.migrations), ['db-private']);
assert.deepEqual(memberships(services.bootstrap), ['db-private']);

assert.equal(networks['api-private']?.internal, true);
assert.equal(networks['db-private']?.internal, true);
assert.equal(networks['web-private']?.internal, true);
assert.notEqual(networks['provider-egress']?.internal, true);
assert.equal(services.backend.read_only, true);
assert.equal(services.nginx.read_only, true);
assert.equal(services.nginx.user, '101:101');
assert.equal(services['public-app'].build.target, 'public-runtime');
assert.equal(services['admin-app'].build.target, 'admin-runtime');
assert.notEqual(services['public-app'].image, services['admin-app'].image);
assert.equal(services.nginx.build.dockerfile, 'frontend/Dockerfile.edge');

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

assert.deepEqual(secrets(services.backend).sort(), ['db_runtime_password', 'geoapify_api_key', 'jwt_secret']);
assert.deepEqual(secrets(services.db), ['db_admin_password']);
assert.deepEqual(secrets(services.migrations), ['db_migration_password']);
assert.deepEqual(secrets(services.bootstrap), ['db_bootstrap_password']);
for (const name of ['migrations', 'bootstrap']) {
  const env = services[name].environment ?? {};
  const disallowedPrefixes = [
    ...(name === 'migrations' ? ['BOOTSTRAP_DB_'] : ['MIGRATION_DB_']),
    ...maintenanceAndDbaCredentialPrefixes,
  ];
  assert.equal(Object.keys(env).some((key) =>
    disallowedPrefixes.some((prefix) => key.startsWith(prefix))), false,
  `${name} must not receive backup, retention, or DBA credential variables`);
  assert.equal(secrets(services[name]).some((secret) =>
    ['db_backup_password', 'db_retention_password', 'db_admin_password'].includes(secret)), false,
  `${name} must not receive maintenance or DBA credentials`);
}
for (const name of ['backend', 'migrations', 'bootstrap', 'public-app', 'admin-app']) {
  assert.equal(secrets(services[name]).some((secret) =>
    ['db_backup_password', 'db_retention_password'].includes(secret)), false,
  `${name} must not receive maintenance credentials`);
}
assert.deepEqual(secrets(services.nginx), []);
assert.deepEqual(secrets(services['public-app']), []);
assert.deepEqual(secrets(services['admin-app']), []);
assert.equal(services.migrations.profiles.includes('release'), true);
assert.equal(services.bootstrap.profiles.includes('bootstrap'), true);

console.log('Production Compose topology passed: Nginx alone publishes 80/443; public/admin static images, API, DB, migration, bootstrap, and provider boundaries are separated.');
