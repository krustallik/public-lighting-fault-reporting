import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "scripts/production/release-runtime.sh"
SHA = "0123456789abcdef0123456789abcdef01234567"


def bash_executable():
    configured = os.environ.get("BASH_EXE")
    if configured:
        return configured
    if os.name == "nt":
        git_bash = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe"
        if git_bash.exists():
            return str(git_bash)
    result = shutil.which("bash")
    if not result:
        raise unittest.SkipTest("Bash is unavailable for release runtime tests.")
    return result


class ReleaseRuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bash = bash_executable()
        if not shutil.which("openssl"):
            raise unittest.SkipTest("OpenSSL is unavailable for TLS runtime tests.")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="plfr-release-runtime-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        # Privileged wrapper tests intentionally create root-owned files below this
        # disposable directory. Restore the test user's ownership before
        # TemporaryDirectory cleanup, including when the suite runs under a normal
        # GitHub Actions user with passwordless sudo rather than as root.
        self.addCleanup(self._restore_temp_root_ownership)
        self.config = self.root / "config"
        self.app = self.root / "app"
        self.bin = self.root / "bin"
        self.tls = self.config / "tls"
        self.release = self.app / "releases" / SHA
        self.lock = self.root / "run/release.lock"
        self.acme_state_lock = self.root / "run/acme-state.lock"
        for directory in (self.config, self.release, self.bin, self.tls, self.root / "run"):
            directory.mkdir(parents=True, exist_ok=True)
        (self.config / "production.env").write_text("TEST_ONLY=1\n", encoding="utf-8")
        (self.release / "docker-compose.production.yml").write_text("services: {}\n", encoding="utf-8")
        (self.config / "current-release").write_text(f"{SHA}\n", encoding="ascii")
        self.docker_log = self.root / "docker.log"
        self.curl_log = self.root / "curl.log"
        self.fail_marker = self.root / "failed-once"
        docker = self.bin / "docker"
        docker.write_text(
            "#!/usr/bin/env bash\n"
            "printf '%s\\n' \"$*\" >> \"$DOCKER_LOG\"\n"
            "if [[ \"$1 $2\" == 'image inspect' ]]; then\n"
            "  [[ \"${IMAGE_MISSING:-0}\" != 1 ]] || exit 1\n"
            "  printf '%s\\n' \"${IMAGE_REVISION:-}\"\n"
            "  exit 0\n"
            "fi\n"
            "if [[ \"$*\" == *' up '* ]]; then\n"
            "  if [[ \"${BLOCK_DOCKER_UP:-0}\" == 1 ]]; then touch \"$DOCKER_UP_READY\"; while [[ ! -e \"$DOCKER_UP_RELEASE\" ]]; do sleep 0.01; done; fi\n"
            "  if [[ \"${FAIL_UP_ONCE:-0}\" == 1 && ! -e \"$FAIL_MARKER\" ]]; then touch \"$FAIL_MARKER\"; exit 1; fi\n"
            "  [[ \"${FAIL_UP:-0}\" != 1 ]] || exit 1\n"
            "fi\n"
            "exit 0\n",
            encoding="utf-8",
        )
        docker.chmod(0o755)
        curl = self.bin / "curl"
        curl.write_text(
            "#!/usr/bin/env bash\n"
            "printf '%s\\n' \"$*\" >> \"$CURL_LOG\"\n"
            "[[ \"${FAIL_CURL:-0}\" != 1 ]]\n",
            encoding="utf-8",
        )
        curl.chmod(0o755)
        self.env = os.environ.copy()
        self.env.update({
            "PATH": f"{self.bin}{os.pathsep}{self.env.get('PATH', '')}",
            "PLFR_CONFIG_ROOT": str(self.config),
            "PLFR_APP_ROOT": str(self.app),
            "PLFR_RELEASE_LOCK_FILE": str(self.lock),
            "PLFR_ACME_STATE_LOCK_FILE": str(self.acme_state_lock),
            "PLFR_RELEASE_RUNTIME": str(RUNTIME),
            "DOCKER_LOG": str(self.docker_log),
            "CURL_LOG": str(self.curl_log),
            "FAIL_MARKER": str(self.fail_marker),
            "IMAGE_REVISION": SHA,
        })

    def run_bash(self, script, extra_env=None, check=False):
        env = {**self.env, **(extra_env or {})}
        return subprocess.run([self.bash, "-c", script], env=env, text=True, capture_output=True, check=check)

    def test_restart_uses_exact_release_sha_and_never_builds_or_pulls(self):
        result = self.run_bash('set -Eeuo pipefail; source "$PLFR_RELEASE_RUNTIME"; plfr_acquire_release_lock; plfr_restart_current_edge')
        self.assertEqual(result.returncode, 0, result.stderr)
        docker_calls = self.docker_log.read_text(encoding="utf-8")
        self.assertIn(f"public-lighting-edge:{SHA}", docker_calls)
        self.assertIn(str(self.release), docker_calls)
        self.assertIn("--no-build --pull never --force-recreate nginx", docker_calls)
        self.assertNotIn(":local", docker_calls)
        self.assertEqual(len(self.curl_log.read_text(encoding="utf-8").splitlines()), 3)

    def test_pinned_lego_gate_requires_the_exact_semantic_version(self):
        fake_lego = self.bin / "versioned-lego"
        fake_lego.write_text(
            "#!/usr/bin/env bash\n"
            "printf '%s\\n' \"$TEST_LEGO_VERSION\"\n",
            encoding="utf-8",
        )
        fake_lego.chmod(0o755)
        for version, expected in (
            ("lego version 5.5.2 linux/amd64", 0),
            ("lego version v5.5.2", 0),
            ("lego version 5.5.20 linux/amd64", 1),
            ("lego version 5.5.200", 1),
            ("lego version 5.5.2-rc1", 1),
            ("lego version 5.5.2.1", 1),
            ("lego version 5.5.2garbage", 1),
        ):
            with self.subTest(version=version):
                result = self.run_bash(
                    'source "$ACME_ENVIRONMENT"; plfr_validate_pinned_lego',
                    {
                        "ACME_ENVIRONMENT": str(ROOT / "scripts/production/acme-environment.sh"),
                        "PLFR_LEGO_BIN": str(fake_lego),
                        "TEST_LEGO_VERSION": version,
                    },
                )
                self.assertEqual(result.returncode, expected, result.stderr)

    def test_marker_publication_failure_rolls_back_healthy_application_release(self):
        if os.name == "nt":
            self.skipTest("The deployment wrapper rollback test runs in isolated Linux CI.")
        if hasattr(os, "geteuid") and os.geteuid() != 0 and not shutil.which("sudo"):
            self.skipTest("The actual deployment wrapper requires root or non-interactive sudo.")

        system_config = self.root / "isolated/etc/plfr-production"
        system_app = self.root / "isolated/opt/plfr-production"
        self.addCleanup(self._remove_privileged_paths, system_config, system_app)

        new_sha = "fedcba9876543210fedcba9876543210fedcba98"
        release_root = self.root / "source-release"
        release_scripts = release_root / "scripts/production"
        release_scripts.mkdir(parents=True)
        deploy_script = (ROOT / "scripts/production/deploy-release.sh").read_text(encoding="utf-8")
        deploy_script = deploy_script.replace(
            "readonly app_root='/opt/plfr-production'",
            f"readonly app_root='{system_app}'",
        ).replace(
            "readonly config_root='/etc/plfr-production'",
            f"readonly config_root='{system_config}'",
        )
        self.assertNotIn("readonly app_root='/opt/plfr-production'", deploy_script)
        self.assertNotIn("readonly config_root='/etc/plfr-production'", deploy_script)
        (release_scripts / "deploy-release.sh").write_text(deploy_script, encoding="utf-8")
        (release_scripts / "deploy-release.sh").chmod(0o755)
        shutil.copyfile(RUNTIME, release_scripts / "release-runtime.sh")
        (release_scripts / "verify_github_release.py").write_text("# network disabled test stub\n", encoding="ascii")
        (release_root / "docker-compose.production.yml").write_text("services: {}\n", encoding="ascii")

        secret_files = []
        for name in (
            "db-admin", "db-runtime", "db-migration", "jwt", "geoapify", "resend",
        ):
            secret = self.root / f"secret-{name}"
            secret.write_text("synthetic-test-only\n", encoding="ascii")
            secret_files.append(secret)
        env_source = self.root / "production.env"
        volume = "public-lighting-production-pgdata"
        env_source.write_text(
            "\n".join((
                "REPORT_SUBMISSION_MODE=local-persistence",
                "EMAIL_VERIFICATION_ENABLED=true",
                "GEOAPIFY_ENABLED=true",
                "NOMINATIM_AUTO_GEOCODE=false",
                "LOCAL_TEST_SUBMIT_ENABLED=false",
                f"PRODUCTION_DB_VOLUME={volume}",
                "DB_NAME=plfr_production",
                f"DB_ADMIN_PASSWORD_FILE={secret_files[0]}",
                f"DB_RUNTIME_PASSWORD_FILE={secret_files[1]}",
                f"DB_MIGRATION_PASSWORD_FILE={secret_files[2]}",
                f"JWT_SECRET_FILE={secret_files[3]}",
                f"GEOAPIFY_API_KEY_FILE={secret_files[4]}",
                f"RESEND_API_KEY_FILE={secret_files[5]}",
                "RESEND_FROM_EMAIL=otp@example.test",
                "VITE_CARTO_PUBLIC_KEY=synthetic-ci-only",
                f"TLS_DIRECTORY={system_config / 'tls'}",
            )) + "\n",
            encoding="ascii",
        )
        cert, key = self.make_certificate_pair("marker-rollback")
        old_compose = self.root / "old-docker-compose.production.yml"
        shutil.copyfile(ROOT / "docker-compose.production.yml", old_compose)
        old_marker = self.root / "old-current-release"
        old_marker.write_text(f"{SHA}\n", encoding="ascii")

        docker = self.bin / "docker"
        docker.write_text(
            "#!/usr/bin/env bash\n"
            "printf 'APP_BUILD_SHA=%s %s\\n' \"${APP_BUILD_SHA:-unset}\" \"$*\" >> \"$DOCKER_LOG\"\n"
            "if [[ \"$1 $2\" == 'image inspect' ]]; then image=\"${@: -1}\"; printf '%s\\n' \"${image##*:}\"; exit 0; fi\n"
            "if [[ \"$1 $2\" == 'volume inspect' ]]; then exit 0; fi\n"
            "if [[ \"$1\" == inspect && \"$3\" == *State.Health.Status* ]]; then printf '%s\\n' healthy; exit 0; fi\n"
            "if [[ \"$1\" == inspect && \"$3\" == *Mounts* ]]; then printf '%s\\n' \"$TEST_DB_VOLUME\"; exit 0; fi\n"
            "if [[ \"$*\" == *' ps -q db'* ]]; then printf '%s\\n' synthetic-db; exit 0; fi\n"
            "exit 0\n",
            encoding="utf-8",
        )
        docker.chmod(0o755)
        python = self.bin / "python3"
        python.write_text(
            "#!/usr/bin/env bash\n"
            "printf '%s\\n' \"$*\" >> \"$PYTHON_LOG\"\n"
            "exit 0\n",
            encoding="utf-8",
        )
        python.chmod(0o755)
        git = self.bin / "git"
        git.write_text(
            "#!/usr/bin/env bash\n"
            "if [[ \"$*\" == *'rev-parse --show-toplevel'* ]]; then printf '%s\\n' \"$TEST_REPO_ROOT\"; exit 0; fi\n"
            "if [[ \"$*\" == *'rev-parse HEAD'* ]]; then printf '%s\\n' \"$TEST_DEPLOY_SHA\"; exit 0; fi\n"
            "if [[ \"$*\" == *'status --porcelain'* ]]; then exit 0; fi\n"
            "exit 97\n",
            encoding="utf-8",
        )
        git.chmod(0o755)
        real_mv = shutil.which("mv")
        if not real_mv:
            self.skipTest("The mv utility is unavailable for marker failure injection.")
        move = self.bin / "mv"
        move.write_text(
            "#!/usr/bin/env bash\n"
            "destination=\"${@: -1}\"\n"
            "if [[ \"${FAIL_CURRENT_MARKER_MOVE:-0}\" == 1 && \"$destination\" == \"$CURRENT_FILE\" ]]; then touch \"$MARKER_MOVE_REACHED\"; exit 1; fi\n"
            "exec \"$REAL_MV\" \"$@\"\n",
            encoding="utf-8",
        )
        move.chmod(0o755)

        for secret in secret_files:
            self._set_file_metadata(secret, 0, 0, 0o600)

        self._run_privileged([
            "install", "-d", "-o", "root", "-g", "root", "-m", "0750",
            str(system_config), str(system_config / "tls/releases/previous"),
            str(system_app / f"releases/{SHA}"),
        ])
        self._run_privileged([
            "install", "-o", "root", "-g", "root", "-m", "0600",
            str(env_source), str(system_config / "production.env"),
        ])
        self._run_privileged([
            "install", "-o", "root", "-g", "root", "-m", "0600",
            str(old_marker), str(system_config / "current-release"),
        ])
        self._run_privileged([
            "install", "-o", "root", "-g", "root", "-m", "0644",
            str(cert), str(system_config / "tls/releases/previous/tls.crt"),
        ])
        self._run_privileged([
            "install", "-o", "root", "-g", "101", "-m", "0640",
            str(key), str(system_config / "tls/releases/previous/tls.key"),
        ])
        self._run_privileged(["ln", "-s", "releases/previous", str(system_config / "tls/current")])
        self._run_privileged([
            "install", "-o", "root", "-g", "root", "-m", "0644",
            str(old_compose), str(system_app / f"releases/{SHA}/docker-compose.production.yml"),
        ])

        marker_move_reached = self.root / "marker-move-reached"
        python_log = self.root / "deploy-python.log"
        env = {
            **self.env,
            "PLFR_CONFIG_ROOT": str(system_config),
            "PLFR_APP_ROOT": str(system_app),
            "PLFR_RELEASE_LOCK_FILE": str(self.lock),
            "PLFR_RELEASE_RUNTIME": str(RUNTIME),
            "CURRENT_FILE": str(system_config / "current-release"),
            "FAIL_CURRENT_MARKER_MOVE": "1",
            "MARKER_MOVE_REACHED": str(marker_move_reached),
            "REAL_MV": real_mv,
            "TEST_REPO_ROOT": str(release_root),
            "TEST_DEPLOY_SHA": new_sha,
            "TEST_DB_VOLUME": volume,
            "PYTHON_LOG": str(python_log),
        }
        result = subprocess.run(
            self._root_command(release_scripts / "deploy-release.sh", env, new_sha, "123"),
            text=True, capture_output=True, check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("publishing its authoritative marker failed", result.stderr)
        self.assertIn("Image-only rollback restored previous release", result.stderr)
        self.assertTrue(marker_move_reached.exists())
        marker = self._run_privileged_output(["cat", str(system_config / "current-release")])
        self.assertEqual(marker, f"{SHA}\n")
        docker_calls = self.docker_log.read_text(encoding="utf-8")
        self.assertIn(f"APP_BUILD_SHA={new_sha} compose", docker_calls)
        self.assertIn(f"APP_BUILD_SHA={SHA} compose", docker_calls)
        self.assertNotIn(" compose down", docker_calls)
        self.assertEqual(len(self.curl_log.read_text(encoding="utf-8").splitlines()), 6)
        self.assertEqual(len(python_log.read_text(encoding="utf-8").splitlines()), 2)

    def test_missing_marker_fails_closed_before_docker(self):
        (self.config / "current-release").unlink()
        result = self.run_bash('set -Eeuo pipefail; source "$PLFR_RELEASE_RUNTIME"; plfr_restart_current_edge')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.docker_log.exists())

    def test_invalid_marker_fails_closed_before_docker(self):
        (self.config / "current-release").write_text("not-a-release\n", encoding="ascii")
        result = self.run_bash('set -Eeuo pipefail; source "$PLFR_RELEASE_RUNTIME"; plfr_restart_current_edge')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.docker_log.exists())

    def test_unavailable_or_wrong_sha_edge_image_fails_closed(self):
        for image_env in ({"IMAGE_MISSING": "1"}, {"IMAGE_REVISION": "f" * 40}):
            self.docker_log.unlink(missing_ok=True)
            result = self.run_bash(
                'set -Eeuo pipefail; source "$PLFR_RELEASE_RUNTIME"; plfr_restart_current_edge', image_env
            )
            self.assertNotEqual(result.returncode, 0)
            calls = self.docker_log.read_text(encoding="utf-8")
            self.assertNotIn(" up ", calls)

    def test_failed_restart_keeps_release_marker_unchanged(self):
        result = self.run_bash(
            'set -Eeuo pipefail; source "$PLFR_RELEASE_RUNTIME"; plfr_restart_current_edge',
            {"FAIL_UP": "1"},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.config / "current-release").read_text(encoding="ascii"), f"{SHA}\n")

    def test_tls_key_permissions_distinguish_legacy_bootstrap_from_versioned_layout(self):
        key = self.root / "tls-key"
        key.write_text("synthetic-key-material\n", encoding="ascii")
        owner = str(os.getuid()) if hasattr(os, "getuid") else "0"
        group = str(os.getgid()) if hasattr(os, "getgid") else "101"

        key.chmod(0o600)
        legacy = self.run_bash(
            'source "$PLFR_RELEASE_RUNTIME"; plfr_validate_tls_key_access "$KEY" 1 "$OWNER" "$GROUP"',
            {"KEY": str(key), "OWNER": owner, "GROUP": group},
        )
        self.assertEqual(legacy.returncode, 0, legacy.stderr)
        versioned_legacy_mode = self.run_bash(
            'source "$PLFR_RELEASE_RUNTIME"; plfr_validate_tls_key_access "$KEY" 0 "$OWNER" "$GROUP"',
            {"KEY": str(key), "OWNER": owner, "GROUP": group},
        )
        self.assertNotEqual(versioned_legacy_mode.returncode, 0)

        key.chmod(0o640)
        observed_legacy_mode = self.run_bash(
            'source "$PLFR_RELEASE_RUNTIME"; plfr_validate_tls_key_access "$KEY" 1 "$OWNER" "$GROUP"',
            {"KEY": str(key), "OWNER": owner, "GROUP": group},
        )
        self.assertEqual(observed_legacy_mode.returncode, 0, observed_legacy_mode.stderr)
        versioned = self.run_bash(
            'source "$PLFR_RELEASE_RUNTIME"; plfr_validate_tls_key_access "$KEY" 0 "$OWNER" "$GROUP"',
            {"KEY": str(key), "OWNER": owner, "GROUP": group},
        )
        self.assertEqual(versioned.returncode, 0, versioned.stderr)

        key.chmod(0o644)
        unsafe_legacy = self.run_bash(
            'source "$PLFR_RELEASE_RUNTIME"; plfr_validate_tls_key_access "$KEY" 1 "$OWNER" "$GROUP"',
            {"KEY": str(key), "OWNER": owner, "GROUP": group},
        )
        self.assertNotEqual(unsafe_legacy.returncode, 0)

    def test_failed_tls_key_copy_removes_partial_private_staging_directory(self):
        real_install = shutil.which("install")
        if not real_install:
            self.skipTest("The install utility is unavailable for TLS staging failure injection.")
        certificate, key = self.make_certificate_pair("partial-copy")
        wrapper = self.bin / "install"
        wrapper.write_text(
            "#!/usr/bin/env bash\n"
            "if [[ \"${FAIL_TLS_KEY_INSTALL:-0}\" == 1 && \"$*\" == *'/tls.key' ]]; then exit 1; fi\n"
            "exec \"$REAL_INSTALL\" \"$@\"\n",
            encoding="utf-8",
        )
        wrapper.chmod(0o755)
        result = self.run_bash(
            'source "$PLFR_RELEASE_RUNTIME"; plfr_publish_tls_pair "$TLS_ROOT" "$CERT" "$KEY"',
            {
                "TLS_ROOT": str(self.tls),
                "CERT": str(certificate),
                "KEY": str(key),
                "FAIL_TLS_KEY_INSTALL": "1",
                "REAL_INSTALL": real_install,
            },
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.tls / "current").exists())
        self.assertEqual(list((self.tls / "releases").iterdir()), [])

    def test_release_lock_serializes_restart_and_deployment_critical_sections(self):
        ready = self.root / "lock-held"
        first = subprocess.Popen(
            [self.bash, "-c", 'source "$PLFR_RELEASE_RUNTIME"; plfr_acquire_release_lock; touch "$LOCK_READY"; sleep 1'],
            env={**self.env, "LOCK_READY": str(ready)},
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + 5
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(ready.exists(), "the first critical section did not acquire the shared lock")
        second = self.run_bash('source "$PLFR_RELEASE_RUNTIME"; plfr_acquire_release_lock')
        self.assertNotEqual(second.returncode, 0)
        stdout, stderr = first.communicate(timeout=5)
        self.assertEqual(first.returncode, 0, stderr or stdout)

    def test_inherited_tls_hook_lock_descriptor_must_match_shared_lock(self):
        inherited = self.run_bash(
            'source "$PLFR_RELEASE_RUNTIME"; plfr_acquire_release_lock; '
            "PLFR_RELEASE_LOCK_HELD=1 bash -c 'source \"$PLFR_RELEASE_RUNTIME\"; plfr_assert_inherited_release_lock'"
        )
        self.assertEqual(inherited.returncode, 0, inherited.stderr)
        incorrect = self.run_bash(
            'source "$PLFR_RELEASE_RUNTIME"; plfr_acquire_release_lock; '
            'PLFR_RELEASE_LOCK_HELD=1 PLFR_RELEASE_LOCK_FILE="$PLFR_RELEASE_LOCK_FILE.wrong" '
            "bash -c 'source \"$PLFR_RELEASE_RUNTIME\"; plfr_assert_inherited_release_lock'"
        )
        self.assertNotEqual(incorrect.returncode, 0)

        ready = self.root / "lock-contention-ready"
        holder = subprocess.Popen(
            [self.bash, "-c", 'source "$PLFR_RELEASE_RUNTIME"; plfr_acquire_release_lock; touch "$LOCK_READY"; sleep 1'],
            env={**self.env, "LOCK_READY": str(ready)}, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(ready.exists(), "the competing release did not acquire the shared lock")
            unlocked_same_path = self.run_bash(
                'exec 9>"$PLFR_RELEASE_LOCK_FILE"; '
                'PLFR_RELEASE_LOCK_HELD=1 bash -c '
                '\'source "$PLFR_RELEASE_RUNTIME"; plfr_assert_inherited_release_lock\''
            )
            self.assertNotEqual(unlocked_same_path.returncode, 0)
        finally:
            stdout, stderr = holder.communicate(timeout=5)
        self.assertEqual(holder.returncode, 0, stderr or stdout)

    def test_real_renewal_hook_and_deploy_wrapper_share_the_release_lock(self):
        if os.name == "nt":
            self.skipTest("The wrapper-level Linux locking test runs in the isolated Ubuntu CI job.")

        sudo = shutil.which("sudo")
        if hasattr(os, "geteuid") and os.geteuid() != 0 and not sudo:
            self.skipTest("Root-owned ACME files require root or non-interactive sudo.")

        acme_root = self.root / "acme-production"
        acme_certs = acme_root / "certificates"
        acme_certs.mkdir(parents=True)
        (self.root / "run").mkdir(exist_ok=True)
        api_key_file = self.root / "websupport-api-key"
        secret_file = self.root / "websupport-secret"
        acme_env_file = self.root / "acme.env"
        api_key_file.write_text("synthetic-test-value\n", encoding="ascii")
        secret_file.write_text("synthetic-test-value\n", encoding="ascii")
        acme_env_file.write_text(
            f"ACME_ACCOUNT_EMAIL=owner@example.test\n"
            f"WEBSUPPORT_API_KEY_FILE={api_key_file}\n"
            f"WEBSUPPORT_SECRET_FILE={secret_file}\n"
            "ACME_RENEWAL_ENABLED=true\n",
            encoding="ascii",
        )
        old_cert, old_key = self.make_certificate_pair("wrapper-old")
        new_cert, new_key = self.make_certificate_pair("wrapper-renewal")
        shutil.copyfile(new_cert, acme_certs / "mapa-svietidiel.sk.crt")
        shutil.copyfile(new_key, acme_certs / "mapa-svietidiel.sk.key")

        lego_ready = self.root / "lego-ready"
        lego_release = self.root / "allow-lego-to-finish"
        docker_ready = self.root / "hook-docker-ready"
        docker_release = self.root / "allow-hook-docker-to-finish"
        verifier_marker = self.root / "deploy-verifier-reached"
        fake_lego = self.bin / "lego"
        fake_lego.write_text(
            "#!/usr/bin/env bash\n"
            "if [[ \"${1:-}\" == --version ]]; then printf '%s\\n' 'lego version 5.5.2'; exit 0; fi\n"
            "touch \"$LEGO_READY\"\n"
            "while [[ ! -e \"$LEGO_RELEASE\" ]]; do sleep 0.01; done\n",
            encoding="utf-8",
        )
        fake_lego.chmod(0o755)
        fake_python = self.bin / "python3"
        fake_python.write_text(
            "#!/usr/bin/env bash\n"
            "touch \"$DEPLOY_VERIFIER_REACHED\"\n"
            "printf '%s\\n' 'network-disabled deploy verifier stub invoked' >&2\n"
            "exit 97\n",
            encoding="utf-8",
        )
        fake_python.chmod(0o755)
        fake_git = self.bin / "git"
        fake_git.write_text(
            "#!/usr/bin/env bash\n"
            "if [[ \"$*\" == *'rev-parse --show-toplevel'* ]]; then printf '%s\\n' \"$TEST_REPO_ROOT\"; exit 0; fi\n"
            "exit 97\n",
            encoding="utf-8",
        )
        fake_git.chmod(0o755)

        self.run_bash(
            'source "$PLFR_RELEASE_RUNTIME"; plfr_publish_tls_pair "$PLFR_CONFIG_ROOT/tls" "$OLD_CERT" "$OLD_KEY"',
            {"OLD_CERT": str(old_cert), "OLD_KEY": str(old_key)},
            check=True,
        )
        old_tls_target = os.readlink(self.tls / "current")

        # Use per-test markers for the actual install-hook `up`; image inspection and
        # Compose config remain local fake commands with no Docker daemon access.
        env = {
            **self.env,
            "PLFR_ACME_ROOT": str(acme_root),
            "PLFR_ACME_ENV_FILE": str(acme_env_file),
            "PLFR_ACME_STATE_LOCK_FILE": str(self.acme_state_lock),
            "PLFR_LEGO_BIN": str(fake_lego),
            "PLFR_TLS_INSTALL_HOOK": str(ROOT / "scripts/production/certbot-deploy-hook.sh"),
            "LEGO_READY": str(lego_ready),
            "LEGO_RELEASE": str(lego_release),
            "DOCKER_UP_READY": str(docker_ready),
            "DOCKER_UP_RELEASE": str(docker_release),
            "BLOCK_DOCKER_UP": "1",
            "DEPLOY_VERIFIER_REACHED": str(verifier_marker),
            "TEST_REPO_ROOT": str(ROOT),
        }
        self._prepare_root_owned_acme_files((acme_root, acme_env_file, api_key_file, secret_file))
        renew_process = subprocess.Popen(
            self._root_command(ROOT / "scripts/production/renew-production-certificate.sh", env),
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        try:
            self._wait_for_path(lego_ready, renew_process, "renewal did not enter the fake Lego call")
            first_deploy = subprocess.run(
                self._root_command(ROOT / "scripts/production/deploy-release.sh", env, str(SHA), "1"),
                text=True, capture_output=True, check=False,
            )
            self.assertNotEqual(first_deploy.returncode, 0)
            self.assertIn("Another production release or TLS operation", first_deploy.stderr)
            docker_calls = self.docker_log.read_text(encoding="utf-8") if self.docker_log.exists() else ""
            self.assertNotIn(" up ", docker_calls)

            lego_release.touch()
            self._wait_for_path(docker_ready, renew_process, "the real TLS hook did not reach fake Docker up")
            second_deploy = subprocess.run(
                self._root_command(ROOT / "scripts/production/deploy-release.sh", env, str(SHA), "1"),
                text=True, capture_output=True, check=False,
            )
            self.assertNotEqual(second_deploy.returncode, 0)
            self.assertIn("Another production release or TLS operation", second_deploy.stderr)
            self.assertFalse(verifier_marker.exists(), "competing deploy must fail before GitHub verification")

            docker_release.touch()
            stdout, stderr = renew_process.communicate(timeout=20)
        finally:
            lego_release.touch()
            docker_release.touch()
            if renew_process.poll() is None:
                stdout, stderr = renew_process.communicate(timeout=20)

        self.assertEqual(renew_process.returncode, 0, stderr or stdout)
        self.assertIn("exact current edge is healthy", stdout)
        self.assertNotEqual(os.readlink(self.tls / "current"), old_tls_target)
        self.assertEqual(self.docker_log.read_text(encoding="utf-8").count(" up "), 1)
        self.assertEqual(len(self.curl_log.read_text(encoding="utf-8").splitlines()), 3)

    def _root_command(self, program, env, *args):
        allowlist = (
            "PATH", "PLFR_CONFIG_ROOT", "PLFR_APP_ROOT", "PLFR_RELEASE_LOCK_FILE",
            "PLFR_RELEASE_RUNTIME", "PLFR_ACME_STATE_LOCK_FILE", "PLFR_ACME_ROOT",
            "PLFR_ACME_ENV_FILE", "PLFR_LEGO_BIN", "PLFR_TLS_INSTALL_HOOK",
            "LEGO_READY", "LEGO_RELEASE", "DOCKER_UP_READY", "DOCKER_UP_RELEASE",
            "DEPLOY_VERIFIER_REACHED",
            "TEST_REPO_ROOT", "TEST_DEPLOY_SHA", "TEST_DB_VOLUME", "PYTHON_LOG",
            "CURRENT_FILE", "FAIL_CURRENT_MARKER_MOVE", "MARKER_MOVE_REACHED", "REAL_MV",
            "BLOCK_DOCKER_UP", "DOCKER_LOG", "CURL_LOG", "IMAGE_REVISION",
            "FAIL_MARKER", "FAIL_UP", "FAIL_UP_ONCE", "FAIL_CURL",
        )
        assignments = [f"{key}={env[key]}" for key in allowlist if key in env]
        prefix = [] if (not hasattr(os, "geteuid") or os.geteuid() == 0) else [shutil.which("sudo"), "-n"]
        return [*prefix, "env", *assignments, str(program), *args]

    def _prepare_root_owned_acme_files(self, paths):
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            for path in paths:
                os.chown(path, 0, 0)
                if path.is_dir():
                    for current, directories, files in os.walk(path):
                        for child in [*directories, *files]:
                            os.chown(Path(current) / child, 0, 0)
        else:
            subprocess.run(
                [shutil.which("sudo"), "-n", "chown", "-R", "0:0", *(str(path) for path in paths)],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
        for path in paths:
            if path.is_dir():
                mode = 0o700
            else:
                mode = 0o600
            if hasattr(os, "geteuid") and os.geteuid() == 0:
                path.chmod(mode)
            else:
                subprocess.run(
                    [shutil.which("sudo"), "-n", "chmod", f"{mode:o}", str(path)],
                    check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                )

    def _set_file_metadata(self, path, owner, group, mode):
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            os.chown(path, owner, group)
            os.chmod(path, mode)
            return
        subprocess.run(
            [shutil.which("sudo"), "-n", "chown", f"{owner}:{group}", str(path)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        subprocess.run(
            [shutil.which("sudo"), "-n", "chmod", f"{mode:o}", str(path)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )

    def _run_privileged(self, arguments):
        prefix = [] if (not hasattr(os, "geteuid") or os.geteuid() == 0) else [shutil.which("sudo"), "-n"]
        return subprocess.run(
            [*prefix, *arguments], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )

    def _run_privileged_output(self, arguments):
        return self._run_privileged(arguments).stdout

    def _remove_privileged_paths(self, *paths):
        root = self.root.resolve()
        existing = []
        for path in paths:
            resolved_parent = path.parent.resolve()
            if resolved_parent != root and root not in resolved_parent.parents:
                raise AssertionError("Privileged cleanup path escaped its temporary test directory.")
            resolved = path.resolve(strict=False)
            if resolved == root or root not in resolved.parents:
                raise AssertionError("Privileged cleanup refused a path outside its temporary test directory.")
            if path.exists() or path.is_symlink():
                existing.append(str(path))
        if existing:
            self._run_privileged(["rm", "-rf", "--", *existing])

    def _restore_temp_root_ownership(self):
        if os.name == "nt" or not hasattr(os, "geteuid") or os.geteuid() == 0:
            return
        sudo = shutil.which("sudo")
        if not sudo:
            return
        root = self.root.resolve(strict=True)
        temp_root = Path(tempfile.gettempdir()).resolve(strict=True)
        if root.parent != temp_root or not root.name.startswith("plfr-release-runtime-"):
            raise AssertionError("Privileged test cleanup refused a path outside its disposable temp directory.")
        subprocess.run(
            [sudo, "-n", "chown", "-R", f"{os.getuid()}:{os.getgid()}", "--", str(root)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )

    def _wait_for_path(self, path, process, failure, timeout=10):
        deadline = time.monotonic() + timeout
        while not path.exists() and time.monotonic() < deadline and process.poll() is None:
            time.sleep(0.01)
        if not path.exists():
            stderr = process.stderr.read() if process.poll() is not None and process.stderr else ""
            stdout = process.stdout.read() if process.poll() is not None and process.stdout else ""
            self.fail(f"{failure}; return={process.poll()}; stdout={stdout!r}; stderr={stderr!r}")

    def test_tls_install_hook_holds_shared_lock_through_exact_edge_restart(self):
        old_cert, old_key = self.make_certificate_pair("concurrent-old")
        new_cert, new_key = self.make_certificate_pair("concurrent-new")
        publish = 'source "$PLFR_RELEASE_RUNTIME"; plfr_publish_tls_pair "$TLS_ROOT" "$CERT" "$KEY"'
        old_pair = self.run_bash(publish, {
            "TLS_ROOT": str(self.tls), "CERT": str(old_cert), "KEY": str(old_key),
        })
        self.assertEqual(old_pair.returncode, 0, old_pair.stderr)
        old_target = os.readlink(self.tls / "current")

        ready = self.root / "docker-up-ready"
        release = self.root / "allow-docker-up-to-finish"
        tls_command = (
            'set -Eeuo pipefail; source "$PLFR_RELEASE_RUNTIME"; plfr_acquire_release_lock; '
            'plfr_install_tls_pair_and_restart "$TLS_ROOT" "$CERT" "$KEY"'
        )
        env = {
            **self.env,
            "CERT": str(new_cert),
            "KEY": str(new_key),
            "TLS_ROOT": str(self.tls),
            "BLOCK_DOCKER_UP": "1",
            "DOCKER_UP_READY": str(ready),
            "DOCKER_UP_RELEASE": str(release),
        }
        tls_process = subprocess.Popen(
            [self.bash, "-c", tls_command], env=env, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(ready.exists(), "TLS hook did not reach the exact-edge restart")

            deployment = self.run_bash(
                'set -Eeuo pipefail; source "$PLFR_RELEASE_RUNTIME"; plfr_acquire_release_lock; plfr_restart_current_edge'
            )
            self.assertNotEqual(
                deployment.returncode,
                0,
                f"deployment must not enter the edge restart concurrently; stdout={deployment.stdout!r}, stderr={deployment.stderr!r}",
            )
            self.assertEqual(self.docker_log.read_text(encoding="utf-8").count(" up "), 1)
        finally:
            release.touch()
            stdout, stderr = tls_process.communicate(timeout=10)

        self.assertEqual(tls_process.returncode, 0, stderr or stdout)
        self.assertIn("exact current edge is healthy", stdout)
        current_pair = os.readlink(self.tls / "current")
        self.assertNotEqual(current_pair, old_target)
        self.assertTrue((self.tls / current_pair / "tls.crt").is_file())
        self.assertEqual(self.docker_log.read_text(encoding="utf-8").count(" up "), 1)

    def make_certificate_pair(self, name):
        certificate = self.root / f"{name}.crt"
        key = self.root / f"{name}.key"
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
            "-keyout", str(key), "-out", str(certificate), "-subj", f"/CN={name}",
            "-addext", "subjectAltName=DNS:mapa-svietidiel.sk,DNS:www.mapa-svietidiel.sk,DNS:panel.mapa-svietidiel.sk",
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return certificate, key

    def test_tls_pairs_are_versioned_and_published_with_one_symlink_switch(self):
        old_cert, old_key = self.make_certificate_pair("old")
        new_cert, new_key = self.make_certificate_pair("new")
        publish = 'source "$PLFR_RELEASE_RUNTIME"; plfr_publish_tls_pair "$TLS_ROOT" "$CERT" "$KEY"'
        first = self.run_bash(publish, {"TLS_ROOT": str(self.tls), "CERT": str(old_cert), "KEY": str(old_key)})
        self.assertEqual(first.returncode, 0, first.stderr)
        old_target = os.readlink(self.tls / "current")
        self.assertTrue((self.tls / old_target / "tls.crt").is_file())
        mismatch = self.run_bash(publish, {"TLS_ROOT": str(self.tls), "CERT": str(old_cert), "KEY": str(new_key)})
        self.assertNotEqual(mismatch.returncode, 0)
        self.assertEqual(os.readlink(self.tls / "current"), old_target)

        second = self.run_bash(publish, {"TLS_ROOT": str(self.tls), "CERT": str(new_cert), "KEY": str(new_key)})
        self.assertEqual(second.returncode, 0, second.stderr)
        new_target = os.readlink(self.tls / "current")
        self.assertNotEqual(new_target, old_target)
        self.assertTrue((self.tls / new_target / "tls.crt").is_file())
        self.assertTrue((self.tls / new_target / "tls.key").is_file())
        self.assertTrue((self.tls / old_target / "tls.key").is_file(), "prior TLS pair must remain available for rollback")

    def test_failed_tls_restart_restores_prior_pair_and_restarts_exact_release(self):
        old_cert, old_key = self.make_certificate_pair("old-rollback")
        new_cert, new_key = self.make_certificate_pair("new-rollback")
        publish = 'source "$PLFR_RELEASE_RUNTIME"; plfr_publish_tls_pair "$TLS_ROOT" "$CERT" "$KEY"'
        first = self.run_bash(publish, {"TLS_ROOT": str(self.tls), "CERT": str(old_cert), "KEY": str(old_key)})
        self.assertEqual(first.returncode, 0, first.stderr)
        old_target = os.readlink(self.tls / "current")
        install = 'source "$PLFR_RELEASE_RUNTIME"; plfr_acquire_release_lock; plfr_install_tls_pair_and_restart "$TLS_ROOT" "$CERT" "$KEY"'
        result = self.run_bash(
            install,
            {"TLS_ROOT": str(self.tls), "CERT": str(new_cert), "KEY": str(new_key), "FAIL_UP_ONCE": "1"},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(os.readlink(self.tls / "current"), old_target)
        self.assertIn("Previous TLS pair and the exact recorded edge were restored", result.stderr + result.stdout)
        self.assertEqual(self.docker_log.read_text(encoding="utf-8").count(" up "), 2)


if __name__ == "__main__":
    unittest.main()
