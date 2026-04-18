# git-encrypt

Transparent Git encryption using [age-encryption](https://github.com/str4d/age) and git hooks. Encrypt sensitive files in your repository while keeping your workflow seamless.

## Features

- 🔐 **Transparent Encryption** - Automatically encrypt/decrypt files on commit and checkout
- 🔑 **Age Encryption** - Modern, fast encryption using the [age](https://age-encryption.org/) standard
- 🪝 **Git Hooks Integration** - Hooks for `pre-commit`, `post-checkout`, `post-merge`, and `pre-push`
- 👥 **Multiple Recipients** - Manage encryption keys for different groups/users
- 🎯 **Path-based Encryption** - Specify which files to encrypt using glob patterns
- 💻 **CLI Tools** - Commands for managing recipients, encryption, and decryption

## Installation

```bash
npm install -g git-encrypt
```

Or use with `npx`:

```bash
npx git-encrypt --help
```

## Quick Start

### 1. Initialize your repository

```bash
cd your-repo
git-encrypt install
```

This creates a `.gitencrypt/` directory and installs git hooks.

### 2. Add encryption recipients

```bash
# Add your public key to the 'default' group
git-encrypt recipient add default YOUR_AGE_PUBLIC_KEY
```

### 3. Configure paths to encrypt

```bash
# Add a file or pattern to be encrypted
git-encrypt path add '*.env'
git-encrypt path add 'secrets/**'
```

### 4. Use normally

Files matching your encryption paths will be automatically:
- **Encrypted** before commit (via `pre-commit` hook)
- **Decrypted** after checkout (via `post-checkout` hook)
- **Decrypted** after merge (via `post-merge` hook)

## Commands

### Install

```bash
git-encrypt install [dir]          # Initialize encryption in a repository
  --force                          # Overwrite existing hooks
  --windows-fallback               # Use wrapper scripts instead of symlinks
```

### Recipients

```bash
git-encrypt recipient add <group> <pubkey>     # Add a recipient to a group
git-encrypt recipient remove <group> <pubkey>  # Remove a recipient
git-encrypt recipient list                     # List all recipients
```

### Paths

```bash
git-encrypt path add <pattern>     # Add a glob pattern to encrypt
git-encrypt path remove <pattern>  # Stop encrypting a pattern
git-encrypt path list              # List encrypted patterns
```

### Manual Encryption/Decryption

```bash
git-encrypt encrypt <file>         # Manually encrypt a file
git-encrypt decrypt <file>         # Manually decrypt a file
```

## Configuration

Configuration is stored in `.gitencrypt/`:

- `.gitencrypt/recipients.json` - Age public keys organized by group
- `.gitencrypt/paths.json` - Glob patterns for files to encrypt

## Requirements

- Node.js 22.0.0 or higher

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.
