# Jabra Integration for GNOME

A GNOME Shell extension for Jabra headsets that use a Jabra Link USB dongle.

- **Auto-connect.** A Jabra Link dongle gives up when the headset is busy with
  your phone, already has two connections, or is out of range. When auto-connect
  is on, the extension asks the dongle to connect the remembered headset every
  10 seconds until it works. If the headset drops later, it starts again. Click
  the top-bar icon to turn it on or off.
- **Pause on disconnect.** The dongle is a USB sound card that stays plugged in,
  so when the headset disconnects, Spotify and browsers keep playing into
  nothing. The extension pauses playing media (MPRIS) about a second after the
  headset drops, if the Jabra Link was your sound output. This also works while
  the screen is locked.

| Top-bar icon | Meaning |
| --- | --- |
| Headphones, normal colour | Auto-connect on, connected |
| Headphones, amber | Auto-connect on, trying to connect |
| Headphones, dimmed | Auto-connect off |

## Install

```sh
git clone https://github.com/FarisZR/jabra-gnome-integration.git
cd jabra-gnome-integration
./install.sh
```

Then log out and back in once.

The script:

1. Installs [jabridge](https://github.com/Watchdog0x/jabridge) if you don't have
   it. It downloads the latest release, checks its checksum and runs
   `jabridge setup`, which asks for your password once to set up device access
   and its background service.
2. Adds a weekly timer that runs `jabridge update` (signed releases only).
3. Installs and enables the extension.

Run `./install.sh` again to update. Run `./install.sh --uninstall` to remove the
extension and the timer. jabridge stays installed.

## Requirements

- GNOME Shell 48–50 (tested on 50)
- A Jabra Link dongle that jabridge can control: Link 380 (`0b0e:24c7`, `24c8`)
  or Link 390 (`0b0e:2e57`). Check yours with `lsusb | grep 0b0e`.
- The headset has been paired with the dongle at least once.

## Settings

There is no settings window. Use `gsettings`:

```sh
S="--schemadir $HOME/.local/share/gnome-shell/extensions/jabra-integration@fariszr.com/schemas"
gsettings $S set org.gnome.shell.extensions.jabra-integration pause-on-disconnect false
gsettings $S set org.gnome.shell.extensions.jabra-integration headset-name "Evolve2 85"
```

`headset-name` matters only if the dongle remembers more than one headset. The
extension does nothing while any of them is connected. When none is, it connects
the first one, or the one whose name contains `headset-name`.

## How it works

The extension talks to the jabridge background service over its local socket,
`$XDG_RUNTIME_DIR/jabridge.sock`. It subscribes to jabridge's events and also
checks `bt.list` every 5 seconds, to see whether the headset is connected. It
calls `bt.connect` to connect it. If something isn't working, run
`jabridge status` and `jabridge service status`.

Not affiliated with Jabra or GN Audio.
