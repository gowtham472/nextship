# Cost model: nextship versus Vercel

Answers one question with real numbers: how much money does self-hosting actually
save, and at what traffic does it start to matter?

All rates are list prices as published in September 2026, using the cheapest US
region in every case. That is the most favourable assumption for Vercel, so the
savings shown here are a floor, not a best case.

Author: Gowtham
Date: 2026-09-06

---

## 1. The rate cards

### Vercel Pro (iad1, Washington DC)

| Item | Rate |
|---|---|
| Seat | $20 per developer per month, one paid seat included |
| Usage credit | $20 per month, offsets usage charges |
| Fast Data Transfer | First 1 TB included, then $0.15 to $0.35 per GB |
| Edge Requests | First 10,000,000 included, then $2.00 to $3.20 per million |
| Active CPU | $0.128 per hour (billed only while code runs, not during I/O) |
| Provisioned Memory | $0.0106 per GB-hour (billed for instance lifetime, including I/O waits) |
| Invocations | $0.60 per million |
| ISR reads / writes | $0.40 / $4.00 per million |
| Fast Origin Transfer | $0.06 to $0.43 per GB |
| Image transformations | $0.05 per 1,000 |

The included 1 TB and 10M requests do not consume the $20 credit. Everything else
draws the credit first, then bills on demand.

### AWS (us-east-1)

| Item | Rate |
|---|---|
| App Runner (**closed to new customers**) | $0.064 per vCPU-hour active, $0.007 per GB-hour always (memory bills when idle) |
| ECS Fargate | $0.04048 per vCPU-hour, $0.004445 per GB-hour. Graviton is about 20 percent less |
| Application Load Balancer | About $16.43 per month base, plus LCUs |
| CloudFront | First 1 TB per month and first 10M requests free, then $0.085 per GB and $0.010 per 10,000 HTTPS requests |

### DigitalOcean App Platform

| Item | Rate |
|---|---|
| Container | From $5 per month (512 MB, shared CPU); about $50 at 2 vCPU / 4 GiB |
| Bandwidth | An allowance per container instance (for example 100 GiB on a 1 vCPU / 0.5 GiB instance), pooled across the team, then **$0.02 per GiB** |
| Inbound transfer | Free |

## 2. Three traffic tiers

Assumptions held constant across all three: one production app, a mixed SSR and ISR
workload, about half of requests reaching compute, roughly 50 ms of active CPU per
invocation. Seats are counted separately in §4.

### Tier 1: small (100k requests, 20 GB egress per month)

| | Vercel Pro | AWS (App Runner, closed) | AWS (Fargate + ALB) | DO App Platform |
|---|---|---|---|---|
| Compute | ~$0.20 | ~$7 | ~$18 | $5 to $12 |
| Load balancer | included | included | ~$16 | included |
| CDN and egress | included | $0 (free tier) | $0 (free tier) | included |
| Platform fee | $20 | 0 | 0 | 0 |
| **Total** | **~$20** | **~$8** | **~$35** | **~$5 to $12** |

At this size the difference is single-digit dollars. **Nobody should switch platforms
to save $12 a month.** Note also that Fargate plus ALB is *more expensive* than
Vercel here, because the load balancer alone has a $16 floor.

**The App Runner column no longer applies to anyone new.** AWS has closed App Runner to
new customers. There are two realistic replacements and they are not close:

| AWS option | Compute | Load balancer | Total |
|---|---|---|---|
| **Lightsail container service** | $7 nano, $10 micro | built in, not billed separately | **$7 to $10** |
| ECS Express Mode | ~$18 | ~$16 to $18 | ~$35 |

Lightsail's price includes a load balanced TLS endpoint, custom domains with a free
certificate, and 500 GB of transfer per service, verified against the Lightsail container
services FAQ. It is billed hourly and prorated. That is why `01-roadmap.md` makes it the
v0.5 default and puts ECS behind `--compute ecs`: the load balancer is only unavoidable
on the ECS path.

The Fargate + ALB column below is therefore the **upper** bound for AWS, not the only
number. Read it as what AWS costs when someone needs a VPC or real autoscaling.

### Tier 2: medium (5M requests, 500 GB egress per month)

That is roughly 2 requests per second.

| | Vercel Pro | AWS (App Runner, closed) | AWS (Fargate + ALB) | DO App Platform |
|---|---|---|---|---|
| Invocations | $1.50 | | | |
| Active CPU | $4.44 | | | |
| Provisioned memory | $7.74 | | | |
| ISR reads and writes | $0.80 | | | |
| Fast Origin Transfer | ~$6 | | | |
| Image optimization | ~$3.70 | | | |
| Compute | | ~$12 | ~$18 | ~$12 |
| Load balancer | | included | ~$21 | included |
| CDN and egress | included (under 1 TB) | $0 (under free tier) | $0 | ~$8 overage |
| Credit applied | -$20 | | | |
| Platform fee | $20 | 0 | 0 | 0 |
| **Total** | **~$24** | **~$14** | **~$40** | **~$20** |

Still nearly a wash. Vercel's included 1 TB of transfer and 10M requests cover this
entire tier, so almost nothing is billed beyond the seat.

**This is the finding that matters most: below roughly 1 TB of egress, Vercel Pro is
genuinely competitive, and a self-hosted setup can easily cost more.**

### What closing App Runner does to the case for AWS

