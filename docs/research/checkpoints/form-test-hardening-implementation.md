# FORM TEST HARDENING — Combined implementation checkpoint

- **Status:** In progress; implementation and independent result audit are not complete.
- **Repository base:** `master` at `f6c873d9dba331a456e5d7b4ec30fea26a4f6b4b` (Phase 1 documentation closeout merged).
- **Working branch:** `test/form-hardening-combined`.
- **Product boundary:** Service `2` / VO only. Service `16` / CSS remains out of product scope.
- **Safety boundary:** Synthetic and loopback fixtures only. No AUSEMIO request, issue creation, production submit, real PII, or real files.
- **Phase 1:** Implementation CLOSED; canonical checkpoint `form-test-hardening-phase-1.md` says CLOSED on the base.

## Process-egress research gate

### Research before CI evidence

The proposed mechanism isolates only a child process tree in a Linux network namespace. The GitHub Actions runner, job controller, checkout, and dependency/setup steps stay outside that namespace. The isolated namespace brings up loopback but has no non-loopback interface or route. Synthetic frontend and backend processes communicate only over `127.0.0.1`; the test process, both Node child processes, and headless Chrome attempt outbound access to the reserved-purpose example host `example.com` on TCP 443. The probe host is resolved before entering the namespace. No AUSEMIO hostname or endpoint is used.

This mechanism is a hypothesis until the `process-egress-research` job succeeds on the repository's GitHub-hosted `ubuntu-24.04` runner. A local Windows run is not evidence for Linux network-namespace behavior.

The current official GitHub Actions Ubuntu 24.04 x64 image inventory lists Google Chrome and Chromium as preinstalled; the exact runner image and browser version will be recorded from the run. GitHub documents job/container options separately from the host runner. Neither documentation source establishes that this repository's namespace proof works; only the CI experiment can do that.

Evidence references:

- [GitHub Actions Ubuntu 24.04 runner image inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
- [GitHub Actions workflow syntax: job containers and options](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

### Current verdict

**PENDING actual CI run.** No browser E2E or accessibility dependency/code has been added. The research job's artifact should record the runner OS, Node/Chrome versions, loopback result, route table, and blocked outbound attempts. If any process reaches the synthetic external endpoint, or browser/loopback evidence is ambiguous, the gate fails and browser E2E remains blocked.
