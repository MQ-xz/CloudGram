# CloudGram

CloudGram is an open-source application that allows you to store files in an organized manner on top of Telegram-like cloud storage. It acts as a different Telegram client application solely focused on file uploading and storage. All the uploaded files are stored on your own Telegram account's saved messages page.

CloudGram uses Telegram for file storage and IndexedDB for the file catalog in your browser. See [Storage and privacy](#storage-and-privacy) for the storage model and its limitations.

## Features

-   **Upload and Store Files**: Upload files through CloudGram's interface to your Telegram account's Saved Messages.

-   **Organized File Management**: CloudGram provides a simple yet powerful folder-based organization system for your files. Create folders and maintain a structured file storage system.

-   **Browser-based Catalog**: Folder names, hierarchy, and Telegram message references are stored in this browser. They are not currently backed up or synchronized between devices.

## Storage and privacy

-   **Files**: The browser sends uploaded files to Telegram Saved Messages. This repository has no separate CloudGram file-storage backend. Telegram stores cloud-chat content on its servers; Saved Messages are not end-to-end encrypted. CloudGram adds no client-side file encryption. See [Telegram's encryption explanation](https://telegram.org/faq#q-so-how-do-you-encrypt-data) and [cloud-chat privacy policy](https://telegram.org/privacy#3-3-1-cloud-chats).
-   **File catalog**: IndexedDB holds folder names, hierarchy, and Telegram message references for the current browser and site address. Clearing site data, using another browser, or changing devices loses access to that catalog. The original uploads remain in Telegram, but CloudGram cannot currently restore their folder organization automatically.
-   **Telegram session**: Telegram authorization data is persisted in localStorage so you can stay signed in. This session grants access to your Telegram account, beyond the files shown in CloudGram. Treat browser storage and backups containing it as sensitive.
-   **Trust**: CloudGram's frontend can access selected files, its local catalog, and its saved Telegram session. Use a device and deployment you trust. Open-source availability does not guarantee that a hosted deployment runs the same code. There is no guarantee that Telegram, a modified frontend, browser extensions with site access, or someone with access to your browser profile cannot access your data.

## Getting Started

You can access CloudGram directly through the web without setting up a local development environment. Simply visit [cloudgram.vercel.app](https://cloudgram.vercel.app) to start using CloudGram immediately or [setup locally](#Development-Setup).

## Development Setup

If you prefer to set up a local development environment, follow these steps:

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
npm install
```

5. Start the development server:

```bash
npm run dev
```

6. Access CloudGram in your web browser at `http://localhost:5173/`.

## Contribution, Feature Requests & Bugs

-   For Contribution read [CONTRIBUTING.md](https://github.com/MQ-xz/CloudGram/blob/main/CONTRIBUTING.md).
-   Use GitHub issues for opening bugs and feature requests
