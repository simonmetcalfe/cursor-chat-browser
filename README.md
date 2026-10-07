# Cursor Chat Browser

A web application for browsing and managing chat histories from the Cursor editor's AI chat feature. View, search, and export your AI conversations in various formats.

This fork adds a **Download All** button that exports every conversation from every project as a single zip archive. It also fixes conversation loading: chats that Cursor never linked to a project folder were previously skipped without warning, and are now found and included.

## Features

- 🔍 Browse and search all workspaces with Cursor chat history
- 🌐 Support for both workspace-specific and global storage (newer Cursor versions)
- 🤖 View both AI chat logs and Composer logs
- 📁 Organize chats by workspace
- 🔎 Full-text search with filters for chat/composer logs
- 📱 Responsive design with dark/light mode support
- ⬇️ Export chats as:
  - Markdown files
  - HTML documents (with syntax highlighting)
  - PDF documents
- 📦 Export **every** conversation across **every** project as a single zip archive
- 🎨 Syntax highlighted code blocks
- 📌 Bookmarkable chat URLs
- ⚙️ Automatic workspace path detection

## Changes in this fork

### Extracts every conversation, not just some

Cursor stores every conversation in one global database with **no explicit project reference** — the owning project has to be inferred from file paths the conversation touched. Upstream inspected only a handful of the fields Cursor writes those paths to, and silently discarded any conversation it could not place.

Attribution now consults every field Cursor is known to record a path in — `originalFileStates`, `allAttachedFileCodeChunksUris`, `context.mentions.fileSelections`, `trackedGitRepos`, tool-call display paths and others — tried most-reliable first. Conversations that were previously invisible are now listed under the project they belong to.

Conversations that reference no file path anywhere (typically short exchanges that never touched a file) genuinely cannot be attributed to a project. Rather than being dropped they are grouped under an **`unassigned`** project, so they stay browsable and are included in exports.

Attribution deliberately relies only on structured path fields. Matching raw conversation text against project paths would place more conversations, but would misfile any conversation that merely *mentions* another project.

### Download All

A single **Download All** button on the Projects page exports every conversation in every project as one zip archive. Files inside are named:

```
project-YYYY-MM-DD-HHMMSS-conversation_name.md
```

for example `my-project-2026-03-01-113128-Fixing_the_sensor_loop.md`. The timestamp is the conversation's own last-updated time (falling back to its creation time) in local time, so files sort chronologically. Names are sanitised for the filesystem, and same-second collisions get a `-2`, `-3` suffix.

The archive is built server-side in a single database pass. Requesting each project in turn would re-scan the entire database once per project.

### Performance

Prefix lookups used `LIKE 'prefix%'`, which SQLite cannot serve from an index — its `LIKE` is case-insensitive by default — so every query performed a full scan of a chat database that can run to gigabytes. These are now range bounds (`key >= 'bubbleId:' AND key < 'bubbleId;'`), which use the table's implicit unique index, turning each lookup into an indexed range read.

Conversation loading also moved into a single shared module (`src/lib/conversations.ts`), so the project list, the workspace view and the exporter can no longer disagree about which conversations exist — upstream had two separate copies of the attribution logic. Loading now takes one pass over the database instead of one pass per project.

### Toolchain

- **Next.js 14 → 16** — migrated dynamic route `params` to the async form, and wrapped `useSearchParams` in a Suspense boundary
- **better-sqlite3 11 → 13** — v11 does not compile against the V8 API in current Node releases; v13 ships prebuilt binaries, so no `node-gyp` build is needed
- **ESLint 8 → 9** — `.eslintrc.json` replaced by flat config in `eslint.config.mjs`, since `next lint` was removed in Next.js 16
- Added the missing `@radix-ui/react-dialog` dependency required by the global search dialog
- Added `jszip` for archive generation

## Prerequisites

- Node.js 22+ and npm (required by `better-sqlite3` 13; Next.js 16 needs 20.9+)
- A Cursor editor installation with chat history

## Installation

1. Clone the repository:
  ```bash
  git clone https://github.com/simonmetcalfe/cursor-chat-browser.git
  cd cursor-chat-browser
  ```

2. Install dependencies:
  ```bash
  npm install
  ```

3. Start the development server:
  ```bash
  npm run dev
  ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Configuration

The application automatically detects your Cursor workspace storage location based on your operating system:

- Windows: `%APPDATA%\Cursor\User\workspaceStorage`
- WSL2: `/mnt/c/Users/<USERNAME>/AppData/Roaming/Cursor/User/workspaceStorage`
- macOS: `~/Library/Application Support/Cursor/User/workspaceStorage`
- Linux: `~/.config/Cursor/User/workspaceStorage`
- Linux (remote/SSH): `~/.cursor-server/data/User/workspaceStorage`

If automatic detection fails, you can manually set the path in the Configuration page (⚙️).

**Note:** Recent versions of Cursor have moved chat data storage from workspace-specific locations to global storage. This application now supports both storage methods to ensure compatibility with all Cursor versions.

## Usage

### Browsing Logs
- View all workspaces on the home page
- Browse AI chat logs by workspace
- Access Composer logs from the navigation menu
- Navigate between different chat tabs within a workspace
- View combined logs with type indicators
- See chat and composer counts per workspace

### Searching
- Use the search bar in the navigation to search across all logs
- Filter results by chat logs, composer logs, or both
- Search results show:
  - Type badge (Chat/Composer)
  - Matching text snippets
  - Workspace location
  - Title
  - Timestamp

### Exporting
Each log can be exported as:
- Markdown: Plain text with code blocks
- HTML: Styled document with syntax highlighting
- PDF: Formatted document suitable for sharing

To export everything at once, use **Download All** on the Projects page. It produces a single zip
containing every conversation from every project as Markdown, named
`project-YYYY-MM-DD-HHMMSS-conversation_name.md`.

## Development

Built with:
- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui components
- SQLite for reading Cursor's chat database

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a list of changes.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
