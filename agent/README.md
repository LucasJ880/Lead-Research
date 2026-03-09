# BidToGo Local MERX Agent

Crawls MERX from your local/office machine (where MERX is accessible) and syncs results to the cloud BidToGo instance.

## Why?

MERX blocks datacenter IPs. The cloud app can't crawl MERX directly. This agent runs from a trusted local machine where MERX is normally accessible via browser.

## Setup

```bash
cd agent
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your values
```

## Configuration (.env)

| Variable | Description |
|---|---|
| `CLOUD_API_URL` | Your BidToGo instance URL (e.g. `https://bidtogo.ca`) |
| `AGENT_API_KEY` | API key for agent authentication (matches server's `AGENT_API_KEY`) |
| `MERX_EMAIL` | Your MERX account email |
| `MERX_PASSWORD` | Your MERX account password |

## Usage

```bash
# Check cloud connectivity
python merx_agent.py --status

# Full run: login → crawl → upload
python merx_agent.py

# Dry run (crawl but don't upload)
python merx_agent.py --dry-run
```

## How it works

1. Agent requests a crawl job from the cloud API
2. Cloud creates a `source_run` record with status `pending`
3. Agent logs into MERX using your credentials
4. Agent searches MERX with industry keywords and categories
5. Agent extracts listing + detail page data
6. Agent uploads normalized opportunities to the cloud
7. Cloud scores, deduplicates, and stores them
8. Agent reports final status back to cloud
9. Results appear in the BidToGo dashboard

## Scheduling

Run on a schedule using cron:

```bash
# Every 6 hours
0 */6 * * * cd /path/to/agent && python merx_agent.py >> merx_agent.log 2>&1
```
