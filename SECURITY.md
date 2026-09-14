# Security

## Reporting a vulnerability

Report privately through [GitHub Security Advisories](https://github.com/gowtham472/nextship/security/advisories/new).
Please do not open a public issue for a vulnerability.

Include what you did, what happened, and what you expected. A reproduction against a
throwaway cloud account is worth more than a description.

Expect a first reply within a week. This is a small project maintained by one person, so
that is a realistic commitment rather than an aspirational one.

## What this tool has access to

nextship runs on your machine or in your CI with your cloud credentials. It is worth
knowing exactly what that means, because the honest answer is "quite a lot".

**It reads:**

- Your `DIGITALOCEAN_TOKEN`, which speaks for your whole account within its scopes
- Your project's env files, including secrets, which it mounts into a Docker build
- Your project's source, which it builds inside a container

**On a server, it also uses:**

- Your SSH client, agent and keys, to log in to the server as root or a sudo user once for
  `server add`, and as the `nextship` user after that. nextship never reads a private key:
  it runs your `ssh`, which does.
- Root on that server during `server add`, and the `nextship` user's Docker access after,
  which is root-equivalent.

**It never sends your code anywhere except your own cloud account or your own server.** There is no
nextship server. Nothing is collected, and there is no telemetry.

## How credentials are handled

| Secret | Handling |
|---|---|
| `DIGITALOCEAN_TOKEN` | Read from the environment. Written to a temporary Docker config directory with `0600` permissions for `docker push`, then removed, so it never appears in a process argument list where other local processes could read it |
| Env files | Mounted as BuildKit secrets, which are excluded from image layers and from the build cache key. They are never copied into the image |
| Server Actions encryption key | Stored in `.nextship/secrets.local.json`, which nextship gitignores on creation so it cannot be committed |
| Log stream URLs | These carry an embedded access token, so they are treated as secrets: never printed, never logged, never included in an error message |
| Server host keys | Pinned in `nextship.json` on first use after the fingerprint is shown in the plan. Every connection checks strictly against the pinned key, so a changed key is refused rather than prompted about |
| SSH connections | Batch mode, no password authentication, the system `ssh` started without a shell. Values placed in a remote command are validated or single-quoted |
| Values pushed by `env push` | Redacted from any error message before it is shown, because an API validation error can quote the field it rejected |

## Known exposures, stated plainly

These are properties of the design, not bugs. They are listed so you can decide whether
they are acceptable for your threat model.

- **The built image contains your Server Actions encryption key.** Next.js compiles it
  into `server-reference-manifest.json` at build time. Anyone who can pull your image can
  read it, so registry access is equivalent to key access.
- **Pushed environment variables are decrypted in the running container.** Your platform
  encrypts them at rest, but anyone who can open a console on the app can read them.
- **The `nextship` user on a server is root-equivalent.** It is in the `docker` group, and
  Docker access is root access. Anyone holding a key authorised for it controls the server.
- **`nextship destroy` permanently removes an app.** It requires the app name as an
  argument and `--yes`, but it is not recoverable.

## Scope

In scope: anything that leaks a credential, writes outside the project or the app
nextship recorded, accepts a server whose host key is not the pinned one, or lets a malicious project being deployed escape the build container.

Out of scope: vulnerabilities in Docker, Next.js, or a cloud provider's API. Report those
upstream.
