// SPDX-License-Identifier: GPL-2.0-or-later
//
// Minimal client for the jabridge service's JSON-RPC Unix socket
// (https://github.com/Watchdog0x/jabridge/blob/main/docs/IPC.md).
// Uses only Gio/GLib so it also runs under plain gjs.

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

/** Sends one request on its own connection and returns its result. */
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
                continue; // a notification
            if (reply.error)
                throw new Error(reply.error.message ?? 'jabridge error');
            return reply.result;
        }
    } finally {
        conn.close(null);
    }
}

/**
 * Keeps a subscription to jabridge notifications open, reconnecting when the
 * service restarts. onEvent(method, params) gets every notification;
 * onSubscribed() runs after each (re)subscribe so callers can reload state.
 */
export class EventStream {
    constructor({onEvent = () => {}, onSubscribed = () => {}} = {}) {
        this._onEvent = onEvent;
        this._onSubscribed = onSubscribed;
        this._generation = 0;
        this._cancellable = null;
        this._pingId = 0;
        this._waitId = 0;
        this._wake = null;
    }

    start() {
        if (this._cancellable)
            return;
        this._cancellable = new Gio.Cancellable();
        this._run(++this._generation, this._cancellable);
    }

    stop() {
        this._generation++;
        this._cancellable?.cancel();
        this._cancellable = null;
        this._clearPing();
        if (this._waitId) {
            GLib.source_remove(this._waitId);
            this._waitId = 0;
        }
        this._wake?.();
        this._wake = null;
    }

    _clearPing() {
        if (this._pingId) {
            GLib.source_remove(this._pingId);
            this._pingId = 0;
        }
    }

    async _run(generation, cancellable) {
        while (generation === this._generation) {
            let conn = null;
            try {
                conn = await new Gio.SocketClient().connect_async(
                    Gio.UnixSocketAddress.new(socketPath()), cancellable);
                await writeMessage(conn, {id: 1, method: 'subscribe'}, cancellable);
                this._pingId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PING_SECONDS, () => {
                    writeMessage(conn, {id: 2, method: 'service.ping'}, cancellable).catch(() => {});
                    return GLib.SOURCE_CONTINUE;
                });
                const input = new Gio.DataInputStream({base_stream: conn.get_input_stream()});
                const decoder = new TextDecoder();
                for (;;) {
                    const message = await readMessage(input, decoder, cancellable);
                    if (generation !== this._generation)
                        return;
                    if (message.id === 1 && message.result)
                        this._onSubscribed();
                    else if (message.method)
                        this._onEvent(message.method, message.params);
                }
            } catch (error) {
                if (isCancelled(error))
                    return;
            } finally {
                this._clearPing();
                conn?.close(null);
            }
            if (generation !== this._generation)
                return;
            await new Promise(resolve => {
                this._wake = resolve;
                this._waitId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RECONNECT_SECONDS, () => {
                    this._waitId = 0;
                    resolve();
                    return GLib.SOURCE_REMOVE;
                });
            });
            this._wake = null;
        }
    }
}
