# Design Decisions

This document records **every significant choice** made while building AI
Demand Watch, and **why** — including the alternatives we considered and
rejected. It's written so a non-technical reader can follow the reasoning.

Each entry follows the same shape: the decision, the options we weighed, why
we picked what we picked, and what we gave up.

---

## 1. Where the system runs: Claude Code scheduled trigger (not a server or API script)

**Decision:** Run the whole thing as a daily *Claude Code on the Web scheduled
trigger* — a "robot session" that wakes up once a day, does the work, and
shuts down.

**Options we considered:**

| Option | What it means | Monthly cost |
|---|---|---|
| **A. Standalone program calling the Anthropic API** | We write a full program that calls AI as a paid service, hosted on an automation runner (GitHub Actions) | ~$10/month on top of your subscription |
| **B. Claude Code scheduled trigger** ✅ | The work happens inside your existing Claude subscription's sessions | $0 extra |
| **C. Always-on server** | Rent a computer that runs 24/7 | Server rental + complexity |

**Why we chose B:** You specifically wanted this to fit inside your existing
**$20/month Claude subscription** with no extra bills. Option B does exactly
that — the AI "thinking" is bundled into sessions you already pay for. It also
means **less code to maintain** and **no API keys to manage**.

**What we gave up:** A subscription has fair-use limits. On an unusually busy
news day the session could occasionally hit a cap and skip that day (it
automatically retries the next morning). With Option A you'd pay per use and
never hit a cap — but that wasn't the priority you set.

---

## 2. How research gets done: 5 assistants working in parallel (not one big search)

**Decision:** Split the work across **five specialist research agents**, each
focused on one topic, all running at the same time. Then a sixth "editor" step
combines their findings.

**Options we considered:**
- **One general search** — ask the AI to "find AI demand warnings" in a single
  pass. Simpler, but shallow: it spreads attention thin and misses niche
  signals (e.g., an obscure but important research paper).
- **Five focused specialists** ✅ — each agent has a narrow beat, specific
  keywords, and dedicated web searches. Deeper coverage per topic.
- **A back-and-forth "conversation" between agents** — agents that ask each
  other questions. More sophisticated, but slower, costlier, and harder to
  debug for what is really a once-a-day news scan.

**Why we chose five specialists:** Your examples (efficient LLMs, cheaper
ASICs, Chinese models) are genuinely *different beats* with different sources.
A specialist per beat finds things a generalist would skip. Running them in
parallel keeps the whole job to a few minutes.

**What we gave up:** Slightly more moving parts than a single search, and the
agents don't talk to each other. For daily news monitoring that coordination
isn't needed — the editor step handles combining their work.

**The five beats** (defined in `config.yaml`, easy to edit): Hardware &
Silicon, Model Efficiency, Open-Source & China LLMs, Academic Research,
Industry & Financial Signals.

---

## 3. How the email is sent: Gmail App Password (not a paid email service or manual drafts)

**Decision:** Send through Gmail's own mail server using a **Google "App
Password"** — a special 16-character password you generate once.

**Options we considered:**

| Option | Pros | Cons |
|---|---|---|
| **Gmail App Password** ✅ | Free, no new accounts, ~15 lines of code | You generate one password once; needs 2-factor enabled |
| **Resend / SendGrid** (email services) | Very reliable delivery | A new signup, another login to manage, overkill for one daily email to yourself |
| **Save as a Gmail draft, you click Send** | Safest (you review first) | Defeats the point — you wanted *automatic* daily alerts |

**Why we chose the App Password:** It's the simplest path that still **sends
automatically** with **zero extra services or cost**. Since the email goes to
you, fancy deliverability tooling is unnecessary.

**What we gave up:** A tiny one-time setup (turn on 2-factor, generate the
password). Also, if your Gmail is a *Workspace* (company) account, an admin
might have disabled App Passwords — in which case a personal Gmail is the
fallback.

---

## 4. Avoiding repeats: a memory file checked into the project (not a database)

**Decision:** Keep a simple memory file, `state/seen.json`, listing what's
already been emailed in the last 30 days. Each morning the system skips
anything already in that list.

