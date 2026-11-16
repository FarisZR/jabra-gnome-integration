import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export const METRICS = {};
export async function run() {
    const uuid = 'jabra-integration@fariszr.com';
    await Scripting.sleep(1000);
    const indicator = Main.panel.statusArea[uuid];
    if (!indicator || !indicator.accessible_name.startsWith('Jabra auto-connect'))
        throw new Error('Extension did not create an accessible indicator');
    Main.extensionManager.disableExtension(uuid);
    await Scripting.sleep(100);
    if (Main.panel.statusArea[uuid])
        throw new Error('Disable did not remove the indicator');
    Main.extensionManager.enableExtension(uuid);
    await Scripting.sleep(200);
    if (!Main.panel.statusArea[uuid])
        throw new Error('Re-enable failed');
    print('PASS GNOME Shell load, disable, re-enable');
}
