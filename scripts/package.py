#!/usr/bin/env python3
"""Build the local, GNOME and Homebrew payloads from the same runtime tree."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def stage(destination, commit=None):
    metadata = json.loads((ROOT / 'metadata.json').read_text())
    if commit:
        if not re.fullmatch('[0-9a-f]{40}', commit):
            raise ValueError('Expected a full Git commit hash')
        metadata['version-name'] = commit
        metadata['version'] = int(subprocess.check_output(
            ['git', '-C', str(ROOT), 'rev-list', '--count', commit], text=True))
    destination.mkdir(parents=True)
    for source in [*ROOT.glob('*.js'), ROOT / 'stylesheet.css', ROOT / 'LICENSE']:
        shutil.copy2(source, destination)
    (destination / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    shutil.copytree(ROOT / 'schemas', destination / 'schemas',
                    ignore=shutil.ignore_patterns('gschemas.compiled'))
    subprocess.run(['glib-compile-schemas', '--strict', str(destination / 'schemas')], check=True)
    return metadata['uuid']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--commit')
    parser.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    if args.stage:
        stage(args.output, args.commit)
        return
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        payload = Path(temp) / 'payload'
        uuid = stage(payload, args.commit)
        with zipfile.ZipFile(args.output / f'{uuid}.shell-extension.zip', 'w', zipfile.ZIP_DEFLATED) as bundle:
            for source in sorted(payload.rglob('*')):
                if source.is_file():
                    bundle.write(source, source.relative_to(payload))
        with tarfile.open(args.output / 'jabra-gnome-integration.tar.gz', 'w:gz') as bundle:
            bundle.add(payload, arcname=uuid)


if __name__ == '__main__':
    main()
