# Contributing to Bull 'Em

Thanks for your interest in contributing to Bull 'Em! This guide will help you get started.

## Getting Started

1. **Fork the repository** and clone your fork
2. **Install dependencies:** `npm install`
3. **Start the dev server:** `npm run dev`
4. **Run tests:** `npm test`

## Development Setup

### Prerequisites

- Node.js 20+
- npm 9+

### Local Development

```bash
npm install          # Install all workspace dependencies
npm run dev          # Start server + client concurrently
npm run build        # Build shared -> server -> client
npm test             # Run all tests across workspaces
```

The dev server starts the backend on port 3001 and the frontend on port 5173.

## Project Structure

Bull 'Em is a monorepo with three main workspaces:

- **`shared/`** — Types, constants, and pure game logic (imported by both client and server)
- **`server/`** — Node.js backend with Express + Socket.io
- **`client/`** — React frontend built with Vite

### Boundary Rules

- `shared/` is imported by both `client/` and `server/`
- `client/` imports from `shared/` only — never from `server/`
- `server/` imports from `shared/` only — never from `client/`

## Code Standards

### TypeScript

- `strict: true` — no exceptions
- No `any` types — use `unknown` and narrow, or define proper types in `shared/`
- No `@ts-ignore` without a justifying comment
- Exhaustive switch statements with `never` default

### Code Style

- Comments explain *why*, not *what*
- `// TODO(scale):` markers for intentional temporary solutions
- Keep changes minimal and focused

### Testing

- Every bug fix includes a regression test
- Game engine changes need unit tests covering edge cases
- Tests must be deterministic — seed randomness, mock time

## Making Changes

### Branch Naming

- `feature/description` for new features
- `fix/description` for bug fixes
- `refactor/description` for refactoring

### Commit Messages

Write clear, descriptive commit messages. Use imperative mood ("Add feature" not "Added feature").

### Pull Requests

1. Create a feature branch from `develop`
2. Make your changes with tests
3. Ensure all tests pass: `npm test`
4. Ensure the project builds: `npm run build`
5. Open a PR targeting `develop`
6. Fill out the PR template

PRs targeting `develop` are automatically merged after CI passes. PRs targeting `main` require manual review.

### What Makes a Good PR

- **Focused:** One logical change per PR
- **Tested:** Include tests for new behavior
- **Mobile-friendly:** UI changes must work on 320px+ screens
- **Secure:** Server-side validation for any new endpoints; no secrets in client code
- **Documented:** Update relevant docs if behavior changes

## Reporting Bugs

Use the [bug report template](https://github.com/jvmarten/bullem/issues/new?template=bug_report.md) and include:

- Steps to reproduce
- Expected vs actual behavior
- Device/browser info

## Suggesting Features

Use the [feature request template](https://github.com/jvmarten/bullem/issues/new?template=feature_request.md) and describe:

- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

## Security

If you find a security vulnerability, **do not open a public issue**. See [SECURITY.md](SECURITY.md) for reporting instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
