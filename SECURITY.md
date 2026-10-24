# Security Policy

If you discover a security vulnerability in CloudGram, please report it privately so it can be investigated and addressed before public disclosure.

## Supported Versions

Security fixes target the latest code on the [main branch](https://github.com/MQ-xz/CloudGram/tree/main). Older revisions are not maintained separately. Please check whether an issue still affects `main` and include the affected commit in your report when possible.

| Version               | Security support          |
| --------------------- | ------------------------- |
| Latest code on `main` | Supported                 |
| Older revisions       | Not maintained separately |

## Reporting a Vulnerability

### Recommended: GitHub Private Vulnerability Reporting

1. Open [Report a vulnerability](https://github.com/MQ-xz/CloudGram/security/advisories/new), or go to the repository's [Security Advisories](https://github.com/MQ-xz/CloudGram/security/advisories) page and select **Report a vulnerability**.
2. Describe the issue, its impact, and how to reproduce it using the guidance below.
3. Submit the report privately and use the report thread for follow-up discussion.

GitHub makes this reporting option available when private vulnerability reporting is enabled for the repository. See [GitHub's reporting guide](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately) for details.

**Do not disclose an unfixed vulnerability in a public issue, pull request, discussion, or comment.** Use [GitHub Issues](https://github.com/MQ-xz/CloudGram/issues) for ordinary bugs and feature requests that do not expose a security issue.

### Fallback Contact Methods

If GitHub private reporting is unavailable or you cannot use it, use one of the existing contact methods:

- Email: [kmahshooq@gmail.com](mailto:kmahshooq@gmail.com), with the subject `CloudGram security report: <short description>`.
- Telegram: [@MQ_XZ](https://t.me/MQ_XZ).

GitHub private reporting is the preferred channel; email and Telegram are fallback options.

## What to Include

Include as much of the following as you can. You can submit an initial report even if some details are unavailable.

- A short summary and the affected feature or component.
- The affected commit or version, browser, operating system, and relevant configuration.
- Whether you reproduced the issue locally or on a deployed instance.
- Required conditions, such as authentication, account access, or user interaction.
- Clear reproduction steps and a minimal proof of concept, if available.
- Expected behavior, observed behavior, and the security impact.
- Relevant logs or screenshots with sensitive information removed.
- Any suggested mitigation or fix, if you have one.

For dependency findings, include the package name, installed version, advisory link, and any evidence showing how CloudGram is affected. Clearly distinguish reproduced behavior from suspected impact.

Do not include passwords, one-time login codes, Telegram session data or authorization keys, API hashes, or other users' private files. Use synthetic examples and redact sensitive values.

## Investigation and Coordinated Disclosure

Reports are reviewed to understand their impact and determine whether a fix is needed. Maintainers may request additional reproduction details and discuss mitigations or a proposed fix through the private reporting channel.

Please coordinate public disclosure with the maintainers so affected users have an opportunity to update. Response and remediation times depend on severity, reproducibility, and maintainer availability; this project does not promise a fixed response deadline. Follow up through the same private channel if needed.

Mention whether you would like public credit, the name or handle to use, or whether you prefer to remain anonymous.

## Responsible Research

- Prefer a local development instance and use only accounts, files, and systems you own or have permission to test.
- Use the minimum actions and data needed to demonstrate the issue.
- Avoid disrupting services, accessing other users' information, or modifying or deleting their data.
- If you encounter private information unexpectedly, stop accessing it and describe the exposure without copying or sharing the information.
- Report vulnerabilities in Telegram or another dependency that are independent of CloudGram to the relevant project's security team. Include the CloudGram impact here when applicable.

Thank you for helping improve CloudGram's security.