**Options we considered:**
- **A real database** — robust but heavy; overkill for a personal tool.
- **A temporary cache** — can get wiped, which would cause repeated alerts.
- **A plain file saved back into the project** ✅ — simple, survives between
  runs, and gives a dated history of what was sent (you can literally scroll
  back and see each day's update).

**Why we chose the file:** It's the least complicated thing that reliably
prevents "you already told me this yesterday" repeats, and it doubles as an
audit trail.

**What we gave up:** The system saves a small update to the project once a day
(a minor bit of housekeeping noise). Easily changed later if it ever bothers
you.

**How "same story" is detected:** Each news item has a web link. We standardize
the link (lowercase, strip tracking junk) and store a fingerprint of it. If
tomorrow's search turns up the same link, it's recognized and skipped.

---

## 5. Timing: once a day at 6:00 AM Central

**Decision:** Deliver one digest each morning at 6:00 AM Central (you chose
this slot).

**Options we considered:** morning vs. evening; once vs. twice daily. Twice
daily doubles the work for marginal benefit on a slow-moving trend like this.

**Why once, in the morning:** Warning signals about AI demand are a
slow-burn trend, not minute-by-minute trading news. A single, well-curated
morning read is more useful than constant pings.

**What we gave up:** Breaking news mid-day waits until the next morning. If
that ever matters, adding a second daily run is a one-line change.

**Note on time zones:** The schedule is set in universal time (UTC), which
never shifts — but Central time does (daylight saving). To stay at 6:00 AM
Central, use `0 11 * * *` in summer (CDT) and `0 12 * * *` in winter (CST).
Forgetting to switch in the fall just means the email arrives an hour early
(5:00 AM) until you update it — harmless.

---

## 6. Budget: kept comfortably inside the $20/month subscription

**Decision:** Use the standard models inside your subscription and cap each
assistant's web searches, so the whole thing stays inside the $20/month plan
with no separate bills.

**Why:** This was your explicit requirement. Because the work runs inside the
subscription (Decision #1), there are no per-use AI charges and no web-search
fees to track.

**What we gave up:** During very heavy usage you might occasionally bump into
the subscription's fair-use limit (see Decision #1). The trade was deliberate:
predictable $0 extra cost over guaranteed unlimited throughput.

---

## 7. Email format: clean, readable HTML

**Decision:** The AI writes the summary in a simple text format (Markdown),
which we convert to a clean, mobile-friendly HTML email.

**Why:** Markdown is what the AI produces naturally and is easy to read even
in plain text; converting it to HTML makes the inbox version look polished
(headings, clickable source links, severity labels). We also include a
plain-text version so it's readable in any email app.

**What we gave up:** Nothing meaningful — this is a standard, lightweight
approach.

---

## 8. Configuration lives in one simple file you can edit

**Decision:** All the tunable settings — which topics to watch, the keywords,
how many items to include, how far back to look — live in `config.yaml`, a
plain settings file.

**Why:** You (or anyone) can adjust the watchlist without touching any code.
Add a topic, change keywords, widen the time window — edit the file, save,
done. The next morning's run uses the new settings.

**What we gave up:** Nothing — this is purely a convenience.

---

## Summary table

| Decision | We chose | Main reason | Main trade-off |
|---|---|---|---|
| Where it runs | Claude subscription session | $0 extra cost | Rare daily skip on fair-use cap |
| Research approach | 5 parallel specialists | Deeper coverage per topic | A few more moving parts |
| Email delivery | Gmail App Password | Free, automatic, no new service | One-time password setup |
| Avoiding repeats | Simple memory file | Reliable + audit trail | One small daily save |
| Timing | Once, 6 AM Central | Matches a slow-moving trend | Mid-day news waits |
| Budget | Inside $20/month plan | Your requirement | Possible fair-use cap |
| Email format | Markdown → clean HTML | Readable everywhere | None |
| Settings | One editable file | Easy to change topics | None |

---

*If any of these trade-offs stops being acceptable, each one is reversible —
none of the choices lock you in.*
