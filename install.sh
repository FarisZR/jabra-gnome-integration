#!/usr/bin/env bash
# Installs jabridge (if missing), a weekly jabridge self-update timer and the
# Jabra Integration GNOME extension. Run as your normal user.
#
#   ./install.sh              install or update
#   ./install.sh --uninstall  remove the extension and the update timer
set -euo pipefail

UUID="jabra-integration@fariszr.com"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
JABRIDGE="$HOME/.local/bin/jabridge"
JABRIDGE_REPO="Watchdog0x/jabridge"
TIMER="jabra-integration-jabridge-update.timer"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"; }

[[ $EUID -ne 0 ]] || die "run this as your normal user, not root"

# Adds the extension to (or removes it from) GNOME Shell's enabled list. Done
# through GSettings because GNOME Shell on Wayland only loads a new or updated
# extension after you log in again.
set_extension_enabled() {
    gjs -c "
const {Gio} = imports.gi;
const settings = new Gio.Settings({schema_id: 'org.gnome.shell'});
for (const key of ['enabled-extensions', 'disabled-extensions']) {
    const list = settings.get_strv(key).filter(uuid => uuid !== '$UUID');
    if ('$1' === 'on' && key === 'enabled-extensions')
        list.push('$UUID');
    settings.set_strv(key, list);
}
Gio.Settings.sync();"
}

uninstall() {
    set_extension_enabled off
    rm -rf "$EXT_DIR"
    systemctl --user disable "$TIMER" 2>/dev/null || true
    systemctl --user stop --no-block "$TIMER" 2>/dev/null || true
    rm -f "$UNIT_DIR/$TIMER" "$UNIT_DIR/${TIMER%.timer}.service"
    systemctl --user daemon-reload
    say "Removed the extension and the update timer. jabridge itself was left installed."
}

install_jabridge() {
    if [[ -x $JABRIDGE ]] || command -v jabridge >/dev/null 2>&1; then
        say "jabridge is already installed"
        return
    fi
    need curl; need tar; need sha256sum
    local arch tag version name base
    case "$(uname -m)" in
        x86_64) arch=amd64 ;;
        aarch64 | arm64) arch=arm64 ;;
        *) die "jabridge has no release for $(uname -m)" ;;
    esac
    tag="$(curl -fsSL "https://api.github.com/repos/$JABRIDGE_REPO/releases/latest" |
        sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
    [[ -n $tag ]] || die "could not find the latest jabridge release"
    version="${tag#v}"
    name="jabridge_${version}_linux_${arch}"
    base="https://github.com/$JABRIDGE_REPO/releases/download/$tag"

    say "Downloading jabridge $version ($arch)"
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    local tmp="$TMP_DIR"
    curl -fsSL -o "$tmp/$name.tar.gz" "$base/$name.tar.gz"
    curl -fsSL -o "$tmp/$name.tar.gz.sha256" "$base/$name.tar.gz.sha256"
    (cd "$tmp" && sha256sum -c --quiet "$name.tar.gz.sha256") || die "checksum mismatch"
    tar -xzf "$tmp/$name.tar.gz" -C "$tmp"

    say "Running jabridge setup (it asks for your password once for device access)"
    "$tmp/$name/jabridge" setup
}

install_update_timer() {
    # Only for the self-managed copy in ~/.local/bin; package-managed installs
    # are updated by the package manager.
    if [[ ! -x $JABRIDGE ]]; then
        say "Skipping the jabridge update timer (jabridge is not in ~/.local/bin)"
        return
    fi
    mkdir -p "$UNIT_DIR"
    install -m 0644 "$SRC/systemd/${TIMER%.timer}.service" "$SRC/systemd/$TIMER" "$UNIT_DIR/"
    systemctl --user daemon-reload
    systemctl --user enable "$TIMER"
    systemctl --user start --no-block "$TIMER"
    say "jabridge will update itself weekly"
}

install_extension() {
    need glib-compile-schemas; need gjs
    say "Installing the GNOME extension"
    rm -rf "$EXT_DIR"
    mkdir -p "$EXT_DIR/schemas"
    install -m 0644 "$SRC"/{metadata.json,extension.js,jabridge.js,headset.js,media.js,stylesheet.css} "$EXT_DIR/"
    install -m 0644 "$SRC"/schemas/*.gschema.xml "$EXT_DIR/schemas/"
    glib-compile-schemas "$EXT_DIR/schemas"

    set_extension_enabled on
}

if [[ ${1:-} == "--uninstall" ]]; then
    uninstall
    exit 0
fi

install_jabridge
# jabridge setup enables its service; just make sure it runs. --no-block
# because jabridge.service is ordered After=default.target.
systemctl --user is-active --quiet jabridge.service ||
    systemctl --user start --no-block jabridge.service 2>/dev/null || true
install_update_timer
install_extension

say "Done. Log out and back in once to load the extension."
echo "Then click the headphones icon in the top bar to turn auto-connect on or off."
