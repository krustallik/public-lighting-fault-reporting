import contextlib
import copy
import io
import json
import os
from pathlib import Path
import tempfile
import sys
import urllib.request
import unittest
from unittest.mock import patch

import verify_github_release as verifier


SHA = "0123456789abcdef0123456789abcdef01234567"
RUN_ID = "123456"
REQUIRED = verifier.REQUIRED_JOBS


def successful_evidence():
    return {
        "commits/master": {"sha": SHA},
        f"actions/runs/{RUN_ID}": {
            "head_sha": SHA,
            "head_branch": "master",
            "event": "push",
            "status": "completed",
            "conclusion": "success",
            "workflow_id": verifier.CI_WORKFLOW_ID,
            "path": verifier.CI_WORKFLOW_PATH,
            "head_repository": {"full_name": verifier.REPOSITORY},
            "repository": {"full_name": verifier.REPOSITORY},
        },
        f"actions/runs/{RUN_ID}/jobs?per_page=100": {
            "jobs": [{"name": name, "status": "completed", "conclusion": "success"} for name in sorted(REQUIRED)]
        },
    }


class ExactReleaseGateTests(unittest.TestCase):
    def run_gate(self, evidence):
        with patch.object(sys, "argv", ["verify_github_release.py", SHA, RUN_ID]):
            with patch.object(verifier, "get_json", side_effect=lambda path: evidence[path]):
                return verifier.main()

    def test_accepts_exact_master_and_all_required_successful_jobs(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.run_gate(successful_evidence()), 0)

    def test_rejects_when_master_has_advanced(self):
        evidence = successful_evidence()
        evidence["commits/master"] = {"sha": "f" * 40}
        with self.assertRaisesRegex(RuntimeError, "no longer the exact master HEAD"):
            self.run_gate(evidence)

    def test_rejects_missing_required_job(self):
        evidence = successful_evidence()
        evidence[f"actions/runs/{RUN_ID}/jobs?per_page=100"]["jobs"].pop()
        with self.assertRaisesRegex(RuntimeError, "missing a required job"):
            self.run_gate(evidence)

    def test_rejects_a_failed_or_skipped_job_even_if_required_jobs_pass(self):
        evidence = successful_evidence()
        evidence[f"actions/runs/{RUN_ID}/jobs?per_page=100"]["jobs"].append(
            {"name": "unexpected-job", "conclusion": "skipped"}
        )
        with self.assertRaisesRegex(RuntimeError, "At least one exact-master CI job"):
            self.run_gate(evidence)

    def test_rejects_non_push_or_wrong_repository_runs(self):
        evidence = successful_evidence()
        evidence[f"actions/runs/{RUN_ID}"]["event"] = "pull_request"
        with self.assertRaisesRegex(RuntimeError, "does not prove successful exact-master CI"):
            self.run_gate(evidence)

    def test_rejects_same_display_name_with_different_workflow_identity(self):
        evidence = successful_evidence()
        evidence[f"actions/runs/{RUN_ID}"]["workflow_id"] += 1
        with self.assertRaisesRegex(RuntimeError, "does not prove successful exact-master CI"):
            self.run_gate(evidence)

    def test_rejects_wrong_workflow_path(self):
        evidence = successful_evidence()
        evidence[f"actions/runs/{RUN_ID}"]["path"] = ".github/workflows/other.yml"
        with self.assertRaisesRegex(RuntimeError, "does not prove successful exact-master CI"):
            self.run_gate(evidence)

    def test_rejects_foreign_run_repository(self):
        evidence = successful_evidence()
        evidence[f"actions/runs/{RUN_ID}"]["repository"]["full_name"] = "attacker/fork"
        with self.assertRaisesRegex(RuntimeError, "does not prove successful exact-master CI"):
            self.run_gate(evidence)

    def test_rejects_required_job_that_is_not_completed(self):
        evidence = successful_evidence()
        evidence[f"actions/runs/{RUN_ID}/jobs?per_page=100"]["jobs"][0]["status"] = "in_progress"
        with self.assertRaisesRegex(RuntimeError, "required exact-master CI job has not completed"):
            self.run_gate(evidence)


