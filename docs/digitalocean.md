# DigitalOcean setup: the token, what it does, and what it costs

Everything needed before `nextship deploy` exists, written so the token can be
created with the smallest useful permissions rather than the easiest ones.

**You do not need this yet.** v0.3 is not built. This is here so the account is
ready and there are no surprises about cost.

Author: Gowtham
Date: 2026-09-07

---

## 1. What the token actually is

A DigitalOcean **personal access token** (PAT) is a long string that authenticates
API calls as you. It is not a login for a single service; it is a credential that
speaks for your whole account within whatever scopes it carries.

DigitalOcean's own guidance is blunt about it: *"Keep your tokens secret. They
function like passwords."* A full-access token can create and destroy every
resource your team role permits, including Droplets, databases and DNS. That is why
the scopes below matter.

Two properties worth knowing before creating one:

- **Scopes cannot be changed after creation.** You can rename or regenerate a token,
  but to change what it can do you create a new one.
- **The value is shown once.** Copy it when it appears, or regenerate it.

## 2. What nextship will use it for

Every operation planned for v0.3 and v0.4, and nothing else:

| Operation | Why | Resource |
|---|---|---|
| Create the container registry, once | Somewhere to push the image | Registry |
| Get registry credentials, then push | The image has to reach DigitalOcean before anything can run it | Registry |
| Create the App Platform app, once | The thing that runs the container | App |
| Create a new app revision per deploy | Each deploy is a new immutable revision, which is what makes rollback possible | App |
| Read deployment status | To gate on health rather than assume success | App |
| Roll back to a previous revision | `nextship rollback` | App |
| Read logs | `nextship logs` | App |
| Set environment variables | `nextship env push` | App |
| Delete what it created | `nextship destroy`, and nothing beyond what nextship made | App, Registry |

It will never touch Droplets, databases, DNS, Spaces or billing.

## 3. Creating the token

1. Sign in to the DigitalOcean control panel.
2. Go to **Account**, then **API**.
3. Under **Personal access tokens**, choose **Generate New Token**.
4. **Name:** something that says what it is for, such as `nextship-cli`. If it ever
   appears in a breach report or an audit log, the name is what tells you what to
   revoke.
5. **Expiration:** pick the shortest period you will tolerate re-creating it. Ninety
   days is a reasonable default; a token that never expires is a credential you will
   forget you issued.
6. **Scopes:** choose **Custom Scopes**, not Full Access, and grant only:

   | Resource | Permissions | Why |
   |---|---|---|
   | Registry (`registry`) | Create, Read, Update, Delete | Create the registry once, push images, and remove old ones so storage does not grow without limit |
   | Apps (`app`) | Create, Read, Update, Delete | Create the app, deploy revisions, read status and logs, roll back, and tear down |

   Delete is included deliberately: without it `nextship destroy` cannot clean up
   after itself, and old images accumulate as a monthly charge.

7. **Generate Token**, then copy the value immediately.

If a custom-scoped token turns out to be missing a permission the API needs, the
error will name it. Add that scope to a new token rather than falling back to Full
Access.

## 4. Giving it to nextship

Set it as an environment variable in your shell. Do not put it in a file inside the
project, do not commit it, and do not paste it into a chat, an issue or a log.

PowerShell, current session only:

```powershell
$env:DIGITALOCEAN_TOKEN = "paste-the-token-here"
```

Git Bash or WSL, current session only:

```bash
export DIGITALOCEAN_TOKEN="paste-the-token-here"
```

For CI, store it as an encrypted secret in the platform (a GitHub Actions repository
secret, for example) and expose it to the job as `DIGITALOCEAN_TOKEN`.

nextship will read it from the environment, the same way it reads AWS credentials
from the ambient chain. It will never ask you to type it, never write it to disk,
and never include it in output.

## 5. If the token leaks

Revoke first, investigate second. In **Account**, then **API**, delete the token.
That takes effect immediately and every call using it starts failing. Then create a
replacement with a new name so the old one cannot be confused with the new one in
audit logs.

This is the main practical reason to use custom scopes and an expiry: a leaked token
limited to a registry and one app is a bad afternoon, while a leaked full-access
token with no expiry is an incident.

## 6. What it costs

Two line items, and one of them is not obvious.

### App Platform

The service that runs the container. The smallest instance is **$5 per month**.
Bandwidth is included up to an allowance that depends on instance size, then
**$0.02 per GiB**, which is the number that makes DigitalOcean the cheaper target in
[`costs.md`](./costs.md).

### Container registry, and why the free tier probably will not do

| Plan | Storage | Cost |
|---|---|---|
| Starter | 500 MiB, one repository | Free |
| Basic | 5 GiB, five repositories | $5 per month |
| Professional | 100 GiB, unlimited repositories | $20 per month |

The current image is **660 MB uncompressed**. A registry stores compressed layers, so
the number that counts against the quota is smaller, likely somewhere around 250 to
300 MiB for this image. That has **not been measured**, because the Docker daemon
stopped responding while trying to.

Even taking the optimistic end, the free tier is a poor fit, for a reason that is
about behaviour rather than arithmetic: **rollback requires keeping previous images**.
An immutable deploy that cannot roll back is not much of an improvement over a
mutable one. One image might fit in 500 MiB; two will not.

So budget **$10 per month** to start: $5 for the app and $5 for a Basic registry.
That is still far below the point where Vercel becomes expensive, and the comparison
in [`costs.md`](./costs.md) holds.

**To verify the compressed size yourself**, once Docker is healthy:

```bash
docker save <image-tag> | gzip -1 | wc -c
```

Divide by 1048576 for MiB. If it comes in comfortably under 500 MiB and you are
willing to keep only the current image, the free tier works until the first time you
need to roll back.

### Reducing it

Two items already on the roadmap would cut this materially: serving `public/` from
Spaces and its CDN rather than the container removes 78 MB from this project's image,
and a smaller base image would remove a large part of the 332 MB that is
`node:24-slim` itself. Both are v0.4.

## 7. Before the first deploy

- Run `nextship doctor` and deal with what it reports. On this project it flags
  `@vercel/analytics`, which stops working silently off Vercel.
- Decide the region. Bangalore (`blr1`) is the closest to you and keeps latency and
  egress sensible for Indian traffic.
- Set a billing alert in the DigitalOcean control panel. nextship has no spend
  guardrails of its own, which is recorded as a gap in
  [`review.md`](./review.md) §8.3.
- Know the one behaviour that will surprise you: the ISR cache lives inside the
  container and does not survive a restart, so cached pages regenerate after every
  deploy or restart. See [`design.md`](./design.md) §12.

## Sources

- [DigitalOcean: how to create a personal access token](https://docs.digitalocean.com/reference/api/create-personal-access-token/)
- [DigitalOcean: container registry pricing](https://docs.digitalocean.com/products/container-registry/details/pricing/)
- [DigitalOcean: App Platform pricing](https://www.digitalocean.com/pricing/app-platform)
