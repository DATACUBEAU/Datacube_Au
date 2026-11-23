import argparse
import json
import re
import statistics
import subprocess
from pathlib import Path


PACKAGE = 'au.datacube.app'
APP_TEST = f'{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner'
PROBE = 'au.datacube.startupprobe/.StartupProbe'
FIRST_FRAME_BUDGET_MS = 1_200
SAMPLES = 5


def adb(*args):
    return subprocess.check_output(['adb', *args], text=True, timeout=90)


def uninstall(package):
    subprocess.run(['adb', 'uninstall', package], capture_output=True, timeout=30, check=False)


def pid():
    result = subprocess.run(
        ['adb', 'shell', 'pidof', PACKAGE], capture_output=True, text=True, timeout=30, check=False,
    )
    return result.stdout.strip()


def measure(screen, launch):
    if launch == 'COLD':
        adb('shell', 'am', 'force-stop', PACKAGE)
        if pid():
            raise RuntimeError('Target process remained alive before a cold launch')
    else:
        adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME')
    process_before = pid()
    result = adb('shell', 'am', 'instrument', '-w', '-e', 'screen', screen, PROBE)
    values = dict(re.findall(r'^INSTRUMENTATION_RESULT: (\w+)=(.*)$', result, re.MULTILINE))
    if values.get('launch_state') != launch or 'screen_ready_ms' not in values:
        raise RuntimeError(f'Expected {launch} {screen} launch.\n{result}')
    if launch == 'WARM' and (not process_before or process_before != pid()):
        raise RuntimeError('Target process changed during a warm launch')
    sample = {key: int(values[key]) for key in ('first_frame_ms', 'screen_ready_ms')}
    print(f'{launch} {screen}: {sample}', flush=True)
    return sample


def measure_build(apk, test_apk):
    uninstall(f'{PACKAGE}.test')
    uninstall(PACKAGE)
    adb('install', apk)
    adb('install', '-t', test_apk)

    measure('login', 'COLD')
    cold = [measure('login', 'COLD') for _ in range(SAMPLES)]
    warm = [measure('login', 'WARM') for _ in range(SAMPLES)]

    fixture = adb(
        'shell', 'am', 'instrument', '-w', '-e', 'class',
        f'{PACKAGE}.auth.StartupSessionFixture#seedEncryptedSession', '-e', 'startupFixture', '1', APP_TEST,
    )
    if 'OK (1 test)' not in fixture:
        raise RuntimeError(f'Could not prepare encrypted session fixture.\n{fixture}')
    measure('home', 'COLD')
    home = [measure('home', 'COLD') for _ in range(SAMPLES)]
    return {'cold_login': cold, 'warm_login': warm, 'cold_home': home}


def report(baseline, final, note):
    rows = [
        '# Android startup comparison',
        '',
        'Median milliseconds across five launches per scenario on the same Android 35 x86_64 emulator.',
        'First frame uses Android `am start -W` TotalTime. Screen readiness is first observed accessibility state.',
        'Home starts with an encrypted, unexpired local test session and no live authentication service.',
        '',
        '| Measurement | Baseline | Final | Change |',
        '|---|---:|---:|---:|',
    ]
    for scenario, name in (('cold_login', 'Cold login'), ('warm_login', 'Warm login'), ('cold_home', 'Cold authenticated home')):
        for metric, label in (('first_frame_ms', 'first frame'), ('screen_ready_ms', 'screen ready')):
            before = statistics.median(sample[metric] for sample in baseline[scenario])
            after = statistics.median(sample[metric] for sample in final[scenario])
            rows.append(f'| {name}, {label} | {before} ms | {after} ms | {after - before:+} ms |')
    slower_cold_median = max(
        statistics.median(sample['first_frame_ms'] for sample in final[scenario])
        for scenario in ('cold_login', 'cold_home')
    )
    within_budget = slower_cold_median <= FIRST_FRAME_BUDGET_MS
    rows += ['', f'Cold first-frame budget: {FIRST_FRAME_BUDGET_MS} ms median per route. '
             f'Slower final median: {slower_cold_median} ms. {"Pass" if within_budget else "Fail"}.']
    if note:
        rows += ['', note]
    return '\n'.join(rows) + '\n', within_budget


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline-apk', required=True)
    parser.add_argument('--baseline-test-apk', required=True)
    parser.add_argument('--final-apk', required=True)
    parser.add_argument('--final-test-apk', required=True)
    parser.add_argument('--probe-apk', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    adb('install', '-t', args.probe_apk)
    baseline = measure_build(args.baseline_apk, args.baseline_test_apk)
    final = measure_build(args.final_apk, args.final_test_apk)
    (args.output / 'startup.json').write_text(json.dumps({'baseline': baseline, 'final': final}, indent=2) + '\n')
    model = adb('shell', 'getprop', 'ro.product.model').strip()
    summary, within_budget = report(baseline, final, f'Emulator model: `{model}`.')
    (args.output / 'startup.md').write_text(summary)
    print(summary)
    if not within_budget:
        raise SystemExit('Cold first-frame budget exceeded')


if __name__ == '__main__':
    main()
