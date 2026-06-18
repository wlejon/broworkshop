# Steam Lab

A worked consumer of **`bro.steam`** — the Steamworks binding — that drives every
call: identity, friends + avatars, rich presence, the Steam overlay, lobbies
(matchmaking), and voice capture + codec loopback. It doubles as the living API
reference and the acceptance-test rig for the binding.

`bro.steam` reaches Steam through the **flat C API of the redistributable**
(`steam_api64.dll` / `libsteam_api.{so,dylib}`), resolved at runtime — there is
**no Steamworks SDK in the bro build**. The binding is therefore always present
and probes at startup; with no Steam it reports `available === false` and stays a
safe no-op, so the lab loads and runs everywhere (cross-platform: Windows,
macOS, Linux).

## Run

```bash
# windowed
./build/Release/bro.exe ../broworkshop/demos/steam-lab

# headless acceptance test (surface + inert paths; live checks if Steam is up)
./build/Release/bro-headless.exe ../broworkshop/demos/steam-lab tests/test_smoke.js
```

## Dev setup (to get `available === true`)

The redistributable is proprietary and is **not** committed to either repo. For
development against **App ID 480 (Spacewar)**:

1. Copy `steam_api64.dll` (Windows) / `libsteam_api.so` (Linux) /
   `libsteam_api.dylib` (macOS) from the Steamworks SDK `redistributable_bin/`
   **next to the bro executable** (e.g. `build/Release/`).
2. Put a file named `steam_appid.txt` containing just `480` next to the
   executable too. (This is the dev shortcut for "which app am I" — at ship time
   Steam supplies the real App ID and this file is removed.)
3. Have the **Steam client running and logged in**.

Then `bro.steam.available` flips true, identity resolves, and the friends /
lobby / voice panels go live.

## What's testable solo vs. with a second client

| Solo (one account, this machine)                         | Needs a 2nd client (account + machine + mic) |
|----------------------------------------------------------|----------------------------------------------|
| identity, pump heartbeat                                 | invite **delivery** (`onlobbyjoinrequest`)   |
| friends list + avatars, rich presence                    | another member appearing in the lobby        |
| overlay activation (incl. invite panel renders)          | positioned/spatial voice between peers        |
| create / join your own lobby, lobby data, lobby list     |                                              |
| voice capture + `decodeVoice` loopback meter             |                                              |

The cross-client **golden path** (friend → create lobby → overlay invite → both
in lobby → voice) is what the second client unlocks; everything up to invite
*delivery* is exercised here on one machine.

> Voice transport and spatial mixing are intentionally **out of scope**: the lab
> proves capture + codec roundtrip locally. A real game forwards the compressed
> `onvoicecaptured` frames to peers (over `bro.net`) and mixes decoded PCM
> positionally (broaudio).
