<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/gowtham472/nextship/main/brand/nextship-dark.png">
    <img src="https://raw.githubusercontent.com/gowtham472/nextship/main/brand/nextship.png" alt="nextship" width="280">
  </picture>
</p>

# nextship

Deploy a Next.js app to infrastructure you own, with no Dockerfile, no `next.config` edits
and no infrastructure code. It runs on your machine or in CI, uses your own credentials,
and deploys to DigitalOcean App Platform or to any Ubuntu or Debian server you can reach
over SSH.

```bash
npm install -g nextship-cli
```

The package is `nextship-cli`; the command it installs is `nextship`. npm refuses the name
`nextship` because an unrelated package called `next-ship` exists.

## Requirements

| Requirement | Why |
|---|---|
| Node.js 22 or newer | Runs the CLI |
| Docker 23 or newer, running | Every build happens inside BuildKit, so nothing compiles on your machine |
| Next.js 16.2 or newer | The Deployment Adapter API became stable in 16.2 |
| `DIGITALOCEAN_TOKEN` | Only for the commands that touch your App Platform account |
| Or an OpenSSH client, and an Ubuntu 22.04, 24.04 or Debian 12 server | Only for the server target; you connect as root or a user with passwordless sudo |

## Quick start

```bash
cd your-nextjs-app

nextship detect          # what nextship reads from this project; builds nothing
nextship doctor          # what changes when the app leaves its current platform
nextship run             # build, package and start it locally on :3000

export DIGITALOCEAN_TOKEN=dop_v1_...
nextship deploy          # print the plan and change nothing
nextship deploy --yes    # execute it
```

Or to your own server:

```bash
nextship server add root@203.0.113.10         # the setup plan and the host key fingerprint
nextship server add root@203.0.113.10 --yes   # prepare the server and record it
nextship deploy --yes
```

## Commands

```
detect           Report what nextship reads from this project
build            Build in Docker with the adapter injected
package          Build, then produce the runtime image
run              Package, then run the image locally
doctor           Report what changes when this app leaves its current platform
deploy           Show the deployment plan; --yes to execute it
rollback         Return to a previous deployment; --yes to execute it
logs             Runtime logs for the deployed app; --follow to stream
env              List runtime variables; env push to upload, env rm to remove
domain           List domains; domain add to attach, domain rm to detach
images           List pushed images; images prune to remove old ones
destroy <name>   Destroy the app this project created
server add       Prepare a Linux server over SSH and record it as the target
server status    The server, every app on it, and what needs attention
server reboot    Reboot the server and wait for every app to come back healthy
server move      Move this project's app to another server
```

`nextship` on its own draws the wordmark in the terminal; `nextship --help` prints every
command and option.

## What it will not do

- **Change anything without a plan.** `deploy`, `rollback` and `env rm` print what they
  will do and stop until you pass `--yes`.
- **Touch an app it did not create.** Every cloud command acts only on the app recorded in
  `nextship.json`.
- **Delete a cloud resource**, except through `destroy`, which needs the app name and
  `--yes`.
- **Send your code anywhere** but your own cloud account or your own server. There is no nextship server and
  no telemetry.
- **Change the app while a deployment is still in progress.** It refuses and names the
  deployment rather than replacing it part way through.

## Compatibility

Next.js's own end-to-end suite, run in deploy mode against a real container per test
file on 16.4.0-canary.22: all 1123 suites and 3599 assertions pass, in two runs that
matched suite by suite. Nine tests that assert what Vercel's CDN or proxy does are
skipped, and the
[results](https://github.com/gowtham472/nextship#compatibility-suite-results) give the
reason for each.

## Links

- [Documentation](https://nextship.doodlebytestudio.in/docs)
- [Source](https://github.com/gowtham472/nextship)
- [Security and credential handling](https://github.com/gowtham472/nextship/blob/main/SECURITY.md)
- [Changelog](https://github.com/gowtham472/nextship/blob/main/CHANGELOG.md)

Apache-2.0. Copyright 2026 Gowtham and Ragul D.
