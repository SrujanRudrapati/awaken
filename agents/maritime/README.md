# Maritime midnight agent (`awaken-midnight`)

Maritime hosts this agent in its own micro-VM. A **cron trigger** wakes it and delivers a prompt to `POST /chat`;
the agent calls Awaken's `POST /api/cron/daily` with `Authorization: Bearer $CRON_SECRET`, which:

1. fails yesterday's missed vows into the **Penalty Zone** (Reckoning vow, red UI, Home Base alarm), and
2. drops **today's vows** for every person (Gemini designer, template fallback).

Every run is appended to `/data/runs.jsonl` and printed to the log (`maritime logs`). Send `status` to read the last run.
New people don't wait for midnight: Awaken drops their vows the moment Calibration ends.

| Endpoint | |
|---|---|
| `GET /health` | `{ ok, agent, lastRun }` |
| `POST /chat {"message": "..."}` | runs the drop, replies with a summary within 25 s (`"status"` = last run only) |

## Deploy (run these yourself; they need your Maritime login)

```bash
npm install -g maritime-cli          # or: curl -fsSL https://maritime.sh/install.sh | sh
maritime onboard --json              # sign in, verify email

# Maritime builds a repo whose ROOT has the Dockerfile, so publish this folder as its own branch:
git subtree push --prefix agents/maritime origin maritime-agent
maritime create awaken-midnight --repo <this repo's git URL, branch maritime-agent> --json
maritime status awaken-midnight --json            # wait for "active"

maritime env set awaken-midnight AWAKEN_URL=<PUBLIC_URL> CRON_SECRET=<same as .env.local> --reload --json
maritime triggers create awaken-midnight --type cron --cron "0 7 * * *" --prompt "run the midnight drop" --json
#   0 7 * * * UTC = 00:00 MST. Check the trigger's timezone in `maritime triggers --help` / docs.

maritime chat awaken-midnight "run the midnight drop" --json   # fire once now (screenshot for Devpost)
maritime logs awaken-midnight --json                            # run log
```

`AWAKEN_URL` must reach the laptop running Awaken (quests live in that process). A cloudflared quick-tunnel URL changes
on every restart: re-run `maritime env set … AWAKEN_URL=…` after restarting the tunnel.

Local check: `PORT=8787 DATA_DIR=/tmp/m AWAKEN_URL=http://localhost:3000 CRON_SECRET=… node server.ts`.
