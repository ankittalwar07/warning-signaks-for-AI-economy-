# AI Demand Watch

A daily email briefing on **warning signals that could deflate AI demand** —
news that the huge ongoing investment in AI hardware and services might be at
risk. It arrives in your Gmail at 6:00 AM Central every morning.

> **Want the reasoning behind every design choice?** See
> [`DECISIONS.md`](DECISIONS.md) — it explains, in plain language, why we
> built it this way and what alternatives we rejected.

## In plain English (for anyone)

Think of this as **a team of five research assistants who work for you
overnight, every night, for free.**

Each assistant watches one "early-warning" topic that could mean less money
flowing into AI:

| Assistant | Watches for… | Why it could hurt AI demand |
|---|---|---|
| 🛠 **Hardware** | New cheaper chips (Groq, Cerebras, Amazon, Google) | If they beat Nvidia on price, companies buy fewer Nvidia chips |
| ⚡ **Efficiency** | Smarter, leaner AI models | If AI needs fewer "tokens" to do a job, customers spend less |
| 🇨🇳 **China & open-source** | Free or cheap rival models (DeepSeek, Qwen…) | If a free model is "good enough", paid demand drops |
| 📄 **Research** | New scientific papers on cutting AI costs | A breakthrough could make today's expensive setups obsolete |
| 💰 **Industry & money** | What big tech says about AI spending | If they signal a pullback, that's a direct demand warning |

Every morning the five assistants each search the web, write up the most
important things they found in the last week, and hand their notes to an
**editor** (also automated). The editor throws out anything you've already
been told about, removes duplicates, ranks what's left by how serious and how
believable it is, and writes one tidy summary. That summary is emailed to you.

**Nothing to babysit.** It runs by itself once a day. You just read the email.

### What happens each morning (the 60-second version)

```
   6:00 AM Central
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │  A scheduled "robot session" wakes up         │
  └─────────────────────────────────────────────┘
        │
        ▼
  Sends 5 research assistants out to search the web  (all at once)
   🛠   ⚡   🇨🇳   📄   💰
        │
        ▼
  An editor combines their notes, drops anything
  you've already seen, and ranks what's important
        │
        ▼
  Writes one clean summary  →  emails it to your Gmail  📧
        │
        ▼
  Remembers what it sent (so tomorrow won't repeat it)
```

## How it works (for the technically curious)

A **Claude Code on the Web scheduled trigger** opens a fresh session on this
repo every day. The session:

1. Reads `config.yaml` (the watchlist of 5 researcher categories) and
   `state/seen.json` (URLs already covered in the last 30 days).
2. Spawns **5 specialist research subagents in parallel** — one per category
   — each using `WebSearch` to find items from the last 7 days that
   plausibly threaten AI infrastructure demand.
3. Dedupes findings against `seen.json`, merges near-duplicates across
   researchers, ranks by severity × confidence × novelty.
4. Writes a Markdown digest (executive summary + top 10 items + "watching"
   footer), pipes it into `send_email.py`, which renders to HTML and sends
   via Gmail SMTP.
5. Commits the updated `seen.json` back to the branch so tomorrow's run
   doesn't repeat anything.

Model usage runs inside the trigger session, so it draws from your Claude
subscription — no separate Anthropic API key, no GitHub Actions cron, no
extra monthly cost.

**Glossary for the email itself:**
- **Token** — the unit AI providers bill by; roughly ¾ of a word. "Fewer tokens" means lower bills.
- **Inference** — the cost of *running* a trained AI model to answer a question (as opposed to training it).
- **ASIC** — a custom chip built for one job; can be cheaper/faster than a general-purpose Nvidia GPU.
- **Capex** — capital expenditure; the billions big tech spends building AI data centers.
- **Severity / confidence** — how big the impact could be, and how sure we are the news is real.

## Repo layout

