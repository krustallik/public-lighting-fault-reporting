import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github' / 'workflows' / 'ci.yml'


def test_probe_preserves_run_id_required_by_shared_contained_environment() -> None:
    workflow = WORKFLOW.read_text(encoding='utf-8')
    step = re.search(
        r'      - name: Prove process egress isolation under a privilege-dropped identity\n(?P<body>.*?)(?=\n      - name: )',
        workflow,
        re.DOTALL,
    )
    assert step is not None, 'the process-egress probe workflow step must exist'

    preserve = re.search(r'sudo --preserve-env=([^\s]+)', step.group('body'))
    assert preserve is not None, 'the privileged probe must preserve its explicit environment allowlist'
    assert 'GITHUB_RUN_ID' in preserve.group(1).split(','), (
        'contained-workload.sh requires GITHUB_RUN_ID in its shared env -i block, including probe mode'
    )


if __name__ == '__main__':
    test_probe_preserves_run_id_required_by_shared_contained_environment()
    print('Contained workload probe environment regression guard passed.')
