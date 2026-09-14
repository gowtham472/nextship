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
