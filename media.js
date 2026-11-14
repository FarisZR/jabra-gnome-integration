// SPDX-License-Identifier: GPL-2.0-or-later
//
// Pauses every MPRIS media player (Spotify, browsers, mpv, …) that is playing.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.DBusConnection.prototype, 'call');

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

/** Returns the bus names of the players that were paused. */
export async function pausePlayingPlayers() {
    const bus = Gio.DBus.session;
    const reply = await bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'ListNames', null, new GLib.VariantType('(as)'),
        Gio.DBusCallFlags.NONE, -1, null);
    const [names] = reply.deepUnpack();
    const players = names.filter(name => name.startsWith(MPRIS_PREFIX));

    const paused = await Promise.all(players.map(async name => {
        try {
            const status = await bus.call(name, MPRIS_PATH, 'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', [PLAYER_IFACE, 'PlaybackStatus']), new GLib.VariantType('(v)'),
                Gio.DBusCallFlags.NONE, 2000, null);
            if (status.recursiveUnpack()[0] !== 'Playing')
                return null;
            await bus.call(name, MPRIS_PATH, PLAYER_IFACE, 'Pause', null, null,
                Gio.DBusCallFlags.NONE, 2000, null);
            return name;
        } catch (error) {
            console.warn(`Jabra Integration: could not pause ${name}: ${error.message}`);
            return null;
        }
    }));
    return paused.filter(Boolean);
}
