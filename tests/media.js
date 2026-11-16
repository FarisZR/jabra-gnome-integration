import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {pausePlayingPlayers} from '../media.js';

const xml = `<node><interface name="org.mpris.MediaPlayer2.Player">
<method name="Pause"/><property name="PlaybackStatus" type="s" access="read"/>
</interface></node>`;
const players = [];
const owned = [];
try {
    for (const [name, status] of [['Playing', 'Playing'], ['Paused', 'Paused']]) {
        const player = {PlaybackStatus: status, pauses: 0, Pause() { this.pauses++; }};
        const object = Gio.DBusExportedObject.wrapJSObject(xml, player);
        const connection = Gio.DBusConnection.new_for_address_sync(
            GLib.getenv('DBUS_SESSION_BUS_ADDRESS'),
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
            null, null);
        object.export(connection, '/org/mpris/MediaPlayer2');
        const busName = `org.mpris.MediaPlayer2.JabraTest${name}`;
        await new Promise(resolve => {
            owned.push(Gio.bus_own_name_on_connection(connection, busName,
                Gio.BusNameOwnerFlags.NONE, resolve, null));
        });
        players.push({player, object, connection, busName});
    }
    const paused = await pausePlayingPlayers(new Gio.Cancellable());
    if (paused.length !== 1 || paused[0] !== players[0].busName ||
        players[0].player.pauses !== 1 || players[1].player.pauses !== 0)
        throw new Error('Only playing players should receive Pause');
    const cancelled = new Gio.Cancellable();
    cancelled.cancel();
    try {
        await pausePlayingPlayers(cancelled);
        throw new Error('Cancelled media operation unexpectedly succeeded');
    } catch (error) {
        if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            throw error;
    }
    if (players[0].player.pauses !== 1)
        throw new Error('Cancellation sent an additional Pause');
    print('PASS real MPRIS D-Bus playback filtering and cancellation');
} finally {
    for (const id of owned)
        Gio.bus_unown_name(id);
    for (const {object, connection} of players) {
        object.unexport();
        connection.close_sync(null);
    }
}
