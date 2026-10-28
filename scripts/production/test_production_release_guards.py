import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
GUARDS = ROOT / "scripts/production/host-path-guards.sh"


def bash_executable():
    configured = os.environ.get("BASH_EXE")
    if configured:
        return configured
    if os.name == "nt":
        candidate = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe"
        if candidate.exists():
            return str(candidate)
    return shutil.which("bash")


class ProductionReleaseGuardTests(unittest.TestCase):
    def test_production_images_advertise_the_canonical_migration_ledger(self):
        compose = (ROOT / "docker-compose.production.yml").read_text(encoding="utf-8")
        dockerfile = (ROOT / "backend/Dockerfile.production").read_text(encoding="utf-8")
        self.assertIn('MIGRATION_VERSION: "0005"', compose)
        self.assertNotIn("${MIGRATION_VERSION", compose)
        self.assertIn("ARG MIGRATION_VERSION=0005", dockerfile)

    def test_backend_loopback_healthchecks_use_an_approved_public_host(self):
        expected = (
            "hostname:'127.0.0.1',port:5000,path:'/api/health',"
            "headers:{host:'mapa-svietidiel.sk'}"
        )
        compose = (ROOT / "docker-compose.production.yml").read_text(encoding="utf-8")
        dockerfile = (ROOT / "backend/Dockerfile.production").read_text(encoding="utf-8")
        self.assertIn(expected, compose)
        self.assertIn(expected, dockerfile)

    def test_public_edge_publication_is_protected_by_the_vpn_pre_dnat_guard(self):
        compose = (ROOT / "docker-compose.production.yml").read_text(encoding="utf-8")
        topology = (ROOT / "scripts/production/check-compose-topology.mjs").read_text(encoding="utf-8")
        rules = (ROOT / "scripts/production/vpn-ingress-firewall.nft").read_text(encoding="utf-8")
        unit = (ROOT / "scripts/production/systemd/plfr-production-vpn-ingress-firewall.service").read_text(encoding="utf-8")
        dropin = (ROOT / "scripts/production/systemd/docker.service.d/20-plfr-vpn-ingress.conf").read_text(encoding="utf-8")
        self.assertIn('"0.0.0.0:${HTTP_PORT:-80}:8080"', compose)
        self.assertIn('"0.0.0.0:${HTTPS_PORT:-443}:8443"', compose)
        self.assertIn("'0.0.0.0'", topology)
        self.assertIn("hook prerouting priority raw", rules)
        self.assertIn("tcp dport { 80, 443 } ip saddr != 147.232.164.0/22 drop", rules)
        self.assertNotIn("flush ruleset", rules)
        self.assertIn("Before=network-pre.target docker.service shutdown.target", unit)
        self.assertIn("Requires=plfr-production-vpn-ingress-firewall.service", dropin)
        self.assertIn("After=plfr-production-vpn-ingress-firewall.service", dropin)

    def test_release_refuses_compose_operations_until_exact_firewall_assets_are_verified(self):
        deploy = (ROOT / "scripts/production/deploy-release.sh").read_text(encoding="utf-8")
        verifier = deploy.index('verify-vpn-ingress-firewall.sh"')
        compose_config = deploy.index('"${compose[@]}" config --quiet')
        first_docker = deploy.index('docker volume inspect')
        self.assertLess(verifier, compose_config)
        self.assertLess(compose_config, first_docker)
        self.assertIn('"$release_dir/scripts/production/vpn-ingress-firewall.nft"', deploy)
        self.assertIn('"$release_dir/scripts/production/systemd/plfr-production-vpn-ingress-firewall.service"', deploy)

    def test_edge_restart_and_host_bootstrap_require_the_vpn_firewall(self):
        runtime = (ROOT / "scripts/production/release-runtime.sh").read_text(encoding="utf-8")
        restart = runtime[runtime.index("plfr_restart_current_edge() {"):]
        self.assertLess(restart.index("plfr_assert_vpn_ingress_firewall"), restart.index('"${PLFR_COMPOSE[@]}" up'))
        self.assertIn('"$verifier" --active', runtime)

        installer = (ROOT / "scripts/production/install-vpn-ingress-firewall.sh").read_text(encoding="utf-8")
        host_installer = (ROOT / "scripts/production/install-deployment-host.sh").read_text(encoding="utf-8")
        self.assertIn("systemctl is-active --quiet nftables.service", installer)
        self.assertIn('nft --check --file "$rules_source"', installer)
        self.assertIn("/usr/local/sbin/plfr-verify-vpn-ingress", installer)
        self.assertIn("plfr_require_unclaimed_path \"$verifier_target\"", installer)
        self.assertIn('install-vpn-ingress-firewall.sh"', host_installer)
        self.assertLess(host_installer.index('visudo -cf'), host_installer.index('install-vpn-ingress-firewall.sh"'))
        if os.name != "nt":
            for path in (
                ROOT / "scripts/production/install-vpn-ingress-firewall.sh",
                ROOT / "scripts/production/verify-vpn-ingress-firewall.sh",
            ):
                self.assertTrue(os.access(path, os.X_OK), f"{path.name} must be executable")

    def test_vpn_firewall_verifier_supports_exact_release_and_active_runtime_modes(self):
        verifier = (ROOT / "scripts/production/verify-vpn-ingress-firewall.sh").read_text(encoding="utf-8")
        self.assertIn("( $# -ne 1 && $# -ne 3 )", verifier)
        self.assertIn("[[ \"$1\" != '--active' ]]", verifier)
        self.assertIn('if [[ "$#" == 3 ]]; then', verifier)
        self.assertIn("tcp dport { 80, 443 } ip saddr != 147.232.164.0/22 drop", verifier)

    def test_unclaimed_path_guard_rejects_existing_and_dangling_symlinks(self):
        bash = bash_executable()
        if not bash:
            self.skipTest("Bash is unavailable for the host path guard test.")
        if os.name == "nt":
            self.skipTest("Windows symlink creation is not guaranteed in the local runner.")

        with tempfile.TemporaryDirectory(prefix="plfr-installer-path-guard-") as temporary:
            root = Path(temporary)
            absent = root / "absent"
            existing = root / "existing"
            dangling = root / "dangling"
            existing.write_text("synthetic", encoding="ascii")
            dangling.symlink_to(root / "missing-target")

            def check(path):
                return subprocess.run(
                    [bash, "-c", 'source "$1"; plfr_require_unclaimed_path "$2"', "_", str(GUARDS), str(path)],
                    text=True,
                    capture_output=True,
                    check=False,
                )

            self.assertEqual(check(absent).returncode, 0)
            self.assertNotEqual(check(existing).returncode, 0)
            self.assertNotEqual(check(dangling).returncode, 0)

    def test_installer_routes_every_protected_creation_target_through_guard(self):
        source = (ROOT / "scripts/production/install-deployment-host.sh").read_text(encoding="utf-8")
        for path in (
            "/opt/plfr-production",
            "/etc/plfr-production",
            "/var/lib/plfr-deploy",
            "/usr/local/sbin/plfr-deploy-ssh",
            "/usr/local/sbin/plfr-production-deploy",
            "/etc/sudoers.d/plfr-deploy",
            "/var/lib/plfr-acme/production",
        ):
            self.assertIn(f"plfr_require_unclaimed_path {path}", source)
        self.assertIn('plfr_require_unclaimed_path "$unit"', source)
        self.assertIn('plfr_require_unclaimed_path "$hook"', source)
        self.assertIn('acme-environment.sh" /opt/plfr-production/control/acme-environment.sh', source)
        self.assertIn('initialize-production-certificate.sh" /opt/plfr-production/control/initialize-production-certificate.sh', source)

    def test_deployment_revalidates_exact_release_after_build_before_rollout(self):
        source = (ROOT / "scripts/production/deploy-release.sh").read_text(encoding="utf-8")
        final_verification = source.rindex('verify_github_release.py" "$sha" "$run_id"')
        build = source.index('"${compose[@]}" --parallel 1 build')
        ledger = source.index('migration-check')
        rollout = source.index('if rollout "$sha"; then')
        self.assertLess(build, ledger)
        self.assertLess(ledger, final_verification)
        self.assertLess(final_verification, rollout)

    def test_deployment_runs_have_distinct_queue_groups_and_wait_for_host_lock(self):
        workflow = (ROOT / ".github/workflows/deploy-production.yml").read_text(encoding="utf-8")
        deploy = (ROOT / "scripts/production/deploy-release.sh").read_text(encoding="utf-8")
        entrypoint = (ROOT / "scripts/production/deploy-root-entrypoint.sh").read_text(encoding="utf-8")
        self.assertIn(
            "group: public-lighting-production-${{ github.event.workflow_run.id }}",
            workflow,
        )
        self.assertIn("cancel-in-progress: false", workflow)
        release_lock_wait = re.search(r"plfr_acquire_release_lock (\d+)", deploy)
        fetch_lock_wait = re.search(r"flock -w (\d+) 8", entrypoint)
        self.assertIsNotNone(release_lock_wait)
        self.assertIsNotNone(fetch_lock_wait)
        deploy_section = workflow.split("\n  deploy:\n", maxsplit=1)[1]
        timeout = re.search(r"(?m)^    timeout-minutes: (\d+)$", deploy_section)
        self.assertIsNotNone(timeout, "The deploy job must have a finite timeout.")
        queue_seconds = int(release_lock_wait.group(1)) + int(fetch_lock_wait.group(1))
        self.assertGreaterEqual(
            int(timeout.group(1)) * 60,
            queue_seconds + 2 * 60 * 60,
            "Keep two hours for release work after the combined maximum lock wait.",
        )
        mode_line = subprocess.run(
            ["git", "ls-files", "--stage", "--", "scripts/production/deploy-release.sh"],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        ).stdout.strip()
        self.assertRegex(mode_line, r"^100755 [0-9a-f]{40} 0\tscripts/production/deploy-release\.sh$")
        if os.name != "nt":
            self.assertTrue(os.access(ROOT / "scripts/production/deploy-release.sh", os.X_OK))
        deployment_call = entrypoint.index('exec "$release/scripts/production/deploy-release.sh"')
        self.assertLess(entrypoint.index("flock -u 8"), deployment_call)
        self.assertLess(entrypoint.index("exec 8>&-"), deployment_call)

    def test_external_acme_calls_require_explicit_stage_or_production_approval(self):
        staging = (ROOT / "scripts/production/check-websupport-acme-staging.sh").read_text(encoding="utf-8")
        production = (ROOT / "scripts/production/initialize-production-certificate.sh").read_text(encoding="utf-8")
        staging_call = staging.index('"$lego" --server')
        production_call = production.index('"$lego" --email')
        self.assertLess(staging.index("PLFR_APPROVE_ACME_STAGING_DNS_CHALLENGE"), staging_call)
        self.assertLess(production.index("PLFR_APPROVE_PRODUCTION_ACME_ISSUANCE"), production_call)

    def test_acme_installation_shares_the_release_lock_for_the_full_tls_operation(self):
        renew = (ROOT / "scripts/production/renew-production-certificate.sh").read_text(encoding="utf-8")
        initialize = (ROOT / "scripts/production/initialize-production-certificate.sh").read_text(encoding="utf-8")
        staging = (ROOT / "scripts/production/check-websupport-acme-staging.sh").read_text(encoding="utf-8")
        hook = (ROOT / "scripts/production/certbot-deploy-hook.sh").read_text(encoding="utf-8")

        for name, source, action in (
            ("renewal", renew, '"$lego" --email'),
            ("initial issuance", initialize, '"$lego" --email'),
        ):
            with self.subTest(operation=name):
                self.assertLess(source.index("plfr_acquire_release_lock"), source.index(action))
                self.assertLess(source.index(action), source.rindex('"$install_hook"'))
                self.assertIn("PLFR_RELEASE_LOCK_HELD=1", source)
        self.assertLess(staging.index("flock -n 8"), staging.index('"$lego" --server'))
        self.assertIn("plfr_assert_inherited_release_lock", hook)


if __name__ == "__main__":
    unittest.main()
