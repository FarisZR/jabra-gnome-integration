import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {HeadsetState} from '../headsetState.js';
import {HeadsetMonitor} from '../headset.js';
import {EventStream, rpc} from '../jabridge.js';

function assert(value, message) {
    if (!value)
        throw new Error(message);
}
const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
async function until(predicate) {
    for (let i = 0; i < 300; i++) {
        if (predicate())
            return;
        await sleep(10);
    }
    throw new Error('Timed out waiting for observable state');
}
const devices = [{id: 1, name: 'Office', connected: true}, {id: 2, name: 'Travel', connected: false}];
const state = new HeadsetState();
assert(!state.observe(devices), 'Initial observation must not disconnect');
assert(state.select(devices, 'TRAV').id === 2, 'Preferred match ignores case');
assert(state.select(devices, 'missing').id === 1, 'Missing preference falls back');
assert(!state.observe([]), 'Service restart must not pause');
state.observe(devices);
assert(!state.observe(null), 'Unreachable service must not pause');
state.observe(devices);
assert(state.observe([{...devices[0], connected: false}]), 'Explicit disconnect must pause');
assert(!state.observe([{...devices[0], connected: false}]), 'Disconnect must fire once');
assert(state.headset === 'Office', 'Disconnect retains headset identity');
print('PASS headset transitions and selection');

await rpc('test.set', {devices});
const states = [];
let disconnects = 0;
const monitor = new HeadsetMonitor({onState: value => states.push(value), onDisconnect: () => disconnects++});
try {
    monitor.start();
    await until(() => states.some(value => value.connected));
    assert((await rpc('test.stats')).connects === 0, 'Auto-connect must not displace a connected headset');
    await rpc('test.set', {devices: [{...devices[0], connected: false}], failConnect: true});
    monitor.refresh();
    await until(() => disconnects === 1 && states.at(-1)?.connecting === false);
    const attempts = (await rpc('test.stats')).connects;
    assert(attempts === 1, 'Disconnected remembered headset must reconnect');
    monitor.refresh();
    await sleep(100);
    assert((await rpc('test.stats')).connects === attempts, 'Failed connects respect backoff');
    monitor.autoConnect = false;
    await sleep(50);
    await rpc('test.set', {devices, delay: 300});
    monitor.refresh();
    await sleep(30);
    monitor.stop();
    const stoppedCount = states.length;
    await sleep(350);
    assert(states.length === stoppedCount, 'Stopped monitor must not emit stale replies');
    monitor.start();
    await sleep(30);
    monitor.stop();
    await rpc('test.set', {devices, delay: 0});
    monitor.start();
    await until(() => states.length > stoppedCount && states.at(-1).connected);
    print('PASS monitor reconnect policy, cancellation and immediate restart');
} finally {
    monitor.stop();
}
let subscriptions = 0;
const events = new EventStream({onSubscribed: () => subscriptions++});
try {
    events.start();
    events.stop();
    events.start();
    await until(() => subscriptions === 1);
    print('PASS event stream immediate restart');
} finally {
    events.stop();
}
const cancel = new Gio.Cancellable();
cancel.cancel();
try {
    await rpc('bt.list', null, {cancellable: cancel});
    throw new Error('Cancelled RPC unexpectedly succeeded');
} catch (error) {
    assert(error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED), 'RPC must preserve cancellation');
}
print('PASS RPC cancellation');
