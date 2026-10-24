# CloudGram project review

Review date: 2026-10-24  
Reviewed revision: `14f6ec7`

## Current position

CloudGram is an early MVP. The core Telegram-backed file manager is implemented, but reliability and recovery need improvement before regular use. The architecture is small enough to improve incrementally without a rewrite.

| Area               | Current position                                                                  |
| ------------------ | --------------------------------------------------------------------------------- |
| Foundation         | React, Vite, Material UI, Redux, IndexedDB, and Telegram integration              |
| Authentication     | Phone, OTP, and 2FA flows implemented; public login screen loads                  |
| File management    | Folder creation/navigation, upload, download, delete, and progress UI implemented |
| Recovery and sync  | No metadata backup, restoration, or cross-device synchronization                  |
| Validation         | Build and ESLint pass; formatting check fails in two files                        |
| Automated coverage | No application tests or CI build verification found                               |

## Review scope and verification

-   Reviewed application code and CI workflows.
-   Installed dependencies from the lockfile using `npm ci --no-audit --no-fund`.
-   `npm run build` passed, with a warning about the JavaScript bundle size.
-   `npm run lint` passed.
-   `npm run prettier` failed for `README.md` and `.github/workflows/dependency-audit-sarif.yml`.
-   Ran `npm audit --json` and `npm audit --omit=dev --json`.
-   Opened the local application without Telegram API configuration and observed a blank page with an API configuration error.
-   Opened the advertised public deployment at <https://cloudgram.vercel.app/> and confirmed that its login screen loads. Its deployed revision was not verified.
-   Did not sign into a Telegram account. Authenticated login, upload, download, and deletion remain unverified end to end. Behavioral findings below are based on source inspection unless explicitly identified as browser observations.

## Prioritized findings

### 1. Make the file catalog recoverable — highest priority

Files are uploaded to Telegram, but folder structure and Telegram message references exist only in IndexedDB. Clearing browser data or opening another browser loses CloudGram's catalog, even though uploaded files remain in Saved Messages. There is no reconstruction flow.

**Recommended improvement:** Start with metadata export/import. If cross-device use is intended, introduce recoverable metadata in Telegram and a restoration flow.

**Evidence:** [Database schema](src/db/config.js), [explorer](src/pages/main/Explorer.jsx).

### 2. Fix upload completion and failure handling

Upload creates a local record before the Telegram operation succeeds. After success, it writes the Telegram message ID but never refreshes the explorer. A newly displayed file can therefore retain an undefined message ID until navigation or reload. Failed uploads leave local entries behind, with errors only logged to the console.

**Recommended improvement:** Await persistence, refresh after completion, and expose pending and failed states with retry. Prevent download and deletion actions while the Telegram message reference is unavailable.

**Evidence:** [Upload flow](src/components/explorer/UploadFile.jsx), [file actions](src/components/explorer/File.jsx).

### 3. Correct downloads and handle missing Telegram files

The download function sets `link.download = name` without receiving or declaring the filename. In a browser, this can resolve to `window.name`, so the original filename is not preserved reliably. It also accesses `message[0].media` without handling an empty result, such as when someone deletes the message directly in Telegram.

**Recommended improvement:** Pass the original filename into the download operation, handle missing messages and media, and show actionable errors while clearing failed progress state.

**Evidence:** [Download implementation](src/utils/downloadFile.js), [download caller](src/components/explorer/File.jsx).

### 4. Complete session and account management

There is no logout control or Telegram logout call. The existing logout action only changes Redux state, while the installed `StoreSession` implementation persists the authorization key in localStorage. Metadata has no account identifier, so account switching would risk mixing catalogs.

**Recommended improvement:** Add account identification, Telegram session revocation, persisted-session cleanup, and account-scoped metadata.

**Evidence:** [Session setup](src/services/telegram.js), [logout action](src/redux/actions/authAction.js), [app bar](src/components/AppBar.jsx), [database schema](src/db/config.js). Session persistence was also checked in the installed `telegram@2.17.9` implementation.

