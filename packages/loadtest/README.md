# nextship-loadtest

Find how many users at once a site holds, with one command. You give it an address; it
runs [k6](https://k6.io) for you and reports the result in one line. It works on any site,
whatever it is built with and wherever it is hosted. You do not need nextship to use it.

**Not published to npm yet.** Until it is, run it from this repository (see
[Running it from the repository](#running-it-from-the-repository)).

```
nextship-loadtest https://example.com/          # shows the plan, sends nothing
nextship-loadtest https://example.com/ --yes    # runs it
```

Only test a site you own or have permission to test. A load test is real traffic, and
against someone else's site it is an attack. That is why the command prints its plan and
sends nothing until you add `--yes`.

## Requirements

| Requirement | Why |
|---|---|
| Node.js 22 or newer | Runs the command |
| k6 on your PATH, or Docker running | k6 sends the requests and measures them. With no k6 installed, the official `grafana/k6:2.3.0` image is used |

## What it does

The test climbs in steps. With the defaults it holds 10 users at once, then 20, 30, 40 and
50, for 12 seconds each. Every user requests the address again as soon as it is answered,
so 50 users means 50 requests in flight at all times, which is far more than 50 people
browsing.

```
> Plan
  target     http://127.0.0.1:4599/
  load       5 step(s) of 4 s: 12, 24, 36, 48, 60 users at once
             each user requests the address again as soon as it is answered
  engine     k6 2.3.0, installed on this machine
  traffic    real requests to the target for 20 s
> Running, for 20 s
> Result
  users   requests/s    median   95% within   failed
     12         30.5    390 ms       418 ms     0.0%
     24         28.0    775 ms       965 ms     0.0%
     36         25.0   1155 ms      1742 ms     0.0%
     48         22.3   1533 ms      2542 ms     0.0%
     60         19.0   2284 ms      3356 ms     0.0%
v Holds 24 users at once
  With 36 users at once, 95% of requests took up to 1742 ms.
  A step is held when at most 1.0% of its requests fail and 95% finish within 1000 ms.
```

That run is real: k6 2.3.0 against a test server built to answer one request at a time.

A step is **held** when at most 1% of its requests fail and 95% of them finish within one
second. The headline is the last step held before the first one that was not. If every
step is held, it says so, and that the limit was not found: raise `--users`.

If no request succeeds at all, you get an error instead of a result, because that says
the address is wrong or the site is down, not how much load it takes.

## Options

| Option | Meaning |
|---|---|
| `--users <n>` | The most users at once, reached in up to five steps. Default 50, at most 1000 |
| `--duration <s>` | The length of the whole test in seconds. Default 60, from 10 to 600 |
| `--yes` | Send the requests. Without it, only the plan is printed |
| `-h`, `--help` | Show the usage |
| `-v`, `--version` | Show the version |

## Testing a site on your own machine

`http://localhost:3000/` works. With k6 installed, nothing special happens. With Docker,
a container cannot reach your machine's `localhost` by that name, so on Linux the
container shares the host's network, and on macOS and Windows the address is requested as
`host.docker.internal`, which the plan shows before anything runs.

## What the numbers do and do not mean

- **The test runs from your machine.** The times include your network's path to the site.
  Run it from a server near the site for figures about the site alone.
- **One address, requested with GET.** No logins, forms or user journeys. For those, write
  a k6 script; this command is for the first question, not every question.
- **One run is one sample.** Run it more than once before you rely on a number.
- **It is not a stress tool.** 1000 users at once is the ceiling, since one machine running
  k6 beside everything else cannot reliably generate more.

## What has been run

- With k6 2.3.0 on PATH, on Windows: `scripts/e2e.mjs local` passes.
- With Docker on Linux: `scripts/e2e.mjs docker` runs in this repository's CI.
- With Docker Desktop on macOS or Windows: **not run yet.** The rewrite to
  `host.docker.internal` is covered by unit tests only.

## Running it from the repository

```
pnpm install
pnpm build
node packages/loadtest/dist/index.js https://example.com/
```

## License

Apache-2.0. k6 is a separate program under its own license (AGPL-3.0), run as a separate
process and never bundled or redistributed by this package.
