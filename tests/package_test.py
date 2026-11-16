import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as temp:
    out = Path(temp)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
    subprocess.run(['python3', 'scripts/package.py', temp, '--commit', commit], check=True)
    metadata = json.loads((ROOT / 'metadata.json').read_text())
    uuid = metadata['uuid']
    with zipfile.ZipFile(out / f'{uuid}.shell-extension.zip') as bundle:
        files = {name: bundle.read(name) for name in bundle.namelist()}
    with tarfile.open(out / 'jabra-gnome-integration.tar.gz') as bundle:
        portable = {str(Path(item.name).relative_to(uuid)): bundle.extractfile(item).read()
                    for item in bundle.getmembers() if item.isfile()}
    assert files == portable, 'GNOME and Homebrew payloads diverged'
    assert set(p.name for p in ROOT.glob('*.js')) <= files.keys(), 'Runtime module missing'
    assert 'schemas/gschemas.compiled' in files, 'Homebrew requires precompiled settings'
    assert not any(name.startswith(('tests/', 'scripts/', '.git/')) for name in files)
    assert json.loads(files['metadata.json'])['version-name'] == commit
    for name, contents in files.items():
        if name.endswith('.js'):
            import re
            for module in re.findall(r"from ['\"]\./([^'\"]+)['\"]", contents.decode()):
                assert module in files, f'Unpackaged runtime import {module}'
    print('PASS identical, complete GNOME/Homebrew payloads and commit identity')
