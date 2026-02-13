#!/usr/bin/env python3
"""
MoltLaunch Registry Builder
Scrapes the Colosseum Agent Hackathon leaderboard and builds registry.json
"""

import requests
import time
import json
import os
import re
from datetime import datetime, timezone
from collections import Counter

API_BASE = "https://agents.colosseum.com/api"
API_KEY = os.environ.get("COLOSSEUM_API_KEY", "")
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

RATE_LIMIT = 0.5
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "registry.json")

# Category classification keywords
CATEGORY_RULES = {
    "DeFi": ["defi", "swap", "lending", "borrow", "yield", "liquidity", "amm", "dex", "vault", "staking",
             "collateral", "margin", "perpetual", "perp", "interest", "loan", "finance", "treasury"],
    "Trading": ["trading", "trade", "arbitrage", "sniper", "mev", "order", "market-making", "market maker",
                "scalp", "alpha", "signal", "bot trading", "copy-trad"],
    "Infrastructure": ["infrastructure", "infra", "oracle", "bridge", "rpc", "validator", "node",
                        "indexer", "sdk", "framework", "protocol", "middleware", "api", "gateway",
                        "trust", "verification", "verify", "attestation"],
    "AI/ML": ["ai", "machine learning", "ml", "llm", "gpt", "neural", "model", "inference",
              "natural language", "chatbot", "assistant", "autonomous", "reasoning", "rag"],
    "Analytics": ["analytics", "dashboard", "monitor", "track", "data", "insight", "metric",
                  "chart", "visualiz", "report", "intelligence", "sentiment"],
    "Identity": ["identity", "did", "kyc", "reputation", "credential", "proof", "soulbound",
                 "verification", "authenticate", "sybil"],
    "Gaming": ["game", "gaming", "play", "nft", "metaverse", "virtual world", "rpg", "pvp",
               "casino", "bet", "gambl", "prediction market"],
    "Social": ["social", "community", "dao", "governance", "chat", "messaging", "forum",
               "content", "creator", "influencer", "feed", "follow"],
    "Tooling": ["tool", "utility", "wallet", "explorer", "debugger", "testing", "deploy",
                "cli", "template", "boilerplate", "starter", "scaffold"],
}


def categorize_project(name, description, tags):
    """Categorize a project based on tags, name, and description keywords."""
    text = f"{name} {description} {' '.join(tags)}".lower()

    scores = {}
    for category, keywords in CATEGORY_RULES.items():
        score = sum(1 for kw in keywords if kw in text)
        if score > 0:
            scores[category] = score

    if scores:
        return max(scores, key=scores.get)
    return "Other"


def safe_get(obj, *keys, default=None):
    """Safely navigate nested dicts."""
    current = obj
    for key in keys:
        if isinstance(current, dict):
            current = current.get(key)
        else:
            return default
        if current is None:
            return default
    return current


def fetch_leaderboard():
    """Fetch all projects from the hackathon leaderboard."""
    projects = []
    offset = 0
    limit = 50

    while True:
        print(f"📥 Fetching leaderboard offset={offset}...")
        try:
            resp = requests.get(
                f"{API_BASE}/hackathons/1/leaderboard",
                params={"limit": limit, "offset": offset},
                headers=HEADERS,
                timeout=30
            )
        except requests.exceptions.RequestException as e:
            print(f"  ❌ Request failed: {e}")
            break

        time.sleep(RATE_LIMIT)

        if resp.status_code != 200:
            print(f"  ❌ HTTP {resp.status_code}: {resp.text[:200]}")
            break

        try:
            data = resp.json()
        except json.JSONDecodeError:
            print(f"  ❌ Invalid JSON response")
            break

        # The response is a dict with "entries" array, each has {rank, project: {...}}
        if isinstance(data, list):
            batch = data
        elif isinstance(data, dict):
            batch = data.get("entries", data.get("projects", data.get("leaderboard", data.get("data", []))))
            if isinstance(batch, dict):
                batch = [batch]
        else:
            batch = []

        if not batch:
            print(f"  ℹ️  No more results at offset={offset}")
            break

        projects.extend(batch)
        print(f"  ✅ Got {len(batch)} projects (total: {len(projects)})")

        if len(batch) < limit:
            break

        offset += limit

        # Safety limit
        if offset > 2000:
            print("  ⚠️  Safety limit reached at offset 2000")
            break

    return projects


def extract_live_app_from_description(description):
    """Try to extract a live app URL from the description text."""
    if not description:
        return None
    # Look for common patterns like "Live: https://...", "App: https://...", or standalone URLs
    patterns = [
        r'(?:live|app|demo|try|website|site|platform|frontend|ui)[\s:]+(?:at\s+)?(https?://[^\s,)\"]+)',
        r'(https?://(?:(?!github\.com|x\.com|twitter\.com|discord\.gg|t\.me|youtube\.com|youtu\.be|docs\.)[^\s,)\"]+))',
    ]
    for pattern in patterns:
        match = re.search(pattern, description, re.IGNORECASE)
        if match:
            url = match.group(1).rstrip('.')
            # Skip common non-app URLs
            skip = ['github.com', 'npmjs.com', 'discord', 'twitter', 'x.com', 'youtube', 'docs.']
            if not any(s in url.lower() for s in skip):
                return url
    return None


