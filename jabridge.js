// SPDX-License-Identifier: GPL-2.0-or-later
//
// Minimal client for the jabridge service's JSON-RPC Unix socket
// (https://github.com/Watchdog0x/jabridge/blob/main/docs/IPC.md).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.SocketClient.prototype, 'connect_async');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async');
Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async');

const RECONNECT_SECONDS = 5;
const PING_SECONDS = 15;

export function socketPath() {
    return GLib.getenv('JABRIDGE_SOCKET') ||
        GLib.build_filenamev([GLib.get_user_runtime_dir(), 'jabridge.sock']);
}

export function isCancelled(error) {
    return error instanceof GLib.Error &&
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

async function writeMessage(conn, message, cancellable) {
    const data = new TextEncoder().encode(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`);
    const written = await conn.get_output_stream().write_bytes_async(
        new GLib.Bytes(data), GLib.PRIORITY_DEFAULT, cancellable);
    if (written !== data.length)
        throw new Error('short write to jabridge');
}

async function readMessage(input, decoder, cancellable) {
    const [line] = await input.read_line_async(GLib.PRIORITY_DEFAULT, cancellable);
    if (line === null)
        throw new Error('jabridge closed the connection');
    return JSON.parse(decoder.decode(line));
}

export async function rpc(method, params = null, {timeout = 25, cancellable = null} = {}) {
    const client = new Gio.SocketClient({timeout});
    const conn = await client.connect_async(Gio.UnixSocketAddress.new(socketPath()), cancellable);
    try {
        await writeMessage(conn, params ? {id: 1, method, params} : {id: 1, method}, cancellable);
        const input = new Gio.DataInputStream({base_stream: conn.get_input_stream()});
        const decoder = new TextDecoder();
        for (;;) {
            const reply = await readMessage(input, decoder, cancellable);
            if (reply.id !== 1)
                continue;
            if (reply.error)
                throw new Error(reply.error.message ?? 'jabridge error');
            return reply.result;
        }
    } finally {
        conn.close(null);
    }
}

export class EventStream {
    constructor({onEvent = () => {}, onSubscribed = () => {}} = {}) {
        this._onEvent = onEvent;
        this._onSubscribed = onSubscribed;
        this._run = null;
    }

    start() {
        if (this._run)
            return;
        const run = {cancellable: new Gio.Cancellable(), pingId: 0, waitId: 0, wake: null};
        this._run = run;
        this._listen(run).catch(error =>
            console.warn(`Jabra Integration: event stream failed: ${error.message}`));
    }

    stop() {
        const run = this._run;
        this._run = null;
        if (!run)
            return;
        run.cancellable.cancel();
        this._clearPing(run);
        if (run.waitId)
            GLib.source_remove(run.waitId);
        run.wake?.();
    }

    _clearPing(run) {
        if (run.pingId) {
            GLib.source_remove(run.pingId);
            run.pingId = 0;
        }
    }

    async _listen(run) {
        while (run === this._run) {
            let conn = null;
            const cancellable = new Gio.Cancellable();
            const cancelId = run.cancellable.connect(() => cancellable.cancel());
            try {
                run.cancellable.set_error_if_cancelled();
                conn = await new Gio.SocketClient({timeout: 25}).connect_async(
                    Gio.UnixSocketAddress.new(socketPath()), cancellable);
                await writeMessage(conn, {id: 1, method: 'subscribe'}, cancellable);
                run.pingId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PING_SECONDS, () => {
                    writeMessage(conn, {id: 2, method: 'service.ping'}, cancellable)
                        .catch(() => cancellable.cancel());
                    return GLib.SOURCE_CONTINUE;
                });
                const input = new Gio.DataInputStream({base_stream: conn.get_input_stream()});
                const decoder = new TextDecoder();
                for (;;) {
                    const message = await readMessage(input, decoder, cancellable);
                    run.cancellable.set_error_if_cancelled();
                    if (message.id === 1) {
                        if (message.error)
                            throw new Error(message.error.message ?? 'Subscription rejected');
                        this._onSubscribed();
                    } else if (message.method) {
                        this._onEvent(message.method, message.params);
                    }
                }
            } catch (error) {
                if (run.cancellable.is_cancelled())
                    return;
                console.debug(`Jabra Integration: event stream reconnecting: ${error.message}`);
            } finally {
                run.cancellable.disconnect(cancelId);
                this._clearPing(run);
                try {
                    conn?.close(null);
                } catch (error) {
                    console.debug(`Jabra Integration: closing event stream: ${error.message}`);
                }
            }
            if (run !== this._run)
                return;
            await new Promise(resolve => {
                run.wake = resolve;
                run.waitId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RECONNECT_SECONDS, () => {
                    run.waitId = 0;
                    resolve();
                    return GLib.SOURCE_REMOVE;
                });
            });
            run.wake = null;
        }
    }
}
