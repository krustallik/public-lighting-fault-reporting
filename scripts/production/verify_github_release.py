#!/usr/bin/env python3
"""Fail-closed exact-master/exact-CI verifier for production deployment."""

import json
import sys
import urllib.error
import urllib.request

REPOSITORY = "krustallik/public-lighting-fault-reporting"
CI_WORKFLOW_ID = 373985460
CI_WORKFLOW_PATH = ".github/workflows/ci.yml"
REQUIRED_JOBS = {
    "frontend",
    "backend",
    "sqlfluff-report",
    "dependency-audit-report",
    "process-egress-research",
    "browser-e2e",
}


def get_json(path: str):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/{path}",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "public-lighting-production-release-gate",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        raise RuntimeError("GitHub release evidence could not be verified.") from error


def main() -> int:
    if len(sys.argv) != 3:
        raise RuntimeError("Expected a commit SHA and GitHub Actions run ID.")
    sha, run_id = sys.argv[1:]
    if len(sha) != 40 or any(char not in "0123456789abcdef" for char in sha):
        raise RuntimeError("Release commit SHA is malformed.")
    if not run_id.isdecimal():
        raise RuntimeError("GitHub Actions run ID is malformed.")

    branch = get_json("commits/master")
    if branch.get("sha") != sha:
        raise RuntimeError("Release commit is no longer the exact master HEAD.")

    run = get_json(f"actions/runs/{run_id}")
    if (
        run.get("head_sha") != sha
        or run.get("head_branch") != "master"
        or run.get("event") != "push"
        or run.get("status") != "completed"
        or run.get("conclusion") != "success"
        or run.get("workflow_id") != CI_WORKFLOW_ID
        or run.get("path") != CI_WORKFLOW_PATH
        or (run.get("head_repository") or {}).get("full_name", "").lower() != REPOSITORY
        or (run.get("repository") or {}).get("full_name", "").lower() != REPOSITORY
    ):
        raise RuntimeError("The supplied CI run does not prove successful exact-master CI.")

    jobs_response = get_json(f"actions/runs/{run_id}/jobs?per_page=100")
    jobs = jobs_response.get("jobs", [])
    by_name = {job.get("name"): job for job in jobs}
    if not REQUIRED_JOBS.issubset(by_name):
        raise RuntimeError("The exact-master CI run is missing a required job.")
    if any(job.get("conclusion") != "success" for job in jobs):
        raise RuntimeError("At least one exact-master CI job did not succeed.")
    if any(by_name[name].get("status") != "completed" for name in REQUIRED_JOBS):
        raise RuntimeError("A required exact-master CI job has not completed.")

    print(f"Release gate passed for {sha}: master HEAD and all {len(jobs)} CI jobs succeeded.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
