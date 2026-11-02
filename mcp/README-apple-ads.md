# apple-ads MCP server

`mcp/apple-ads.mjs` is a stdio MCP server that lets Claude read and manage your Apple Ads account straight from Apple, with no Adapty in between. Writes go through a confirmation step (see [Write tools](#write-tools)).

- Campaign Management API v5 (`api.searchads.apple.com/api/v5`) for structure and reports.
- Apple Ads Platform API v1 (`api.ads.apple.com/v1`) for change history only, because v5 has no audit endpoint. It uses the same token, and the v5 `orgId` serves as the `adAccountId`.

It needs no build step and has no dependencies beyond `dotenv` and `jsonwebtoken`, which this repo already has.

## Tools

| Tool | What it returns |
|---|---|
| `list_orgs` | Orgs this API user can reach (orgId, currency, time zone, role) |
| `list_campaigns`, `get_campaign` | Campaigns: status, serving status, budget, countries |
| `list_ad_groups`, `get_ad_group` | Ad groups: default bid, CPA goal, search match |
| `list_keywords` | Targeting keywords with bids |
| `list_negative_keywords` | Campaign-level negatives, or ad group negatives when you pass `adGroupId` |
| `list_ads` | Ads (default page or CPP creatives) of an ad group |
| `get_report` | `level`: campaigns / adgroups / keywords / searchterms / ads, with date range, `granularity`, `groupBy` (country, device, ...), and ORTZ or UTC time zone |
| `query_change_history`, `get_change_detail` | Who changed what and when, then the field-level before and after values (6-month lookback) |
| `api_get` | Any other v5 GET path, such as `/creatives` or `/apps/{adamId}/product-pages` |

If the API user can reach more than one org, every call needs `orgId` (or set `ORG_ID` in `.env`). With a single org it is picked automatically.

## Write tools

| Tool | Change |
|---|---|
| `set_campaign_status` | ENABLED / PAUSED |
| `set_campaign_daily_budget` | New daily budget |
| `set_ad_group_status` | ENABLED / PAUSED |
| `set_ad_group_default_bid` | New default max CPT |
| `set_keyword_status` | ACTIVE / PAUSED |
| `set_keyword_bid` | New max CPT |
| `add_keyword` | One keyword (EXACT or BROAD); refuses a duplicate already in the ad group |
| `add_negative_keyword` | One negative, campaign-wide or per ad group; refuses a duplicate at that level |

Writes spend real money, so every write tool changes exactly **one** item and runs in two steps:

1. **Preview.** Called without `confirmToken`, the tool only reads. It returns the target, the current value, the new value, any warnings (for example a bid or budget that more than doubles, or a BROAD negative), and a `confirmToken`.
2. **Confirm.** Claude shows you the preview and waits for your explicit yes. It then calls the tool again with the same arguments plus `confirmToken`.

The token is single-use, expires after 10 minutes, and is bound to the exact arguments and to the entity's state at preview time. If the arguments differ, or the bid, budget or status changed in the meantime, nothing is written and a fresh preview is needed. There are no batch writes.

To hide the write tools entirely, set `APPLE_ADS_READ_ONLY=1` in `.env`. The API user's role also limits what it can do: the current one is API Campaign Manager, which can write.

## Credentials

The server reads the same `.env` the dashboard uses (gitignored):

```
CLIENT_ID=SEARCHADS.xxxxxxxx-...
TEAM_ID=SEARCHADS.xxxxxxxx-...
KEY_ID=xxxxxxxx-...
PRIVATE_KEY_PATH=./keys/private-key.pem   # gitignored (keys/*.pem)
# ORG_ID=2695630                           # optional default org
```

On each call it signs an ES256 client-secret JWT with the private key, exchanges it at `appleid.apple.com` for a one-hour access token (cached), and sends `X-AP-Context: orgId=<id>` with each request.

### Creating an API user and key, if you need a new one

Never paste the private key into a chat. It only ever lives in `keys/`.

1. Generate a key pair locally:
   ```bash
   openssl ecparam -genkey -name prime256v1 -noout -out keys/private-key.pem
   openssl ec -in keys/private-key.pem -pubout -out keys/public-key.pem
   ```
2. In [Apple Ads](https://ads.apple.com) (Advanced), an account admin goes to **Account Settings → User Management → Invite Users** and gives the user an **API** role, such as API Campaign Manager or API Read Only, **in every org it should reach**. The user accepts the emailed invite.
3. Signed in as that API user, go to **Account Settings → API**, paste the contents of `keys/public-key.pem`, and click **Save**.
4. Copy the `clientId`, `teamId` and `keyId` shown above the key field into `.env`.

## Registration

The server is registered for this project in `.mcp.json` as `apple-ads`. Restart Claude Code in this folder and approve the server when prompted. To use it from any folder instead:

```bash
claude mcp add --scope user apple-ads -- node --no-warnings "/Users/tianclin/Documents/Develop/Apple Ads/mcp/apple-ads.mjs"
```

## Test by hand

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_orgs","arguments":{}}}' | node mcp/apple-ads.mjs
```
