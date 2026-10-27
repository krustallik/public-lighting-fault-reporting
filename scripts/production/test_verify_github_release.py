import contextlib
import io
import sys
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
            "head_repository": {"full_name": verifier.REPOSITORY},
            "repository": {"full_name": verifier.REPOSITORY},
        },
        f"actions/runs/{RUN_ID}/jobs?per_page=100": {
            "jobs": [{"name": name, "conclusion": "success"} for name in sorted(REQUIRED)]
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


if __name__ == "__main__":
    unittest.main()