```
.
├── config.yaml                  # researcher categories: name / focus / keywords
├── send_email.py                # stdlib + markdown — reads digest from stdin, sends via Gmail SMTP
├── state/seen.json              # url-hash dedup store, 30-day rolling window
├── triggers/daily-digest.md     # the prompt the scheduled trigger runs each day
├── DECISIONS.md                 # why every design choice was made (plain language)
└── README.md
```

## One-time setup

### 1. Generate a Gmail App Password

The trigger sends mail via Gmail's SMTP server, which needs an
[App Password](https://myaccount.google.com/apppasswords) (not your regular
account password).

1. Enable 2-Step Verification on `ankittalwar@gmail.com` if it isn't already.
2. Visit https://myaccount.google.com/apppasswords
3. Generate a new App Password for "Mail". Google shows it once — copy the
   16-character string immediately.

If you use a Google Workspace account that has App Passwords disabled by
admin policy, ask your admin to allow them or use a personal Gmail instead.

### 2. Create the scheduled trigger

In Claude Code on the Web, on this repo
(`ankittalwar07/warning-signaks-for-ai-economy-`):

- **Schedule:** `0 11 * * *` (UTC) — that's 6:00 AM Central while daylight
  saving is in effect (CDT, mid-March to early November). See the DST note
  in Troubleshooting for the winter value.
- **Branch:** `claude/ai-demand-monitoring-alerts-TLBDH`
- **Prompt source:** paste the full contents of `triggers/daily-digest.md`
  (or, if the trigger UI supports it, point at the file path)
- **Session env vars:**
  - `GMAIL_ADDRESS` = `ankittalwar@gmail.com`
  - `GMAIL_APP_PASSWORD` = the 16-character string from Step 1
  - `RECIPIENT_EMAIL` = `ankittalwar@gmail.com` (or a different inbox)

### 3. First run

Click **Run now** on the trigger. The session takes 3-5 minutes (5 parallel
research agents + synthesis + send). Confirm:

- The email arrives with subject `AI Demand Watch — YYYY-MM-DD — N new signals`
- HTML formatting looks clean (links work, headings styled)
- A `chore(state): seen.json YYYY-MM-DD` commit lands on the branch

If anything is off, check the session log — the trigger prompt instructs
Claude to report errors verbosely instead of silently failing.

## Editing the watchlist

Open `config.yaml`, edit the `researchers:` list (add / remove categories,
tune keywords, change `lookback_days` or `top_n_in_digest`), commit, push.
The next day's session reads the updated config.

To trial a new category without breaking the live cron, just **Run now**
manually after pushing.

## Troubleshooting

- **No email arrived.** Open the session log. Most common: missing or wrong
  `GMAIL_APP_PASSWORD`, or the App Password is from a Workspace account that
  disallows them. `send_email.py` prints to stderr exactly which env var is
  missing.

- **Email is empty / "no new signals after dedup".** Legitimate on slow news
  days, especially right after a high-volume day. If it persists for 3+
  days, broaden `keywords` in `config.yaml` or increase `lookback_days`.

- **Subscription usage cap hit.** The session log will say so explicitly.
  Tomorrow's trigger retries automatically; no action needed unless it
  happens repeatedly, in which case lower the number of researchers or
  shorten the prompt.

- **DST drift.** The cron is set in UTC, which never shifts, but Central
  time does. Use **`0 11 * * *`** during daylight saving (CDT, ~mid-March to
  early November) and **`0 12 * * *`** during standard time (CST, winter) to
  keep delivery at 6:00 AM Central. If you don't change it in the fall, the
  email will simply arrive at 5:00 AM Central until you do.

## Manual run from this directory

If you want to test the SMTP path without going through the trigger:

```bash
export GMAIL_ADDRESS=ankittalwar@gmail.com
export GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
export RECIPIENT_EMAIL=ankittalwar@gmail.com
pip install markdown
echo '# Test\n\nHello from AI Demand Watch.' | python send_email.py --subject "AI Demand Watch — test"
```

You should receive a "Test" email in seconds. If not, the credentials or
network are at fault — sort those before debugging the research pipeline.
