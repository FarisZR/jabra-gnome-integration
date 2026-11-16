// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventStream, isCancelled, rpc} from './jabridge.js';
import {HeadsetState} from './headsetState.js';

const CHECK_SECONDS = 5;
const RETRY_SECONDS = 10;
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
        this._preferredName = preferredName;
        this._onState = onState;
        this._onDisconnect = onDisconnect;
        this._state = new HeadsetState();
        this._run = null;
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
        this._configurationChanged();
    }

    set preferredName(value) {
        this._preferredName = value;
        this._configurationChanged();
    }

    _configurationChanged() {
        if (this._run)
            this._run.nextAttempt = 0;
        this.refresh();
    }

    start() {
        if (this._run)
            return;
        this._state = new HeadsetState();
        this._run = {cancellable: new Gio.Cancellable(), timeoutId: 0,
            busy: false, again: false, nextAttempt: 0};
        this._events.start();
        this.refresh();
    }

    stop() {
        this._events.stop();
        const run = this._run;
        this._run = null;
        run?.cancellable.cancel();
        if (run?.timeoutId)
            GLib.source_remove(run.timeoutId);
    }

    refresh() {
        const run = this._run;
        if (!run)
            return;
        if (run.busy) {
            run.again = true;
            return;
        }
        if (run.timeoutId) {
            GLib.source_remove(run.timeoutId);
            run.timeoutId = 0;
        }
        run.busy = true;
        this._refresh(run).catch(error => {
            if (!isCancelled(error))
                console.warn(`Jabra Integration: refresh failed: ${error.message}`);
        }).finally(() => {
            if (run !== this._run)
                return;
            run.busy = false;
            if (run.again) {
                run.again = false;
                this.refresh();
            } else {
                run.timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CHECK_SECONDS, () => {
                    run.timeoutId = 0;
                    this.refresh();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
    }

    async _list(run) {
        let devices;
        let message;
        try {
            devices = await rpc('bt.list', null, {timeout: 5, cancellable: run.cancellable}) ?? [];
        } catch (error) {
            if (isCancelled(error))
                throw error;
            devices = null;
            message = `jabridge service unavailable: ${error.message}`;
        }
        // Cancellation may race a successful reply already queued by GIO.
        run.cancellable.set_error_if_cancelled();
        const disconnected = this._state.observe(devices);
        if (disconnected)
            this._onDisconnect(this._state.headset);
        if (devices === null)
            this._emit({connecting: false, message});
        return devices;
    }

    async _refresh(run) {
        let message = null;
        let devices = await this._list(run);
        if (devices === null)
            return;
        if (!this._state.connected && this._autoConnect &&
            GLib.get_monotonic_time() >= run.nextAttempt) {
            const target = this._state.select(devices, this._preferredName);
            if (target) {
                this._state.headset = target.name;
                this._emit({connecting: true, message: `Connecting ${target.name}…`});
                try {
                    // bt.connect disconnects other remembered headsets first.
                    await rpc('bt.connect', {index: target.id}, {timeout: 25, cancellable: run.cancellable});
                } catch (error) {
                    if (isCancelled(error))
                        throw error;
                    message = error.message;
                }
                run.cancellable.set_error_if_cancelled();
                run.nextAttempt = GLib.get_monotonic_time() + RETRY_SECONDS * 1e6;
                devices = await this._list(run);
            } else {
                message = 'No headset is remembered by the Jabra Link dongle';
            }
        }
        if (devices !== null) {
            message ??= this._state.connected ? 'Connected' : 'Not connected';
            this._emit({connecting: false, message});
        }
    }

    _emit({connecting, message}) {
        if (!this._run)
            return;
        this._onState({connected: this._state.connected, headset: this._state.headset, connecting, message});
    }
}
