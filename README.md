# Plugin Health Monitor

Monitors GitHub workflow health across the [Ubiquity OS Marketplace](https://github.com/ubiquity-os-marketplace) organization.

## What it does

- Scans all repositories for workflow dispatch failures triggered by the kernel (`ubiquity-os[bot]` or `ubiquity-os-dev[bot]`)
- Detects workflows with **10+ consecutive failures**
- Automatically creates GitHub issues to alert maintainers

## Usage

```bash
# Install dependencies
bun install

# Run the health check
bun run check:failures
```

## Configuration

Set your GitHub token in a `.env` file:

```
GITHUB_TOKEN=your_token_here
```

## Testing

```bash
# Run tests
bun run test
```
