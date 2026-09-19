# Comic Canvas

Build comic books with AI assistance: an image-generation canvas with
parent → child lineage, a story/panel layout editor with booklet PDF export,
and narrow **agent tasks** that extract characters, locations, and concept
art from a source book.

![Example canvas showing image lineage from sketches to final illustrations](assets/example-canvas.jpg)

## Open the app

**<https://abvstudio.net/>** — nothing to install. The app runs entirely in
your browser; there is no Comic Canvas server. Your projects, images, keys,
and settings stay on your device.

Install it as an app (the browser's install prompt, or the **Install** hint
on the landing page) to use it offline and to keep the browser from
evicting its storage.

## What you need

- **A browser with private file storage:** Chrome, Edge, Firefox, or
  Safari 26+. Private-browsing windows usually cannot store projects; the
  landing page says so when that is the case.
- **Image generation:** a Google AI Studio (Gemini) key, pasted into
  Settings (gear icon). The key is validated once and stored in the browser.
- **Agent tasks:** an OpenAI-completions compatible text endpoint. See
  [User Guide → Setup](user-guide.md#setup).

## Your data

Everything lives in the browser's storage for `abvstudio.net` on this
device. Back a project up with **Export** on its card (a zip in the
`projects/<slug>/` layout, browsable with any unzip tool) or **Export all
projects** in Settings; restore with **Import project (zip)** or **Import
project folder** on the landing page.

!!! warning "Pre-1.0 schema warning"
    Stored document shapes may change between deploys without migration.
    Keep exports of projects you care about; an old export can be re-imported
    after a schema change only if the shapes still line up.

## Where to go next

- **[User Guide](user-guide.md)** — setup and the day-to-day flow.
- **[Architecture](architecture.md)** — storage, services, providers, and
  the in-browser agent runtime.
- **[Development & Release Model](development.md)** — branches, gate,
  deploy.
- **[Pi Agent Methodology](pi-agent-integration.md)** — how pi is embedded
  as an application agent, and why the pattern generalizes.
