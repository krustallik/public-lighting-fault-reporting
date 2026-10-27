import os
from pathlib import Path
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
