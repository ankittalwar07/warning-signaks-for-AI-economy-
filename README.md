# AI Demand Watch

A daily multi-agent research briefing on **warning signals that could deflate
AI demand** — more-efficient LLMs, ASIC inference chips undercutting Nvidia,
cheaper Chinese frontier models, hyperscaler capex pullback, and cutting-edge
efficiency research. Lands in your Gmail at 07:00 PT every morning.

## How it works

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

## Repo layout

```
.
├── config.yaml                  # researcher categories: name / focus / keywords
├── send_email.py                # stdlib + markdown — reads digest from stdin, sends via Gmail SMTP
├── state/seen.json              # url-hash dedup store, 30-day rolling window
├── triggers/daily-digest.md     # the prompt the scheduled trigger runs each day
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

- **Schedule:** `0 14 * * *` (UTC) — that's 07:00 PT / 10:00 ET
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

- **DST drift.** The cron is UTC. `0 14 * * *` = 07:00 PT in winter,
  06:00 PT in summer. To pin to local time year-round, change the cron
  twice a year, or extend the trigger prompt to no-op if it already
  produced a digest today.

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
