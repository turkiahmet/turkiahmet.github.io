# Public content workflow

The public profile and work list are owned by `content/site-data.json` (schema version 1). Private drafts and messages must never be committed to this repository.

Run `python3 tools/build_site.py` after a reviewed public data change. It generates the Arabic, Turkish, and English home, CV, and research pages and the sitemap. The master's original bibliographic record, citation controls, BibTeX, and RIS remain preserved in the retained templates and download files.

Each public work has a stable lowercase id, three titles and summaries, a scientific status (`published` or `in_progress`), a type, an optional year, and source links. A doctoral work in progress has no invented publication year. Private draft visibility belongs to the protected backend and must be filtered before publishing this JSON.

The original Turkish and English abstracts are retained in `content/abstracts.json`. They are explicitly marked as the original text from the 2021 thesis. There is no asserted original Arabic abstract.

Stable scholarly profile links are stored in `content/profile-links.json`, separately from the profile and work data that the administration backend publishes. The builder uses these links in `Person.sameAs` on generated pages and adds the Google Scholar link beside ORCID on each language's home page. They provide direct access and connect the public profiles; they do not guarantee search indexing.

## Public CV PDFs

Current PDF snapshots are in `site/downloads/`. To regenerate them after changing profile data:

1. Install `reportlab`, `arabic-reshaper`, and `python-bidi` from the standard Python package registry.
2. Ensure local Noto Naskh Arabic regular/bold and DejaVu Sans regular/bold fonts exist at the paths in `tools/build_cv_pdfs.py` (on Ubuntu: `fonts-noto-core` and `fonts-dejavu-core`).
3. Run `python3 tools/build_cv_pdfs.py`.

The PDF builder reuses the same public data as the web pages. Do not upload a private CV that contains telephone numbers, identity details, or family information in place of these public versions.

## Optional protected backend

`site/services.json` contains a public `backendOrigin` setting. Leave it blank until the actual backend has been deployed and tested. The site stays usable with its ordinary email link when it is blank or the backend is unavailable.

The public bridge reads `/api/config` on that backend, renders an attachment-free optional-identity contact form only when enabled, and submits aggregate page metrics when enabled. It never includes the private administration page or private credentials. Public site code does not implement owner authentication by hiding a button.

## Search Console

The owner-supplied verification meta element for this GitHub URL is included in the root and generated pages. Keep it during public content rebuilds. This file is a public ownership verification marker, not a secret credential.