def workflow_verifier_source():
    workflow = Path(__file__).resolve().parents[2] / ".github/workflows/deploy-production.yml"
    text = workflow.read_text(encoding="utf-8")
    section = text.split("      - name: Verify exact master SHA and every CI job", 1)[1]
    start = section.index("          python3 - <<'PY'\n") + len("          python3 - <<'PY'\n")
    lines = []
    for line in section[start:].splitlines():
        if line.strip() == "PY":
            break
        lines.append(line[10:] if line.startswith("          ") else line)
    else:
        raise AssertionError("Could not locate the workflow's inline release-verifier script.")
    return "\n".join(lines) + "\n"


class WorkflowReleaseGateTests(unittest.TestCase):
    def run_workflow_gate(self, evidence):
        source = workflow_verifier_source()
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False) as output:
            output_path = output.name

        def fake_open(request, timeout):
            path = request.full_url.rsplit(f"/repos/{verifier.REPOSITORY}/", 1)[1]
            return _JsonResponse(evidence[path])

        environment = {
            "GH_TOKEN": "synthetic-token",
            "REPOSITORY": verifier.REPOSITORY,
            "RUN_ID": RUN_ID,
            "RELEASE_SHA": SHA,
            "GITHUB_OUTPUT": output_path,
        }
        try:
            with patch.dict(os.environ, environment), patch.object(urllib.request, "urlopen", side_effect=fake_open):
                exec(compile(source, "deploy-production.yml inline verifier", "exec"), {"__name__": "__main__"})
            return Path(output_path).read_text(encoding="utf-8")
        finally:
            Path(output_path).unlink(missing_ok=True)

    def test_accepts_exact_master_push_with_canonical_workflow_and_all_jobs(self):
        output = self.run_workflow_gate(successful_evidence())
        self.assertIn(f"sha={SHA}\nrun_id={RUN_ID}\n", output)

    def test_rejects_same_display_name_with_wrong_workflow_identity_or_path(self):
        for field, value in (("workflow_id", verifier.CI_WORKFLOW_ID + 1), ("path", ".github/workflows/other.yml")):
            evidence = copy.deepcopy(successful_evidence())
            evidence[f"actions/runs/{RUN_ID}"][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(SystemExit, "not a successful push"):
                self.run_workflow_gate(evidence)

    def test_rejects_stale_sha_failed_or_missing_job_pr_event_and_foreign_repository(self):
        cases = []
        stale = copy.deepcopy(successful_evidence())
        stale["commits/master"]["sha"] = "f" * 40
        cases.append(("stale SHA", stale, "no longer the current master"))

        failed = copy.deepcopy(successful_evidence())
        failed[f"actions/runs/{RUN_ID}/jobs?per_page=100"]["jobs"][0]["conclusion"] = "failure"
        cases.append(("failed job", failed, "job did not succeed"))

        missing = copy.deepcopy(successful_evidence())
        missing[f"actions/runs/{RUN_ID}/jobs?per_page=100"]["jobs"].pop()
        cases.append(("missing job", missing, "missing required job"))

        unfinished = copy.deepcopy(successful_evidence())
        unfinished[f"actions/runs/{RUN_ID}/jobs?per_page=100"]["jobs"][0]["status"] = "in_progress"
        cases.append(("unfinished job", unfinished, "required CI job has not completed"))

        pr = copy.deepcopy(successful_evidence())
        pr[f"actions/runs/{RUN_ID}"]["event"] = "pull_request"
        cases.append(("PR event", pr, "not a successful push"))

        foreign = copy.deepcopy(successful_evidence())
        foreign[f"actions/runs/{RUN_ID}"]["repository"]["full_name"] = "foreign/fork"
        cases.append(("foreign repository", foreign, "not a successful push"))

        for name, evidence, reason in cases:
            with self.subTest(name=name), self.assertRaisesRegex(SystemExit, reason):
                self.run_workflow_gate(evidence)


class _JsonResponse:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.value).encode("utf-8")


if __name__ == "__main__":
    unittest.main()
