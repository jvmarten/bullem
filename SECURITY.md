# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Bull 'Em, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email the project maintainer directly. Include:

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fixes (optional)

## Response Timeline

- **Acknowledgment:** Within 48 hours of your report
- **Assessment:** Within 1 week
- **Fix:** As soon as practical, depending on severity

## Scope

This policy applies to:

- The Bull 'Em game server and client code in this repository
- The deployed instance at bullem.cards

Out of scope:

- Third-party dependencies (report those to the respective maintainers)
- Social engineering attacks
- Denial of service attacks

## Security Design

Bull 'Em is designed with security in mind:

- **Server-authoritative architecture:** All game logic runs server-side; clients are untrusted rendering layers
- **Anti-cheat by design:** Players never receive other players' card data
- **Input validation:** All socket events and HTTP endpoints validate and sanitize input
- **No client secrets:** No API keys, tokens, or secrets in client code

## Supported Versions

Only the latest version on the `main` branch is actively supported with security updates.