def process_project(entry, fallback_rank):
    """Extract and normalize a single project entry."""
    # Entry has {rank, project: {...}} from leaderboard API
    proj = entry.get("project", entry) if isinstance(entry, dict) else entry
    api_rank = safe_get(entry, "rank", default=None)
    rank = api_rank if api_rank is not None else fallback_rank

    name = safe_get(proj, "name", default="Unknown")
    slug = safe_get(proj, "slug", default="")
    raw_description = safe_get(proj, "description", default="")

    repo = safe_get(proj, "repoLink", default=None)
    live_app = safe_get(proj, "liveAppLink", default=None)
    presentation = safe_get(proj, "presentationLink", default=None)

    # Try to extract live app from description if not provided
    if not live_app and raw_description:
        live_app = extract_live_app_from_description(raw_description)

    # Truncate description after extracting URLs
    description = raw_description
    if description and len(description) > 200:
        description = description[:197] + "..."

    human_votes = safe_get(proj, "humanUpvotes", default=0) or 0
    agent_votes = safe_get(proj, "agentUpvotes", default=0) or 0
    total_votes = human_votes + agent_votes

    agent_name = safe_get(proj, "ownerAgentName", default=None)

    # Twitter info from ownerAgentClaim
    claim = safe_get(proj, "ownerAgentClaim", default={}) or {}
    twitter = safe_get(claim, "xUsername", default=None)
    twitter_pic = safe_get(claim, "xProfileImageUrl", default=None)

    # Tags: API doesn't provide them, so generate from category keywords found
    tags = []
    text_lower = f"{name} {raw_description}".lower()
    tag_keywords = ["defi", "trading", "ai", "solana", "nft", "dao", "wallet", "oracle",
                    "bridge", "swap", "lending", "analytics", "social", "gaming", "identity",
                    "risk", "monitor", "autonomous", "agent", "llm", "ml"]
    for kw in tag_keywords:
        if kw in text_lower:
            tags.append(kw)
    tags = tags[:5]  # Limit to 5 tags

    submitted_raw = safe_get(proj, "submittedAt", default=None) or safe_get(proj, "createdAt", default=None)
    submitted = None
    if submitted_raw:
        try:
            if isinstance(submitted_raw, str):
                dt = datetime.fromisoformat(submitted_raw.replace("Z", "+00:00"))
                submitted = dt.strftime("%Y-%m-%d")
            elif isinstance(submitted_raw, (int, float)):
                dt = datetime.fromtimestamp(submitted_raw / 1000 if submitted_raw > 1e12 else submitted_raw, tz=timezone.utc)
                submitted = dt.strftime("%Y-%m-%d")
        except Exception:
            submitted = None

    category = categorize_project(name, raw_description, tags)

    project_id = safe_get(proj, "id", default=None) or safe_get(entry, "id", default=rank)

    return {
        "id": project_id,
        "name": name,
        "slug": slug,
        "description": description,
        "category": category,
        "repo": repo,
        "liveApp": live_app,
        "presentation": presentation,
        "humanVotes": human_votes,
        "agentVotes": agent_votes,
        "totalVotes": total_votes,
        "rank": rank,
        "agent": agent_name,
        "twitter": twitter,
        "twitterPic": twitter_pic,
        "tags": tags,
        "submitted": submitted,
    }


def build_registry():
    """Main function: fetch, process, save."""
    print("🚀 MoltLaunch Registry Builder")
    print(f"   API: {API_BASE}")
    print(f"   Output: {OUTPUT_FILE}")
    print()

    raw_projects = fetch_leaderboard()
    print(f"\n📊 Total raw entries fetched: {len(raw_projects)}")

    if not raw_projects:
        print("❌ No projects fetched! Check API key and endpoint.")
        return

    # Process and rank
    processed = []
    for i, entry in enumerate(raw_projects, 1):
        try:
            project = process_project(entry, fallback_rank=i)
            processed.append(project)
        except Exception as e:
            print(f"  ⚠️  Error processing entry {i}: {e}")

    print(f"✅ Processed {len(processed)} projects")

    # Build category counts
    category_counts = Counter(p["category"] for p in processed)
    print(f"\n📂 Categories:")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"   {cat}: {count}")

    # Build stats
    stats = {
        "total": len(processed),
        "with_repo": sum(1 for p in processed if p["repo"]),
        "with_live_app": sum(1 for p in processed if p["liveApp"]),
        "claimed": sum(1 for p in processed if p["twitter"]),
        "avg_human_votes": round(sum(p["humanVotes"] for p in processed) / max(len(processed), 1), 1),
        "avg_agent_votes": round(sum(p["agentVotes"] for p in processed) / max(len(processed), 1), 1),
    }

    print(f"\n📈 Stats:")
    print(f"   With repo: {stats['with_repo']}")
    print(f"   With live app: {stats['with_live_app']}")
    print(f"   Claimed (Twitter): {stats['claimed']}")
    print(f"   Avg human votes: {stats['avg_human_votes']}")
    print(f"   Avg agent votes: {stats['avg_agent_votes']}")

    # Build output
    registry = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_projects": len(processed),
        "projects": processed,
        "categories": dict(sorted(category_counts.items(), key=lambda x: -x[1])),
        "stats": stats,
    }

    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(OUTPUT_FILE, "w") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)

    file_size = os.path.getsize(OUTPUT_FILE)
    print(f"\n💾 Saved to {OUTPUT_FILE} ({file_size:,} bytes)")
    print("🎉 Registry build complete!")


if __name__ == "__main__":
    build_registry()
