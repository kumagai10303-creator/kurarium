# Contributing to Kurarium

Kurarium is a Windows-focused Electron application with a Fastify backend and a React
frontend. Contributions are welcome, but please keep the project's local-first and
single-user security model in mind.

## Before you start

- Open an issue for large changes or security-sensitive changes before writing code.
- Do not include credentials, personal paths, media files, or build artifacts in a
  pull request.
- Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Windows 10 22H2 or Windows 11 x64, Node.js 22 or newer, Git, and
ffmpeg/ffprobe on `PATH`.

```powershell
npm install
npm --prefix backend install
npm --prefix frontend install
npm run fetch:ffmpeg
```

Run the backend and frontend in separate terminals:

```powershell
npm --prefix backend run dev
npm --prefix frontend run dev
```

## Checks

Run the same checks as CI before opening a pull request:

```powershell
npm test
npm run typecheck
npm run build
npm run test:e2e:install
npm run test:e2e
```

If a check cannot be run locally, explain why in the pull request.

## Code style

- TypeScript with strict type checking.
- Keep backend logic in `backend/src`, UI in `frontend/src`, and Electron integration
  in `electron/`.
- Do not add comments that merely restate the code.
- Prefer existing helpers and patterns over new dependencies.
- Do not add telemetry or external network calls without discussing them first.

## Pull requests

- Keep changes focused and describe the user-visible effect.
- Add or update tests for behavior changes.
- Update documentation when setup, security, storage, or release behavior changes.
- Do not commit generated `release/`, `dist/`, `data/`, or vendor binary files.

By contributing, you agree that your contribution is licensed under the project's MIT
License.
