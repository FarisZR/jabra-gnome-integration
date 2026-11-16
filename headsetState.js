// SPDX-License-Identifier: GPL-2.0-or-later

export class HeadsetState {
    constructor() {
        this.connected = null;
        this.headset = null;
    }

    observe(devices) {
        if (devices === null) {
            this.connected = null;
            return false;
        }
        const connected = devices.find(device => device.connected);
        // An empty list is also returned during service restarts, so it cannot
        // establish a headset disconnect.
        const disconnected = this.connected === true && !connected && devices.length > 0;
        this.connected = Boolean(connected);
        if (connected)
            this.headset = connected.name;
        return disconnected;
    }

    select(devices, preferredName) {
        const wanted = preferredName.trim().toLowerCase();
        return (wanted && devices.find(device =>
            (device.name ?? '').toLowerCase().includes(wanted))) || devices[0];
    }
}
