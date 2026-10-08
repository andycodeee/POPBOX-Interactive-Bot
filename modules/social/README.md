# X feed integration

The bot checks the configured X account every 60 seconds by default and sends new original posts to the server's configured social notification channel. Set `X_POLL_INTERVAL_SECONDS` in `.env` to change the cadence (minimum 15 seconds). Polls run sequentially, not on overlapping timers; when X returns a rate limit or request error, the bot honors its retry headers where available and backs off up to 15 minutes. `/social setup` creates the X notification role and selects a text channel named `#socials`. `/social status` shows the configured destination and whether X credentials are present without revealing credentials.

## Setup

1. Create an X developer project/app with API access to user lookup and the user timeline endpoint.
2. Add the app bearer token as `X_BEARER_TOKEN` in `.env`.
3. Set `X_FEED_URL` to the profile URL, currently `https://x.com/POPBOXLLC`, or set `X_USERNAME` to the account handle without `@`.
4. Restart the bot, then run `/social setup` in Discord.
5. Run `/social status` to check the destination and configuration. Members can opt in to role pings using `/roles`.

The adapter calls X API v2 to resolve the username and polls `/2/users/:id/tweets`, excluding replies and reposts. API access, quotas, and billing depend on the X developer project. If no X post checkpoint exists yet, the first successful poll records the latest post and intentionally does not backfill older posts. Later posts are sent oldest-first and deduplicated per server in SQLite.

New posts are sent to the text channel saved as that server's social notification destination. `/social setup` finds a channel named `socials`; if it can't find one, an existing configured destination remains selected. The bot needs permission to view that channel, send messages, and embed links. The role mention is included only if the X notification role exists and is configured.

## Environment

```env
X_FEED_URL=https://x.com/POPBOXLLC
X_BEARER_TOKEN=
X_POLL_INTERVAL_SECONDS=60
# Optional if X_FEED_URL is not a profile URL
X_USERNAME=
```

Keep developer credentials in the ignored `.env` file or a secrets manager. Do not commit API tokens.