Read down the Fargate + ALB column and the conclusion is uncomfortable but clear: for a
small or medium app, **AWS is the most expensive of the three**, and DigitalOcean is the
cheapest at every tier measured here. AWS only wins against Vercel once egress is large,
and even then DigitalOcean wins outright on egress price.

That does not mean the AWS target is pointless. It means the reason to build it is not
cost. It is that people are already on AWS, with their database, their VPC and their
compliance boundary there, and moving the web tier out is not an option. That is a real
reason, and it should be the stated one rather than a saving that does not exist.

### Tier 3: large (50M requests, 5 TB egress per month)

| Line item | Vercel Pro | AWS (Fargate + ALB) | DO App Platform |
|---|---|---|---|
| Egress | 4 TB over included: **$614** | 4 TB over free tier at $0.085: **$348** | 4 TB over allowance at $0.02: **$82** |
| Requests | 40M over included: **$80** | 40M HTTPS: **$40** | included |
| Compute | CPU $44, memory $31, invocations $15 | 3 tasks, 1 vCPU / 2 GB: ~$108 (~$87 Graviton) | 3 containers: ~$75 |
| Load balancer | included | ~$46 | included |
| ISR and origin transfer | ~$69 | included in compute | included |
| Image optimization | ~$37 | self-hosted, in compute | in compute |
| Storage, registry, logs | included | ~$20 | ~$5 |
| Credit | -$20 | | |
| Platform fee | $20 | 0 | 0 |
| **Total** | **~$890** | **~$540** | **~$175** |

Savings against Vercel: **about 40 percent on AWS, about 80 percent on DigitalOcean.**

## 3. Where the money actually is

Look at what dominates the Vercel bill at Tier 3: $614 of egress plus $80 of edge
requests is 78 percent of the total. Compute is under 11 percent.

**Bandwidth is the entire story.** Per GB of egress:

| | Price per GB |
|---|---|
| Vercel, beyond 1 TB | $0.15 to $0.35 |
| CloudFront, beyond free tier | $0.085 |
| DigitalOcean, beyond allowance | **$0.02** |

DigitalOcean egress is roughly **seven to seventeen times cheaper** than Vercel's.
That single number, not compute efficiency or architecture, is what makes
self-hosting worth money. It also means a bandwidth-heavy app (images, media,
large payloads) crosses the threshold far earlier than a request-heavy API.

### Regional pricing raises the Vercel figure

Every number above uses Vercel's cheapest US rates. Vercel prices regionally, and
the published ranges go up to $0.35 per GB for transfer and $3.20 per million edge
requests. An app serving mostly Indian or South American traffic pays materially
more than this model shows, which moves the crossover point earlier.

## 4. The cost everyone forgets: seats

Vercel charges **$20 per developer per month**. Self-hosting charges nothing per seat.

| Team size | Vercel seats per year | Self-hosted |
|---|---|---|
| 3 developers | $720 | $0 |
| 10 developers | $2,400 | $0 |
| 25 developers | $6,000 | $0 |

For a small team on modest traffic, seats are a **larger** line item than
infrastructure. A 10-person team on Tier 2 traffic pays about $200 a month in seats
and about $4 in usage. That is the real switching motive at small scale, and it has
nothing to do with compute.

## 5. The cost that argues against us

Self-hosting is not free; the price is paid in attention rather than invoices. If
running it consumes four engineer-hours a month at a loaded rate of $75 per hour,
that is $300 a month of hidden cost. That single figure:

- **erases the entire saving at Tier 1 and Tier 2**, and
- **consumes most of the AWS saving even at Tier 3** ($350 saved against $300 spent).

This cuts both ways, and it is the honest case for and against the product at once:

- **For:** a tool that genuinely reduces those four hours to near zero converts the
  full infrastructure saving into real money. That is the value nextship sells.
- **Against:** if the tool is merely adequate, it adds nothing, because the ops time
  it fails to remove is worth more than the infrastructure it saves.

## 6. Conclusions

1. **Below about 1 TB of monthly egress, Vercel Pro at $20 is hard to beat on
   infrastructure alone.** A self-hosted setup can cost more, especially any design
   that requires a load balancer. Advising a user at this scale to migrate would be
   advising them badly.
2. **Above roughly 1 TB of egress the economics invert sharply**, and the lever is
   bandwidth pricing, not compute. AWS saves around 40 percent, DigitalOcean around
   80 percent.
3. **Seats change the picture at any scale.** For teams of five or more on modest
   traffic, per-seat pricing, not usage, is the reason to leave.
4. **Ops time is the deciding variable.** The infrastructure saving is real but is
   comparable in size to the human cost of self-hosting. The product only creates
   value if it removes that cost almost entirely.
5. **DigitalOcean is the stronger economic story than AWS**, by a wide margin, purely
   because of $0.02 per GiB egress. That is worth reflecting in which target is
   treated as the flagship.

### Consequence for the product

The traffic level at which self-hosting saves meaningful money (above roughly 1 TB
egress, tens of millions of requests) is also the traffic level at which a single
container stops being enough. Those users run multiple instances, and multiple
instances is exactly where Next.js correctness breaks down
([`02-competitive-validation.md`](./02-competitive-validation.md) §4).

The users for whom the economics work are the users who need the correctness layer.
Below that line, the honest advice is to stay on Vercel.
