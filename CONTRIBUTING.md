# Contributing to Blinky

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/OnionLabs/blinky.git
cd blinky
npm install
```

## Running Locally

1. Open the repo in VS Code
2. Press `F5` to launch the Extension Development Host
3. Plug in a board to test with real hardware

## Common Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Build the extension |
| `npm run watch` | Build in watch mode |
| `npm test` | Run tests |
| `npm run lint` | Lint with ESLint |

## Making Changes

1. Fork the repo and create a branch from `master`
2. Make your changes
3. Add or update tests as needed
4. Run `npm test` and `npm run lint`
5. Open a pull request

## Code Style

- TypeScript with ESLint — the pre-commit hook runs `eslint --fix` automatically
- No manual formatting rules — just follow what's already there

## Testing

Tests use [Vitest](https://vitest.dev/) with a mock of the VS Code API. Run them with:

```bash
npm test                    # run once
npm run test:watch          # watch mode
npm run test:coverage       # with coverage report
```

If your change touches hardware interaction (serial, flashing), please test with a real board before submitting.

## Reporting Bugs

Use the [bug report template](https://github.com/OnionLabs/blinky/issues/new?template=bug_report.md). Include your OS, VS Code version, board type, and MicroPython version.
