# Privacy and public-release boundary

The public package is produced from an explicit allowlist. It excludes imported documents, project state, knowledge bases, generated outputs, style samples, logs, caches, temporary renders, and office files.

Local runs store snapshots and results under `workbench-data/` or the directory selected with `-DataDirectory`. That directory is ignored by Git and must not be committed or attached to a public issue.

Deterministic review runs locally. A configured semantic provider may transmit selected text to that provider; users must review their provider and organizational data-handling requirements before enabling it.

If a leak is suspected, remove the affected public artifact immediately, rotate any exposed credential, and publish a replacement release with a new manifest. Deleting a Git commit alone does not guarantee removal from forks or caches.
