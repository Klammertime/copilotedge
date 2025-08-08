# Contributing to CopilotEdge

Thank you for your interest in contributing to CopilotEdge! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct: be respectful, inclusive, and constructive.

## How to Contribute

### Reporting Issues

- Check existing issues first to avoid duplicates
- Use issue templates when available
- Include reproduction steps for bugs
- Provide environment details (Node version, OS, etc.)

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass (`npm test`)
6. Commit with descriptive messages
7. Push to your fork
8. Open a Pull Request

### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/copilotedge.git
cd copilotedge

# Install dependencies
npm install

# Build the package
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Testing

- Write tests for all new features
- Maintain or improve code coverage
- Run the full test suite before submitting PRs

### Commit Messages

Follow conventional commits format:

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `test:` Test additions or fixes
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `chore:` Maintenance tasks

Example: `feat: add support for custom models`

## Project Structure

```
copilotedge/
├── src/           # Source code
├── test/          # Test files
├── examples/      # Usage examples
├── benchmarks/    # Performance tests
└── dist/          # Build output (generated)
```

## Release Process

1. Update version in package.json
2. Update CHANGELOG.md
3. Create a GitHub release
4. Package publishes automatically via GitHub Actions

## Questions?

Feel free to open an issue for questions or join the discussion in existing issues.

Thank you for contributing! 🚀