#!/usr/bin/env python3
"""Exercise the real GIO transport against a controlled Unix socket service."""
import asyncio
import json
import os
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[1]


async def main():
    state = {'devices': [], 'connects': 0, 'delay': 0, 'failConnect': False}

    async def handle(reader, writer):
        try:
            while line := await reader.readline():
                request = json.loads(line)
                method = request['method']
                error = None
                if method == 'test.set':
                    state.update(request['params'])
                    result = True
                elif method == 'test.stats':
                    result = dict(state)
                elif method == 'bt.list':
                    result = state['devices']
                    await asyncio.sleep(state['delay'] / 1000)
                elif method == 'bt.connect':
                    state['connects'] += 1
                    result = True
                    if state['failConnect']:
                        error = {'message': 'Headset out of range'}
                elif method in ('subscribe', 'service.ping'):
                    result = True
                else:
                    error = {'message': 'Unknown method'}
                reply = {'jsonrpc': '2.0', 'id': request['id']}
                reply.update({'error': error} if error else {'result': result})
                writer.write((json.dumps(reply) + '\n').encode())
                await writer.drain()
        except (ConnectionError, BrokenPipeError):
            pass
        finally:
            writer.close()

    with tempfile.TemporaryDirectory() as temp:
        socket = str(Path(temp) / 'jabridge.sock')
        server = await asyncio.start_unix_server(handle, socket)
        async with server:
            process = await asyncio.create_subprocess_exec(
                'gjs', '-m', str(ROOT / 'tests/run.js'),
                env={**os.environ, 'JABRIDGE_SOCKET': socket})
            code = await asyncio.wait_for(process.wait(), timeout=30)
            if code:
                raise SystemExit(code)


asyncio.run(main())
