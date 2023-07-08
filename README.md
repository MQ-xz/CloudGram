# CloudGram

CloudGram is an open-source application that allows you to store files in an organized manner on top of Telegram-like cloud storage. It acts as a different Telegram client application solely focused on file uploading and storage. All the uploaded files are stored on your own Telegram account's saved messages page.

CloudGram takes advantage of Telegram's robust cloud storage infrastructure and utilizes IndexedDB to store meta-information about files and folders locally on your browser. This approach ensures efficient, secure, and private file management directly from your web browser.

## Features

- **Upload and Store Files**: Easily upload files CloudGram's intuitive interface. All files are stored securely on your own Telegram account's saved messages page.

- **Organized File Management**: CloudGram provides a simple yet powerful folder-based organization system for your files. Create folders and maintain a structured file storage system.

- **Privacy**: CloudGram prioritizes your privacy. Since the data is stored locally on your browser and in your Telegram account, neither CloudGram nor any third party can access your files and data without your explicit permission.

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

3. Install the project dependencies:

```bash
npm install
```

4. Start the development server:

```bash
npm run dev
```

5. Access CloudGram in your web browser at `http://localhost:5173/`.

## Contribution, Feature Requests & Bugs
- For Contribution read CONTRIBUTING.md.
- Use GitHub issues for opening bugs and feature requests

## Contact
If you have any questions, suggestions, or feedback, please feel free to contact us via out telegram group [https://t.me/CloudGramApp](https://t.me/CloudGramApp).

Enjoy free and private cloud storage with CloudGram!