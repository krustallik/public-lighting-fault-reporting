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
assert.equal(backendEnv.MIGRATION_DB_USER, undefined);
assert.equal(backendEnv.BOOTSTRAP_DB_USER, undefined);
assert.equal(backendEnv.ADMIN_INITIAL_PASSWORD, undefined);
assert.equal(backendEnv.LOCAL_TEST_SUBMIT_ENABLED, 'false');
assert.equal(backendEnv.NOMINATIM_AUTO_GEOCODE, 'false');
assert.equal(backendEnv.GEOAPIFY_ENABLED, 'true');
assert.equal(backendEnv.GEOAPIFY_BASE_URL, 'https://api-eu.geoapify.com');

assert.deepEqual(secrets(services.backend).sort(), ['db_runtime_password', 'geoapify_api_key', 'jwt_secret']);
assert.deepEqual(secrets(services.migrations), ['db_migration_password']);
assert.deepEqual(secrets(services.bootstrap), ['db_bootstrap_password']);
assert.deepEqual(secrets(services.nginx), []);
assert.deepEqual(secrets(services['public-app']), []);
assert.deepEqual(secrets(services['admin-app']), []);
assert.equal(services.migrations.profiles.includes('release'), true);
assert.equal(services.bootstrap.profiles.includes('bootstrap'), true);

console.log('Production Compose topology passed: Nginx alone publishes 80/443; public/admin static images, API, DB, migration, bootstrap, and provider boundaries are separated.');
