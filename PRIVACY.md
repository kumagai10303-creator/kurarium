# Privacy

Kurarium is a local application. It does not include telemetry, analytics, crash
reporting, advertising, or a cloud account.

## Data stored on your PC

- media library database and browsing history
- thumbnails and transcode cache
- server and library settings
- application logs
- the LAN TLS private key and certificate when LAN publishing is enabled

Installed builds store data under `%LOCALAPPDATA%\Kurarium\data`. Portable builds use
the `data` folder next to the executable when it is writable, otherwise
`%LOCALAPPDATA%\Kurarium`.

SMB passwords are stored in Windows Credential Manager. Kurarium does not store SMB
passwords in its database or settings file.

## Network access

Kurarium can connect to:

- local or network media libraries, including SMB shares you configure
- `127.0.0.1` for its local web UI
- your LAN when LAN publishing is enabled

Kurarium does not send library data, settings, or usage information to the project
maintainers.

## Logs and reports

Application logs can contain file paths and SMB host names. Remove personal
information and credentials before sharing logs in an issue.

## Changes

This policy may be updated as the application changes. The current version is kept
in this file.
