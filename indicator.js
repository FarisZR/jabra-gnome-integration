// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const HEADPHONES_ICON = 'audio-headphones-symbolic';
const STATE_CLASSES = ['jabra-off', 'jabra-connecting'];

export const Indicator = GObject.registerClass(
class JabraIndicator extends PanelMenu.Button {
    _init(onToggle) {
        super._init(0.5, 'Jabra', true);
        this._onToggle = onToggle;
        this._icon = new St.Icon({icon_name: HEADPHONES_ICON, style_class: 'system-status-icon'});
        this.add_child(this._icon);

        if (Clutter.ClickGesture) {
            const click = new Clutter.ClickGesture();
            click.connect('recognize', () => this._onToggle());
            this.add_action(click);
        } else {
            this.connect('button-release-event', () => {
                this._onToggle();
                return Clutter.EVENT_STOP;
            });
        }
        const onKey = key => {
            if (key === Clutter.KEY_Return || key === Clutter.KEY_space) {
                this._onToggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        };
        // GNOME 48 predates the event controllers used by modern Shell.
        if (Clutter.KeyController) {
            const keys = new Clutter.KeyController();
            keys.connect('key-press', () => onKey(keys.get_key()[1]));
            this.add_action(keys);
        } else {
            this.connect('key-press-event', (_actor, event) => onKey(event.get_key_symbol()));
        }
    }

    setState(status, detail) {
        for (const name of STATE_CLASSES)
            this._icon.remove_style_class_name(name);
        if (status !== 'connected')
            this._icon.add_style_class_name(`jabra-${status}`);
        const label = {
            off: 'Jabra auto-connect off',
            connecting: 'Jabra auto-connect on, not connected',
            connected: 'Jabra auto-connect on, connected',
        }[status];
        this.accessible_name = detail ? `${label}: ${detail}` : label;
    }
});

