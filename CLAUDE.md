# Working rules for Claude

Davy's rules for every change in this repo. GitHub Actions minutes are limited, so tests run in Claude's sandbox and GitHub runs once, at the end.

1. **Work on a branch.** Never commit straight to `timesheet-manager-clean-suite-v1`. Make a branch (for example `claude/<short-name>`) and batch commits on it — a few meaningful commits, not one per file.
2. **Run tests in the sandbox.** While working, test in Claude's own sandbox: the tests in `tests/` and `backend_test.py`. Fix failures there, not on GitHub.
3. **Nothing on GitHub until Davy says it's done.** Don't push to `timesheet-manager-clean-suite-v1`, don't start a GitHub Actions run and don't open a pull request until Davy says the work is done. Pushing the working branch is fine: every workflow here is manual only (`workflow_dispatch`), so a push starts nothing. Never add `push`, `pull_request` or `schedule` triggers to a workflow.
4. **One GitHub run at the end.** This repo has no GitHub workflow, so there's nothing to run on GitHub — tell Davy that when the work is done. Don't add a workflow unless he asks; if he does, make it `workflow_dispatch` only and tell him roughly how many minutes a run will use.
5. **Never push to `timesheet-manager-clean-suite-v1` between 5am and 6pm NZ time** (Pacific/Auckland), any day — even after Davy says it's done. Outside those hours, push to `timesheet-manager-clean-suite-v1` only once Davy has said it's done.
