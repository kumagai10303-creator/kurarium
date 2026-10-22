# Security Policy

Kurarium is a local-first Windows application. It is designed for personal use on a
trusted local network and is not intended to be exposed directly to the internet.

## Supported versions

Before version 1.0, security fixes are provided for the latest published release.
Older releases may not receive fixes.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's **Private vulnerability reporting** for this repository. Include:

- affected version and Windows version
- steps to reproduce
- expected and actual behavior
- whether LAN publishing was enabled
- relevant logs with secrets and personal paths removed

Do not include passwords, SMB credentials, private keys, or personal media paths in a
report. You will receive an acknowledgement on a best-effort basis.

## Scope

In scope:

- authentication and session handling
- LAN TLS and certificate handling
- path or origin validation
- local API access from untrusted web content
- command execution through FFmpeg, SMB, or credential helpers
- privilege escalation or unintended file access

Out of scope:

- physical access to the PC or its user account
- malware already running on the same Windows account
- denial of service against the local machine by its owner
- security of third-party SMB servers or network infrastructure
- issues that require disabling certificate validation or exposing the LAN port to
  the internet

## Security model

- The loopback-only mode has no login. Any process running as the same Windows user
  can access the local API.
- LAN publishing requires a login and serves HTTPS with a self-signed certificate.
- The login system is single-user. All authenticated LAN clients have full access to
  the configured libraries and settings.
- Passwords are stored as scrypt hashes. SMB passwords are stored in Windows
  Credential Manager, not in the Kurarium database.
- TLS protects traffic in transit, but a self-signed certificate must be trusted by
  each client. Bypassing certificate warnings weakens that protection.
