# LAN HTTPS certificate

Kurarium uses a self-signed certificate for LAN HTTPS. The certificate encrypts
traffic between the PC running Kurarium and other devices on the same trusted
network. It does not replace Windows code signing for the installer.

## Generate and verify

1. Open **Settings > System**.
2. Enable **ローカルネットワーク内に公開**, set a user name and a password of at least
   5 characters, then save.
3. Restart Kurarium.
4. Open the HTTPS certificate section and check the fingerprint and expiry date.
5. Download `kurarium-lan.cer`.

The certificate covers `localhost`, the PC host name, and the LAN addresses present
when it was generated. If the PC's LAN address changes, regenerate the certificate
and trust the new one on each client.

## Windows clients

1. Double-click `kurarium-lan.cer`.
2. Choose **Install Certificate**.
3. Select **Current User** and **Place all certificates in the following store**.
4. Choose **Trusted Root Certification Authorities**.
5. Finish the wizard and restart the browser.

Use **Local Machine** instead if the device is managed and you need the trust to apply
to all users.

## Chrome and Edge

Chrome and Edge use the Windows certificate store. After installing the certificate
for the current user, completely restart the browser.

## Firefox

Firefox may use its own certificate store:

1. Open **Settings > Privacy & Security > Certificates > View Certificates**.
2. Open the **Authorities** tab and choose **Import**.
3. Select `kurarium-lan.cer` and trust it for websites.

## iOS and iPadOS

Install the certificate as a profile, then enable it for full trust:

1. Transfer `kurarium-lan.cer` to the device and install the profile.
2. Open **Settings > General > About > Certificate Trust Settings**.
3. Enable full trust for the Kurarium certificate.

## Android

Install the certificate as a CA certificate from the device's security settings. The
exact menu name varies by vendor and Android version.

## Troubleshooting

- **Certificate warning:** the client has not trusted the certificate, or the
  certificate was regenerated.
- **Address not covered:** regenerate the certificate after a LAN address change.
- **Wrong fingerprint:** do not continue. Verify that you downloaded the certificate
  from the Kurarium settings screen on the intended PC.
- **HTTP connection fails:** LAN mode is HTTPS-only. Use `https://`, not `http://`.
