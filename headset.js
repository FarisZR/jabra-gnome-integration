// SPDX-License-Identifier: GPL-2.0-or-later
//
// Tracks whether the Jabra Link dongle's headset is connected, reports when it
// disconnects, and (when auto-connect is on) keeps asking the dongle to connect
// it. No GNOME Shell imports, so it also runs under plain gjs.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventStream, isCancelled, rpc} from './jabridge.js';

const CHECK_SECONDS = 5; // fallback poll; events usually arrive first
const RETRY_SECONDS = 10; // between connect attempts
const REFRESH_EVENTS = new Set(['device.pairing.update', 'device.attached', 'device.detached']);

/**
 * onState({connected, headset, connecting, message})
 *   connected is true, false or null (unknown: jabridge unreachable)
 * onDisconnect(headsetName)
 *   the headset went from connected to disconnected
 */
export class HeadsetMonitor {
    constructor({autoConnect = true, preferredName = '', onState = () => {}, onDisconnect = () => {}} = {}) {
        this._autoConnect = autoConnect;
        this.preferredName = preferredName;
        this._onState = onState;
        this._onDisconnect = onDisconnect;
        this._connected = null;
        this._headset = null;
        this._nextAttempt = 0;
        this._cancellable = null;
        this._timeoutId = 0;
        this._busy = false;
        this._again = false;
        this._events = new EventStream({
            onEvent: method => {
                if (REFRESH_EVENTS.has(method))
                    this.refresh();
            },
            onSubscribed: () => this.refresh(),
        });
    }

    get autoConnect() {
        return this._autoConnect;
    }

    set autoConnect(value) {
        this._autoConnect = value;
        this._nextAttempt = 0; // turning it on tries right away
        this.refresh();
    }

    start() {
        if (this._cancellable)
            return;
        this._cancellable = new Gio.Cancellable();
        this._events.start();
        this.refresh();
    }

    stop() {
        this._events.stop();
        this._cancellable?.cancel();
        this._cancellable = null;
        this._clearTimeout();
    }

    /** Re-reads the state now. Calls made while one is running are merged. */
    refresh() {
        if (!this._cancellable)
            return;
        if (this._busy) {
            this._again = true;
            return;
        }
        this._busy = true;
        const cancellable = this._cancellable;
        this._refresh(cancellable).catch(logError).finally(() => {
            this._busy = false;
            if (this._again && !cancellable.is_cancelled()) {
                this._again = false;
                this.refresh();
            }
        });
    }

    _clearTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    async _list(cancellable) {
        try {
            return await rpc('bt.list', null, {timeout: 5, cancellable}) ?? [];
        } catch (error) {
            if (isCancelled(error))
                throw error;
            this._connected = null;
            this._emit({connecting: false, message: `jabridge service unavailable: ${error.message}`});
            return null;
        }
    }

    // Returns false when the state is unknown (jabridge unreachable).
    _apply(devices) {
        if (devices === null)
            return false;
        const connected = devices.find(d => d.connected);
        const wasConnected = this._connected;
        this._connected = Boolean(connected);
        if (connected)
            this._headset = connected.name;
        // Only an explicit "remembered but not connected" counts. An empty list
        // also appears while jabridge restarts, and pausing then would be wrong.
        if (wasConnected === true && !connected && devices.length > 0)
            this._onDisconnect(this._headset);
        return true;
    }

    _pick(devices) {
        const wanted = this.preferredName.trim().toLowerCase();
        return (wanted && devices.find(d => (d.name ?? '').toLowerCase().includes(wanted))) || devices[0];
    }

    async _refresh(cancellable) {
        this._clearTimeout();
        let message = null;
        try {
            let devices = await this._list(cancellable);
            const known = this._apply(devices);
            const now = GLib.get_monotonic_time();
            if (known && !this._connected && this._autoConnect && now >= this._nextAttempt) {
                const target = this._pick(devices);
                if (target) {
                    this._headset = target.name;
                    this._emit({connecting: true, message: `Connecting ${target.name}…`});
                    try {
                        // bt.connect disconnects any other remembered headset
                        // first, which is why it only runs when none is connected.
                        await rpc('bt.connect', {index: target.id}, {timeout: 25, cancellable});
                    } catch (error) {
                        if (isCancelled(error))
                            throw error;
                        message = error.message;
                    }
                    this._nextAttempt = GLib.get_monotonic_time() + RETRY_SECONDS * 1e6;
                    devices = await this._list(cancellable);
                    this._apply(devices);
                } else {
                    message = 'No headset is remembered by the Jabra Link dongle';
                }
            }
            if (devices !== null) {
                message ??= this._connected ? 'Connected' : 'Not connected';
                this._emit({connecting: false, message});
            }
        } catch (error) {
            if (isCancelled(error))
                return;
            throw error;
        }
        if (cancellable.is_cancelled())
            return;

        let delay = CHECK_SECONDS;
        if (this._connected === false && this._autoConnect)
            delay = Math.max(1, Math.ceil((this._nextAttempt - GLib.get_monotonic_time()) / 1e6));
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeoutId = 0;
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _emit({connecting, message}) {
        if (!this._cancellable)
            return;
        this._onState({connected: this._connected, headset: this._headset, connecting, message});
    }
}
