# Changelog

## 0.3.0

- Moved thumbnails from individual files into a single SQLite `thumbs.db`.
- Reduced thumbnail file count from tens of thousands to one database file.
- Changed thumbnails to height-based 360px / max width 1600px, WebP quality 76.
- Improved video thumbnails with height-based Lanczos scaling and quality 82.
- Added light sharpening for high-resolution image thumbnails.
- Added legacy file fallback while migrating existing thumbnails into the database.
- Added SQLite prepared statements, WAL, orphan cleanup, and incremental vacuum.
- Added thumbnail ETag/cache versioning to avoid stale images after regeneration.
- Added a pre-save SMB connection test using NTLMv2; failed credentials are not stored or used.
- Refreshed folder counts automatically when a scan completes.
- Moved thumbnail progress tracking in-memory and reduced Sharp concurrency to avoid UI stutter.
- Added thumbnail retry while generation is in progress and fixed square lightbox display for unknown dimensions.

## 0.2.1

- Fixed the embedded window failing to connect when a specific LAN IP was configured.
- Fixed PDF thumbnails failing to load CMaps and fonts from the packaged application.

## 0.2.0

- Added a thumbnail generation progress bar with completed/total counts and failures.
- Reduced thumbnail resolution and quality, with automatic background regeneration.
- Added orphaned thumbnail cleanup.
- Optimized thumbnail queue concurrency by media type and added a queue index.
- Reduced UI re-renders by memoizing gallery views and isolating scan status updates.
- Added lazy asynchronous image decoding and content-visibility for gallery rows.
- Replaced the app-name setting with an overview panel showing version and data folder.
- Made the mixed-media setting apply immediately without a save button.
- Destroyed the embedded browser when minimizing to the tray, recreating it on reopen.
- Renamed release assets to `Kurarium-Installer-*` and `Kurarium-Portable-*`.

## 0.1.0

- Initial Windows release.
- Per-user installer and portable ZIP.
- Electron tray application with embedded web UI.
- Local, SMB, PDF, music, and video libraries.
- Startup scan, thumbnails, and video transcoding.
- LAN access with session login.
