# Kurarium

Local and SMB media viewer for Windows. Browse images, video, PDF, and music from a
browser UI hosted by a local server.

## Supported platforms

- Windows 10 22H2 (x64)
- Windows 11 (x64)

## Distribution

Releases are published on GitHub Releases.

- `Kurarium-Installer-<version>-win-x64.exe`: per-user installer (no administrator rights required)
- `Kurarium-Portable-<version>-win-x64.zip`: portable build
- `SHA256SUMS.txt`: checksums for the release assets
- `LEGAL-NOTICES.zip`: license texts, third-party notices, and FFmpeg build/source information

### Unsigned builds

The initial releases are **not code-signed**. Windows SmartScreen may display a
warning such as "Windows protected your PC". Choose **More info** and then
**Run anyway** only if the SHA-256 checksum matches the published value.

Verify a download in PowerShell:

```powershell
Get-FileHash .\Kurarium-Installer-0.4.0-win-x64.exe -Algorithm SHA256
```

Compare the result with the matching line in `SHA256SUMS.txt`.

## Installation

1. Run the installer.
2. Start **Kurarium** from the Start menu or the desktop shortcut.
3. Add libraries in **Settings > Libraries**.
4. Start a scan.

The application closes to the system tray. Use **Exit** in the tray menu to stop the
server and quit completely.

## Portable build

Extract the ZIP to a writable folder and run `Kurarium.exe`. User data is stored in a
`data` folder next to the executable. If that folder is not writable, Kurarium falls
back to `%LOCALAPPDATA%\Kurarium`.

Portable updates: exit Kurarium first, then extract the new ZIP over the existing
folder. The `data` folder is preserved.

## Data locations

- Installed build: `%LOCALAPPDATA%\Kurarium\data`
- Portable build: `<extracted folder>\data`
- Database: `data\mediaviewer.db`
- Thumbnails: `data\thumbs.db`
- Transcode cache: `data\transcoded`
- Server settings: `data\.system\config.ini`

## Thumbnail cache

Thumbnails are generated on demand for items near the visible area and stored in
`data\thumbs.db`. The default cache limit is **512 MB**. When the limit is exceeded,
the least recently used thumbnails are removed. An optional retention period (TTL) is
**disabled by default**.

Configure the cache in **Settings > System > サムネイルキャッシュ**. The maximum can be
set from 128 MB to 4096 MB. If TTL is enabled, thumbnails expire after the configured
number of days since their last access. The cache can be reduced on upgrade; original
media files are never modified.

SMB passwords are never stored in the database or settings file. They are kept in
Windows Credential Manager. The password is passed to the credential helper through
standard input rather than a process command line. Before a new or changed SMB
connection is saved, Kurarium tests the supplied credentials and share access; the
connection is saved only when the test succeeds.

### Moving from a development build

The development server stores data in `data/` inside the project. To keep an existing
library database and thumbnails:

1. Exit Kurarium and stop the development server.
2. Copy the project `data` folder to `%LOCALAPPDATA%\Kurarium\data`.
3. Start the installed application.

Media paths are stored as absolute paths. If drive letters or folder locations
changed, run a new scan after copying.

## LAN access

By default the server listens on `127.0.0.1` and does not require a login.

To open the library to other devices on the LAN:

1. Set a login user name and password in **Settings > System**.
2. Enable **ローカルネットワーク内に公開**. The port field becomes editable.
3. Save the settings and restart Kurarium.
4. Allow Kurarium through Windows Firewall when prompted.

When LAN publishing is off, Kurarium listens on `127.0.0.1`. When it is on, Kurarium
listens on `0.0.0.0` and requires login. If an older saved host is unavailable on the
current PC, Kurarium falls back to `127.0.0.1` so the settings screen can still be
opened.

LAN access uses HTTP. Use it only on a trusted network. A reverse proxy with HTTPS is
recommended for any wider exposure. Login failures are rate-limited per client IP
(5 failures in 15 minutes); wait before retrying after a temporary lockout.

## Development

Requirements: Node.js 22 or newer and ffmpeg/ffprobe on `PATH`.

```powershell
npm install
npm --prefix backend install
npm --prefix frontend install

npm --prefix backend run dev
npm --prefix frontend run dev
```

The development server runs on <http://127.0.0.1:3000>. The Vite dev server proxies
API requests.

### E2E smoke tests

Playwright starts an isolated backend and Vite server, seeds three images, and runs
the gallery, lightbox, and cache-settings smoke tests.

```powershell
npm run test:e2e:install
npm run test:e2e
```

### Production build

```powershell
npm run build
npm run dist
```

`npm run dist` builds the installer and the portable ZIP into `release/`.
FFmpeg binaries are required for packaging and are fetched separately:

```powershell
npm run fetch:ffmpeg
npm run dist
```

Release and signing procedures are documented in
[docs/RELEASE.md](docs/RELEASE.md) and [docs/SIGNING.md](docs/SIGNING.md).

## Tests

```powershell
npm test
npm run typecheck
```

## License

Kurarium is licensed under the MIT License. See [LICENSE](LICENSE).

Bundled third-party components retain their own licenses. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

FFmpeg is distributed under the GNU General Public License version 3. The bundled
build configuration and source availability are documented in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
