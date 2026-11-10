# Contributing

Thanks for helping improve Seanime Providers.

## Contents

- [Before you contribute](#before-you-contribute)
- [Repository layout](#repository-layout)
- [Providers and plugins](#providers-and-plugins)
- [Marketplace entries](#marketplace-entries)
- [Testing](#testing)
- [Commits and pull requests](#commits-and-pull-requests)
- [Reporting broken sources](#reporting-broken-sources)

## Before you contribute

- Consult the [Seanime Extensions documentation](https://seanime.gitbook.io/seanime-extensions) for APIs, manifests, permissions, and runtime behavior.
- Check existing extensions and shared declarations before starting new work.
- Follow the source website’s terms. Do not bypass authentication, paywalls, or access controls.
- Never commit cookies, API keys, personal data, or other secrets.
- Contributions are released under the repository’s [MIT License](./LICENSE).

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/anime/<provider>/` | Anime providers |
| `src/manga/<provider>/` | Manga providers |
| `src/plugins/<plugin>/` | Seanime plugins |
| `marketplace/main.json` | Marketplace catalog |
| `api/check.js` | Extension checker API |
| `down-detector.html` | Extension checker UI |

## Providers and plugins

A provider directory normally contains a manifest and a `provider.js` or `provider.ts` payload. Add a provider README when setup steps, limitations, or source behavior need explanation.

Use these declarations as references:

- Core runtime: `src/core.d.ts`
- Anime providers: `src/anime/online-streaming-provider.d.ts`
- Manga providers: `src/manga/manga-provider.d.ts`

Plugins live under `src/plugins/<plugin>/`. Their manifests use `"type": "plugin"` and may define `plugin.permissions` or `userConfig`. Request only the permissions you need and explain unsafe flags or network domains in the manifest.

Provider code should fail safely: log useful diagnostics, return empty results when a source is unavailable, avoid leaking credentials, and do not return unrelated results when parsing fails.

### Manifests

Use an existing manifest as the authoritative schema. At minimum, include a unique `id`, name, version, description, author, language, type, and `payloadURI`. Use the correct type for the extension, such as `onlinestream-provider`, `manga-provider`, or `plugin`.

Bump the manifest version when behavior changes:

- **Patch:** bug fixes and routine maintenance.
- **Minor:** compatible features or substantial provider changes.

### Co-author credits

Manifest co-author credit is for substantial work on an existing extension, such as a parser rewrite, new resolver, major compatibility change, or similarly significant feature.

Routine selector fixes, small bug fixes, formatting changes, and version bumps generally do not qualify. Request credit in the pull request and provide the name to display; maintainers make the final determination.

## Marketplace entries

For a new extension, add one entry to `marketplace/main.json` with the same `id` as its manifest. Keep the language, type, icon, description, and tags accurate. Reuse existing lowercase tags and avoid promotional or speculative tags.

### Tag glossary

| Tag | Meaning |
| --- | --- |
| `anilist` | Relies on AniList for an important step or uses AniList as a core part of its operation. |
| `donghua` | Provides or supports Chinese animation. |
| `dub only` | Provides dubbed content only. |
| `dubtitles` | Provides subtitle or dub-title features, usually for dubbed content. |
| `enhancements` | Adds UI, workflow, or usability improvements. |
| `fast sources` | Generally provides fast search, loading, or source responses. |
| `large library` | Covers a broad or particularly large content catalog. |
| `manhwa` | Focuses on Korean comics. |
| `misc` | General-purpose extension without a more specific category. |
| `nsfw` | Contains or supports adult content. |
| `stable sources` | Sources are generally reliable and consistently available. |
| `sub & dub` | Provides both subtitled and dubbed content. |
| `sub only` | Provides subtitled content only. |

Tags are descriptive filters, not guarantees.

## Testing

Run relevant checks from the repository root:

```bash
# JavaScript syntax
node --check src/anime/<provider>/provider.js

# JSON syntax
node -e 'JSON.parse(require("fs").readFileSync("src/anime/<provider>/manifest.json"))'
node -e 'JSON.parse(require("fs").readFileSync("marketplace/main.json"))'

# Whitespace errors
git diff --check
```

Adjust paths for manga providers, plugins, or other changed files. Use the [marketplace checker](https://seanime-contributions.github.io/Seanime-Providers/down-detector.html) for an end-to-end check when the source is reachable.

## Commits and pull requests

Keep commits focused and describe the user-visible change, for example:

```text
Fix [extension] episode parsing
```

A pull request should state:

1. What changed and why.
2. Which extension is affected.
3. How it was tested.
4. Any known limitations.

Before submitting, review `git diff`, remove unrelated formatting changes, and confirm that no secrets or generated files are included.

The repository may remove or disable extensions in response to valid legal requests or source-owner concerns. Do not submit changes intended to evade a restriction.

## Reporting broken sources

For a new provider or improvement, use the [Provider request template](https://github.com/Seanime-contributions/Seanime-Providers/issues/new?template=provider_request.yml).

For a broken source, include the extension ID, source URL or search term, Seanime logs, failing operation, and a minimal sanitized response sample. Remove cookies, tokens, and personal information from logs or HTML.
