# CloudGram

CloudGram is an open-source application that allows you to store files in an organized manner on top of Telegram-like cloud storage. It acts as a different Telegram client application solely focused on file uploading and storage. All the uploaded files are stored on your own Telegram account's saved messages page.

CloudGram uses Telegram for file storage and IndexedDB for the file catalog in your browser. See [Storage and privacy](#storage-and-privacy) for the storage model and its limitations.

## Features

- **Upload and Store Files**: Select multiple files and upload them sequentially to your Telegram Saved Messages. Stop an upload queue or cancel a download, and retry unfinished items without sending completed files again.

- **Organized File Management**: Create, rename, move, and delete folders. Search the current folder, sort by name, size, or date, and switch between compact list and grid views. Folder deletion includes its contents and asks for confirmation before removing referenced Telegram files.

- **Account Management**: View the signed-in account and log out to use another Telegram account. Each account has a separate local catalog and backup state. Catalogs with a known owner migrate automatically; older unassigned catalogs require an explicit import into an empty account catalog.

- **Recoverable Catalog**: Folder names, hierarchy, and Telegram message references are cached in this browser and automatically backed up as versioned JSON documents in your Telegram Saved Messages. Restore a recent snapshot when using another browser or recovering local data.

## Storage and privacy

- **Files**: The browser sends uploaded files to Telegram Saved Messages. This repository has no separate CloudGram file-storage backend. Telegram stores cloud-chat content on its servers; Saved Messages are not end-to-end encrypted. CloudGram adds no client-side file encryption. See [Telegram's encryption explanation](https://telegram.org/faq#q-so-how-do-you-encrypt-data) and [cloud-chat privacy policy](https://telegram.org/privacy#3-3-1-cloud-chats).
- **File catalog**: IndexedDB holds folder names, hierarchy, and Telegram message references for the current browser and site address. CloudGram automatically uploads catalog snapshots to Saved Messages while the app is open. Check the backup status before closing the app; pending changes can be lost if site data is cleared before a backup finishes. After signing in to the same account in another browser, CloudGram offers to restore a compatible snapshot. Restoration replaces the local catalog without deleting Telegram files or older snapshots. Different catalog versions require a choice; this is backup and recovery, not simultaneous cross-device synchronization. Deleting a backup directly in Telegram removes that recovery copy, and restoring metadata cannot recover files deleted from Telegram.
- **Telegram session**: Telegram authorization data is persisted in localStorage so you can stay signed in. This session grants access to your Telegram account, beyond the files shown in CloudGram. Log out through the account menu to request Telegram logout and remove this browser's saved authorization data. If Telegram logout cannot be confirmed, the menu offers local session removal and explains how to review remaining sessions in Telegram Settings → Devices. Logout keeps account catalogs and Telegram files; it does not erase all local metadata. Other open CloudGram tabs stop using the previous session when the account changes. Treat browser storage and backups containing authorization data as sensitive.
- **Trust**: CloudGram's frontend can access selected files, its local catalog, and its saved Telegram session. Use a device and deployment you trust. Open-source availability does not guarantee that a hosted deployment runs the same code. There is no guarantee that Telegram, a modified frontend, browser extensions with site access, or someone with access to your browser profile cannot access your data.

## File transfer limits

Uploads read one 512 KiB part at a time rather than buffering the whole file. Telegram still enforces the signed-in account's upload limits. Cancellation stops at the next checkpoint after the current request returns.

Downloads of at least 64 MiB use a Save File dialog and stream to disk when the browser supports `showSaveFilePicker`. Other downloads use a Blob and require enough browser memory for the file; use Telegram Saved Messages if a large download exceeds available memory. Incomplete downloads fail instead of being saved as complete files. Sizes and dates for older uploads are retrieved when their Telegram references remain available; unknown folder creation dates are shown as unavailable.

## Getting Started

You can access CloudGram directly through the web without setting up a local development environment. Simply visit [cloudgram.vercel.app](https://cloudgram.vercel.app) to start using CloudGram immediately or [setup locally](#Development-Setup).

## Development Setup

If you prefer to set up a local development environment, follow these steps:

Use Node.js 24.15 or newer in the Node 24 release line, or another version supported by `package.json`.

1. Clone the CloudGram repository to your local machine:

```bash
git clone https://github.com/MQ-xz/CloudGram.git
```

2. Open the project directory:

```bash
cd CloudGram
```

3. Update .env

    Create a copy for .env.example and name it as .env and VITE_API_ID and VITE_API_HASH with your own telegram application API_ID and API_HASH. for more info about obtaining API check [Creating your Telegram Application](https://core.telegram.org/api/obtaining_api_id).

4. Install the project dependencies:

```bash
npm ci
```

5. Start the development server:

```bash
npm run dev
```

6. Access CloudGram in your web browser at `http://localhost:5173/`.

## Validation

```bash
npm run lint
npm run prettier
npm test
npm run build
npm audit --audit-level=high
```

The tests use isolated browser databases and simulated Telegram responses; they never use a real account. CI runs these checks on pushes and pull requests with Node 24. Dependency scanning also runs weekly and fails on high or critical findings. Telegram code and routes are loaded separately to keep the initial application bundle smaller.

## Contribution, Feature Requests & Bugs

- For Contribution read [CONTRIBUTING.md](https://github.com/MQ-xz/CloudGram/blob/main/CONTRIBUTING.md).
- Use GitHub issues for opening bugs and feature requests
