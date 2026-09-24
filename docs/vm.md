# Deploying to your own server over SSH

How the VM target works, what it changes on your server, and what stays yours to run.
The design and its reasoning are in [`design.md`](./design.md) §9.3.

Author: Ragul D

---

## 1. What you need

- A server running **Ubuntu 22.04, Ubuntu 24.04 or Debian 12**, amd64 or arm64, with at
  least 1 GB of RAM and 5 GB of free disk. Any provider works: Hetzner, a Hostinger VPS, a
  DigitalOcean Droplet, EC2, Compute Engine, an Azure VM, or a machine you own.
- SSH access as **root, or as a user with passwordless sudo**, using a key. Your SSH agent,
  `~/.ssh/config` and hardware keys work as they do for `ssh` itself, because nextship runs
  your `ssh`.
- Nothing listening on ports 80 or 443. Caddy takes both.
- An OpenSSH client on the machine you run nextship from. macOS, Linux and Windows 10 and
  later include one.

## 2. Setting a server up

```bash
nextship server add root@203.0.113.10
```

This prints a plan and changes nothing. Read the host key fingerprint in it and compare it
with the one your provider shows for the server (most show it in the console or in the
server's first boot log). Then run the same command with `--yes`.

A non-standard SSH port goes after the host, and an IPv6 address takes brackets:
`nextship server add ubuntu@vps.example.com:2222`, `nextship server add root@[2001:db8::1]`.

## 3. What `server add` changes, step by step

Setup runs `runtime/vm/setup.sh` as root, sent over SSH. Each step checks first and changes
only what is not already done, which is why a second run changes nothing.

| Step | What it does | Opt out |
|---|---|---|
| `os` | Refuses anything but Ubuntu 22.04, Ubuntu 24.04 and Debian 12 | |
| `arch` | Records amd64 or arm64, so images are built for the server | |
| `resources` | Reports RAM, swap and disk; refuses under about 1 GB of RAM (900 MiB, since a 1 GB plan reports less) or 5 GB free | |
| `ports` | Refuses if a process other than Docker holds port 80 or 443, naming it | |
| `docker` | Installs Docker CE from Docker's own apt repository if the server has none; refuses a Docker older than 23 rather than replacing it | |
| `user` | Creates `nextship` in the `docker` and `systemd-journal` groups and copies the connecting user's `authorized_keys` to it. A login as `nextship` is then proven from your machine before setup continues | |
| `dirs` | Creates `/etc/nextship`, owned by `nextship`, mode 0700 | |
| `network` | Creates the Docker network `nextship` | |
| `caddy` | Runs `caddy:2.10` as `nextship-caddy` on ports 80 and 443 (and 443/udp for HTTP/3), restarting unless stopped, with certificates in named volumes so they survive the container being replaced | |
| `journald` | Limits the journal to 500M, only when no limit is set already | |
| `swap` | Adds a 2 GB swap file when the server has under 4 GB of RAM and no swap | `--no-swap` |
| `updates` | Installs security updates automatically with unattended-upgrades, using the distribution's default security origins | `--no-auto-updates` |
| `firewall` | If ufw is installed, allows the SSH port, 80 and 443, then enables it. SSH is allowed before anything is enabled | `--no-firewall` |
| `watchdog` | A systemd timer that restarts a nextship container unhealthy for three checks in a row, logging why to the journal under `nextship-watchdog` | |
| `ssh-hardening` | Turns off password and keyboard-interactive logins and allows root by key only, in `/etc/ssh/sshd_config.d/10-nextship.conf`. Runs last, only after the `nextship` login worked, and removes its file again if `sshd -t` rejects it | `--no-ssh-hardening` |

Docker publishes Caddy's ports itself, which bypasses ufw for those two ports. That is
intended here, since they are exactly the ports that must be open, but it also means ufw
does not protect any port you publish from another container yourself.

## 4. The security model

- **The host key is pinned.** `nextship.json` holds the full key line. Every connection
  writes it to a private known_hosts file and connects with `StrictHostKeyChecking=yes`, so
  a server presenting another key is refused. If you rebuild the server, confirm its new
  fingerprint through your provider, remove `server` from `nextship.json`, and run
  `server add` again.
- **Connections never prompt.** Batch mode and no password authentication mean a missing
  key fails immediately rather than waiting for input on a CI runner.
- **Nothing is interpreted by a shell on your machine.** `ssh` is started with an argument
  list. On the server, every value placed in a command is validated against a strict
  pattern or single-quoted.
- **`nextship` is root-equivalent.** Membership of the `docker` group lets a user start a
  privileged container, so anyone who can log in as `nextship` controls the server. Treat
  its keys as root's. It is a separate user so nextship's files and containers have one
  owner, not to limit what that owner can do.
- **What is never touched:** containers without nextship's labels, the Docker daemon's
  configuration, and DNS.

## 5. Deploying and running an app

`nextship deploy` builds on the server by default, through an SSH forward of its Docker
socket, and switches Caddy to the new container only once it is healthy. If the build's
connection to the server's Docker drops mid-build, which has happened right after
`server add` on a fresh server, `deploy` says so and builds once more; a build that fails
for any other reason is not retried. See the README for the plan and the flags. What it
keeps on the server:

| Where | What |
|---|---|
| `/etc/nextship/apps/<name>/app.json` | The app's id and its domains. The id is what `nextship.json` records; a directory with another id is refused |
| `/etc/nextship/apps/<name>/deployments.json` | The deployment history rollback chooses from |
| `/etc/nextship/apps/<name>/env` | Runtime variables, mode 0600, in Docker's env file format |
| `/etc/nextship/apps/<name>/secrets` | The Server Actions key, mode 0600 |
| `/etc/nextship/caddy/sites/<name>.caddy` | The app's Caddy site, regenerated on every change |
| `/etc/nextship/default-app` | The app that answers `http://<server>` |
| Containers `<name>-r<time>-<random>` | One per deployment. The live one runs; the previous one is kept stopped |
| Volumes `nextship-<name>-build-<image>`, `nextship-<name>-cache` | Regenerated ISR pages per image, optimized images and the fetch cache per app |

`nextship server status` shows the server and every app on it, and says what needs
attention.

**Memory.** Each container is limited to an even share of 80% of the server's RAM across
the apps on it at the time it starts, at least 256 MiB. `--memory` overrides it. Adding an
app does not shrink the limits of containers already running until they are deployed
again.

**Recovering.** A container that exits is restarted by Docker. A container that stays up
but stops answering its health check is restarted by the watchdog after three failed
minutes, and the journal says so under `nextship-watchdog`. A lock left by a deployment
that was killed is reported with its owner after 30 minutes and never removed
automatically: confirm nothing is running, then remove
`/etc/nextship/apps/<name>/lock` as the `nextship` user.

**Reboots.** Every app container runs with `--restart unless-stopped`, Docker is enabled at
boot, Caddy restarts unless stopped, and the watchdog timer starts two minutes after boot,
so a reboot brings every app back without nextship. `nextship server reboot --yes` proves it
on demand: it reboots the server, waits for SSH, and waits until every container that was
running reports healthy again, for up to 10 minutes. The `nextship` user may run
`systemctl reboot` through sudo and nothing else, which setup version 2 adds.

## 6. Deploying from GitHub Actions

The server holds everything a deployment needs that is not in your repository: the
runtime env file and the Server Actions key. The committed `nextship.json` holds the server
and its pinned host key, so a runner never trusts a key on first use. What a runner needs
is an SSH key authorised for the `nextship` user.

1. Create a key for CI only, and authorise it on the server. The `nextship` user is
   root-equivalent, so this key is a root key for the server: keep it in one repository
   secret and nowhere else.

   ```bash
   ssh-keygen -t ed25519 -N '' -C nextship-ci -f nextship-ci
   ssh nextship@203.0.113.10 'cat >> ~/.ssh/authorized_keys' < nextship-ci.pub
   ```

2. Save the private key, `nextship-ci`, as the repository secret `NEXTSHIP_SSH_KEY`, then
   delete both files from your machine.

3. Add the workflow:

   ```yaml
   name: deploy
   on:
     push:
       branches: [main]
   concurrency: deploy
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: '22'
         - run: npm ci
         - name: Load the deploy key
           run: |
             eval "$(ssh-agent -s)"
             echo "SSH_AUTH_SOCK=$SSH_AUTH_SOCK" >> "$GITHUB_ENV"
             echo "SSH_AGENT_PID=$SSH_AGENT_PID" >> "$GITHUB_ENV"
             ssh-add - <<< "${{ secrets.NEXTSHIP_SSH_KEY }}"
         - run: npx --yes nextship-cli deploy --yes --build local
   ```

`--build local` builds on the runner and streams the image to the server, so the build
never competes with the running apps for the server's memory. The runner is amd64, so this
suits an amd64 server directly. For an arm64 server, either add
`docker/setup-qemu-action` before the deploy step so the runner can build arm64 images
under emulation, which is slow, or deploy with `--build remote` when the server has enough
memory to build, which is native and uses the server's build cache.

`concurrency: deploy` keeps two pushes from deploying at once. The server's app lock would
refuse the second anyway, but the refusal would fail that workflow run.

Not yet run in GitHub Actions: this workflow is written from what nextship does locally,
and running it is on the v1.1 checklist.

## 7. Backups and recovery

A server is one machine. Know what is on it that exists nowhere else:

| What | Where | Back it up? |
|---|---|---|
| Runtime variables | `/etc/nextship/apps/<name>/env` | **Yes.** They exist only on the server, unless you keep your own copy |
| The Server Actions key | `/etc/nextship/apps/<name>/secrets` | **Yes.** A new key breaks Server Actions for every open page |
| Which server, and its host key | `nextship.json` | Already in your repository |
| Images | Docker on the server | No. Rebuilt from your repository by `deploy` |
| Regenerated pages, optimized images | The cache volumes | No. Regenerated on demand |
| Deployment history | `/etc/nextship/apps/<name>/deployments.json` | Optional. Losing it loses rollback targets, not the app |

Copy the two files somewhere safe, for example a password manager, over SSH:

```bash
ssh nextship@203.0.113.10 cat /etc/nextship/apps/acme-web/env
ssh nextship@203.0.113.10 cat /etc/nextship/apps/acme-web/secrets
```

**Moving while the old server still answers:** `nextship server move user@newhost --yes`
copies the app record, domains, env file and key over SSH in memory, streams the live
image from the old server, deploys it on the new one and records the new server only once
the app is healthy there. The old server is only read. Then change the DNS records it
prints, and destroy the app on the old server from a copy of the previous `nextship.json`.

**Recovering when the old server is gone:** remove `server` and `appId` from
`nextship.json`, run `nextship server add` for the new server, put the saved key into
`.nextship/secrets.local.json` as `{"serverActionsEncryptionKey": "..."}`, and run
`nextship deploy --yes`, which uploads that key rather than generating a new one. Restore
the variables with `nextship env push --yes` from an env file holding the saved values, then
attach the domains again and change their DNS records.

## 8. Putting a proxy such as Cloudflare in front

Caddy obtains certificates itself, over port 80, once a domain's record points at the
server. A proxy in front changes what the domain resolves to, so `domain add` warns that it
does not point at the server; that is expected with a proxy.

What to keep in mind, none of it verified with a proxy in front yet:

- Use the proxy's end to end encrypted mode with certificate verification (Cloudflare calls
  it "Full (strict)"), since the server presents a real certificate.
- A proxy that caches HTML brings back the limitation App Platform has (`design.md` §12):
  a page Next.js marks cacheable is kept at the edge, so `revalidatePath` updates the server
  while visitors keep the old page. Give pages you revalidate on demand an
  `export const revalidate`, or do not cache HTML at the edge.