### 5. Make startup failures recoverable

Authentication checking runs after every App render because the effect has no dependency array. Connection errors have no catch path, potentially leaving the splash screen indefinitely. In the local browser check, missing API configuration produced a blank page with the error `Your API ID or Hash cannot be empty or undefined`.

**Recommended improvement:** Use a controlled initialization flow and show configuration and connection errors with an appropriate recovery action.

**Evidence:** [App startup](src/App.jsx), [client initialization](src/services/telegram.js), [configuration](src/config/config.js).

### 6. Refresh dependencies and strengthen release checks

At review time, `npm audit` flagged 20 packages: 13 high, 6 moderate, and 1 low. Excluding development dependencies still flagged 8 packages: 3 high, 4 moderate, and 1 low. These are dependency findings, not confirmed exploitable application vulnerabilities; package counts can include related dependency chains.

CI uses `npm install`, has no defined Node version, and does not verify the production build. The dependency audit runs manually and uses exit code zero even when findings exist. The formatting check currently fails in two files.

**Recommended improvement:** Review advisory applicability and update affected packages in small batches. Use `npm ci`, define the supported Node version, and run lint, formatting, and build checks on pull requests. Run dependency checks automatically with a deliberate failure policy. Add focused automated coverage for authentication, transfer completion/failure, and metadata restoration when test implementation is authorized.

**Evidence:** [Dependencies and scripts](package.json), [lockfile](package-lock.json), [lint workflow](.github/workflows/lint.yml), [formatting workflow](.github/workflows/prettier.yml), [audit workflow](.github/workflows/dependency-audit-sarif.yml).

### 7. Align privacy claims with actual behavior

The README's claim that third parties cannot access files is too broad. CloudGram adds no client-side file encryption, and Telegram distinguishes cloud-chat encryption from end-to-end encryption.

**Recommended improvement:** Explain the storage and session model accurately. Consider optional client-side file encryption if confidential storage is a product goal.

**Evidence:** [README privacy claim](README.md), [upload implementation](src/utils/uploadFile.js), [Telegram's encryption explanation](https://telegram.org/faq#q-so-how-do-you-encrypt-data).

## Product improvements after reliability fixes

-   Add rename, move, and delete operations for folders.
-   Add search and sorting.
-   Support multiple-file uploads.
-   Show file sizes and dates.
-   Provide clear transfer errors, retry, and cancellation controls.
-   Reconstruct breadcrumbs after refresh and browser back/forward navigation.
-   Improve responsive modal sizing and keyboard accessibility.

The existing folder component has no management actions, uploads accept one file at a time, and breadcrumbs are maintained in component state rather than reconstructed from the folder hierarchy.

**Evidence:** [Folder component](src/components/explorer/Folder.jsx), [upload dialog](src/components/explorer/UploadFile.jsx), [explorer](src/pages/main/Explorer.jsx), [breadcrumbs](src/components/explorer/WorkingDir.jsx).

## Performance improvements

-   Query folders through the existing parent index instead of scanning the entire database whenever a folder opens.
-   Investigate targeted bundle splitting. The measured production JavaScript bundle was approximately 1.12 MB minified and 347 KB gzipped.
-   Evaluate browser memory use and large-file behavior before promising reliable large-file transfers. The current upload reads the file into memory, and download creates a Blob from the downloaded content.

**Evidence:** [Explorer query](src/pages/main/Explorer.jsx), [parent index](src/db/config.js), [upload utility](src/utils/uploadFile.js), [download utility](src/utils/downloadFile.js), production build output.

## Recommended delivery order

1. Metadata recovery.
2. Upload/download correctness and failure handling.
3. Session management and startup recovery.
4. Dependency maintenance and CI checks.
5. File-management usability and performance.

No application source files or tests were changed during the review.
