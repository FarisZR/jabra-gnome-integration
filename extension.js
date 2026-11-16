// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import {HEADPHONES_ICON, Indicator} from './indicator.js';
import {HeadsetMonitor} from './headset.js';
import {pausePlayingPlayers} from './media.js';

function jabraIsDefaultOutput() {
    const sink = Volume.getMixerControl().get_default_sink();
    const name = `${sink?.get_name() ?? ''} ${sink?.get_description() ?? ''}`;
    return /jabra/i.test(name);
}

export default class JabraIntegrationExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._state = null;
        this._cancellable = new Gio.Cancellable();
        this._jabraWasOutput = false;
        this._indicator = new Indicator(() => this._toggle());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        // The extension keeps running on the lock screen (session-modes in
        // metadata.json) so media is still paused if you walk away while
        // locked. The icon is hidden there.
        this._sessionId = Main.sessionMode.connect('updated', () => this._syncVisibility());
        this._syncVisibility();

        this._monitor = new HeadsetMonitor({
            autoConnect: this._settings.get_boolean('auto-connect'),
            preferredName: this._settings.get_string('headset-name'),
            onState: state => {
                this._state = state;
                // Remember the output while connected: by the time the
                // disconnect is seen, PipeWire may have switched already.
                if (state.connected)
                    this._jabraWasOutput = jabraIsDefaultOutput();
                this._updateIndicator();
            },
            onDisconnect: () => this._onDisconnect(),
        });

        this._settingsIds = [
            this._settings.connect('changed::auto-connect', () => {
                this._monitor.autoConnect = this._settings.get_boolean('auto-connect');
                this._updateIndicator();
            }),
            this._settings.connect('changed::headset-name', () => {
                this._monitor.preferredName = this._settings.get_string('headset-name');
            }),
        ];
        this._updateIndicator();
        this._monitor.start();
    }

    disable() {
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._sessionId)
            Main.sessionMode.disconnect(this._sessionId);
        this._sessionId = 0;
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = null;
        this._monitor?.stop();
        this._monitor = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
        this._state = null;
    }

    _syncVisibility() {
        this._indicator.container.visible = !Main.sessionMode.isLocked;
    }

    _updateIndicator() {
        if (!this._indicator)
            return;
        const state = this._state;
        let status = 'off';
        if (this._settings.get_boolean('auto-connect'))
            status = state?.connected ? 'connected' : 'connecting';
        this._indicator.setState(status, state?.headset ?? state?.message ?? null);
    }

    _onDisconnect() {
        if (!this._settings.get_boolean('pause-on-disconnect'))
            return;
        if (!this._jabraWasOutput && !jabraIsDefaultOutput())
            return;
        const cancellable = this._cancellable;
        pausePlayingPlayers(cancellable).catch(error => {
            if (!cancellable.is_cancelled())
                console.warn(`Jabra Integration: pausing media failed: ${error.message}`);
        });
    }

    _toggle() {
        const enabled = !this._settings.get_boolean('auto-connect');
        this._settings.set_boolean('auto-connect', enabled);
        const label = enabled ? 'Jabra auto-connect on' : 'Jabra auto-connect off';
        Main.osdWindowManager.showAll(Gio.ThemedIcon.new(HEADPHONES_ICON), label, null, null);
    }
}
