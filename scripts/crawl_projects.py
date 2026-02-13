import requests
import time
import json
import re
import os
from collections import Counter

API_BASE = "https://agents.colosseum.com/api"
API_KEY = os.environ.get("COLOSSEUM_API_KEY", "")
HEADERS = {"Authorization": f"Bearer {API_KEY}"}

# Rate limit: wait between requests
RATE_LIMIT = 0.5


def fetch_all_projects():
    projects = []
    offset = 0
    limit = 50  # smaller batches to be safe

    while True:
        print(f"Fetching projects offset={offset}...")
        resp = requests.get(
            f"{API_BASE}/projects?limit={limit}&offset={offset}",
            headers=HEADERS
        )
        time.sleep(RATE_LIMIT)

        if resp.status_code != 200:
            print(f"Error {resp.status_code}: {resp.text[:200]}")
            break

        data = resp.json()
        batch = data.get("projects", [])
        if not batch:
            break

        projects.extend(batch)
        print(f"  Got {len(batch)} projects (total: {len(projects)})")
        offset += limit

        # Safety: stop if we've gone past reasonable bounds
        if offset > 500:
            break

    return projects


def extract_solana_addresses(text):
    """Find Solana base58 addresses (32-44 chars, base58 charset)"""
    # Solana address pattern
    pattern = r'\b([1-9A-HJ-NP-Za-km-z]{32,44})\b'
    candidates = re.findall(pattern, text)

    # Filter out common false positives
    addresses = []
    for addr in candidates:
        # Skip if it looks like a URL path, hash, or common word
        if len(addr) < 32 or len(addr) > 44:
            continue
        if addr.startswith("http") or addr.startswith("www"):
            continue
        # Basic base58 validation
        try:
            # Check it's valid base58
            import base58
            base58.b58decode(addr)
            addresses.append(addr)
        except Exception:
            # If base58 module not available, just do basic check
            valid_chars = set("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
            if all(c in valid_chars for c in addr) and len(addr) >= 32:
                addresses.append(addr)

    return list(set(addresses))  # Deduplicate


def fetch_github_data(repo_url):
    """Fetch basic repo info from GitHub API"""
    if not repo_url:
        return None

    # Parse owner/repo from URL
    match = re.match(r'https?://github\.com/([^/]+)/([^/\s]+)', repo_url)
    if not match:
        return None

    owner, repo = match.groups()
    repo = repo.rstrip('/')

    try:
        resp = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}",
            timeout=10
        )
        time.sleep(RATE_LIMIT)  # GitHub rate limit

        if resp.status_code == 200:
            data = resp.json()
            return {
                "exists": True,
                "stars": data.get("stargazers_count", 0),
                "forks": data.get("forks_count", 0),
                "language": data.get("language"),
                "size": data.get("size", 0),
                "created_at": data.get("created_at"),
                "pushed_at": data.get("pushed_at"),
                "open_issues": data.get("open_issues_count", 0),
                "description": data.get("description", ""),
                "topics": data.get("topics", []),
                "default_branch": data.get("default_branch", "main"),
            }
        elif resp.status_code == 404:
            return {"exists": False, "reason": "not_found"}
        elif resp.status_code == 403:
            # Rate limited
            return {"exists": None, "reason": "rate_limited"}
        else:
            return {"exists": False, "reason": f"status_{resp.status_code}"}
    except Exception as e:
        return {"exists": False, "reason": str(e)}


def categorize_project(text, tags):
    """Categorize based on description text and tags"""
    text_lower = text.lower()

    categories = {
        "Trading & DeFi": ["trading", "swap", "dex", "defi", "yield", "arbitrage", "liquidat", "perpetual", "futures", "amm", "vault"],
        "Identity & Trust": ["identity", "verification", "trust", "sybil", "reputation", "attestation", "proof-of"],
        "Gaming & Entertainment": ["game", "poker", "casino", "play", "minecraft", "nft", "entertainment", "stream"],
        "DevTools & Infrastructure": ["sdk", "framework", "developer", "tool", "infrastructure", "api", "library"],
        "Payments & Commerce": ["payment", "escrow", "commerce", "marketplace", "x402", "invoice", "merchant"],
        "Social & Communication": ["social", "chat", "message", "community", "forum", "notification"],
        "Analytics & Data": ["analytics", "dashboard", "monitor", "data", "track", "metric", "index"],
        "DePIN & IoT": ["depin", "iot", "hardware", "sensor", "device", "helium", "hivemapper"],
        "Governance & DAO": ["governance", "dao", "vote", "proposal", "treasury"],
    }

    scores = {}
    for cat, keywords in categories.items():
        score = sum(1 for kw in keywords if kw in text_lower)
        # Also check tags
        for tag in (tags or []):
            if tag.lower() in [k.lower() for k in keywords]:
                score += 2
        scores[cat] = score

    if max(scores.values()) == 0:
        return "Other / Unclear"

    return max(scores, key=scores.get)


def analyze_project(project):
    result = {
        "id": project.get("id"),
        "name": project.get("name"),
        "slug": project.get("slug"),
        "description": project.get("description", ""),
        "repoLink": project.get("repoLink"),
        "solanaIntegration": project.get("solanaIntegration", ""),
        "technicalDemoLink": project.get("technicalDemoLink"),
        "presentationLink": project.get("presentationLink"),
        "tags": project.get("tags", []),
        "status": project.get("status"),
        "humanUpvotes": project.get("humanUpvotes", 0),
        "agentUpvotes": project.get("agentUpvotes", 0),
        "totalVotes": (project.get("humanUpvotes", 0) or 0) + (project.get("agentUpvotes", 0) or 0),
        "ownerAgentName": project.get("ownerAgentName"),
        "teamName": project.get("teamName"),
        "submittedAt": project.get("submittedAt"),
        "createdAt": project.get("createdAt"),
        "updatedAt": project.get("updatedAt"),
        # Analysis fields (to be filled)
        "category": None,
        "solanaAddresses": [],
        "githubData": None,
        "verificationScore": 0,
        "scoreBreakdown": {},
    }

    # Extract Solana addresses from description + solanaIntegration
    text = (result["description"] or "") + " " + (result["solanaIntegration"] or "")
    result["solanaAddresses"] = extract_solana_addresses(text)

    # Categorize
    result["category"] = categorize_project(text, result["tags"])

    return result


def compute_verification_score(project):
    """Score 0-100 based on multiple signals"""
    score = 0
    breakdown = {}

    # Has GitHub repo (+15)
    if project.get("repoLink") and "github.com" in (project["repoLink"] or ""):
        score += 15
        breakdown["hasGithub"] = 15

    # GitHub repo exists and has code (+10)
    gh = project.get("githubData")
    if gh and gh.get("exists"):
        score += 10
        breakdown["githubExists"] = 10

        # Has stars (+5)
        if gh.get("stars", 0) > 0:
            score += 5
            breakdown["hasStars"] = 5

        # Recent push within hackathon period (+10)
        if gh.get("pushed_at", "") >= "2026-02-02":
            score += 10
            breakdown["recentActivity"] = 10

        # Code size > 100KB (+5)
        if gh.get("size", 0) > 100:
            score += 5
            breakdown["codeSize"] = 5

    # Has Solana addresses in description (+10)
    if project.get("solanaAddresses"):
        score += 10
        breakdown["hasSolanaAddresses"] = 10

    # Has solanaIntegration field filled (+5)
    if project.get("solanaIntegration") and len(project["solanaIntegration"]) > 20:
        score += 5
        breakdown["hasSolanaDescription"] = 5

    # Has demo link (+10)
    if project.get("technicalDemoLink"):
        score += 10
        breakdown["hasDemoLink"] = 10

    # Has presentation/video (+5)
    if project.get("presentationLink"):
        score += 5
        breakdown["hasPresentation"] = 5

    # Is submitted (not draft) (+5)
    if project.get("status") == "submitted":
        score += 5
        breakdown["isSubmitted"] = 5

    # Has tags (+5)
    if project.get("tags") and len(project["tags"]) > 0:
        score += 5
        breakdown["hasTags"] = 5

    # Description quality (length > 200 chars) (+5)
    desc = project.get("description", "") or ""
    if len(desc) > 200:
        score += 5
        breakdown["descriptionQuality"] = 5

    # Cap at 100
    score = min(100, score)

    return score, breakdown


def main():
    print("=== Colosseum Project Crawler ===")
    print()

    # Step 1: Fetch all projects
    projects = fetch_all_projects()
    print(f"\nTotal projects fetched: {len(projects)}")

    # Step 2: Analyze each project
    analyzed = []
    github_count = 0
    github_rate_limited = False
    for i, project in enumerate(projects):
        print(f"\nAnalyzing [{i+1}/{len(projects)}]: {project.get('name', 'Unknown')}")

        result = analyze_project(project)

        # Fetch GitHub data (rate limited)
        if result["repoLink"] and not github_rate_limited:
            github_count += 1
            print(f"  Fetching GitHub: {result['repoLink']}")
            result["githubData"] = fetch_github_data(result["repoLink"])
            if result["githubData"] and result["githubData"].get("exists"):
                print(f"    ✓ Stars: {result['githubData']['stars']}, Language: {result['githubData']['language']}")
            elif result["githubData"] and result["githubData"].get("reason") == "rate_limited":
                print(f"    ⚠ GitHub rate limited! Skipping remaining GitHub calls.")
                github_rate_limited = True
                result["githubData"] = {"exists": None, "reason": "rate_limited"}
            else:
                print(f"    ✗ Not found or error")
        elif result["repoLink"] and github_rate_limited:
            result["githubData"] = {"exists": None, "reason": "rate_limited_skipped"}

        # Compute verification score
        score, breakdown = compute_verification_score(result)
        result["verificationScore"] = score
        result["scoreBreakdown"] = breakdown
        print(f"  Score: {score}/100 | Category: {result['category']}")

        analyzed.append(result)

    # Step 3: Validation
    print(f"\n=== VALIDATION ===")
    print(f"Total projects: {len(analyzed)}")
    print(f"With GitHub link: {sum(1 for p in analyzed if p.get('repoLink'))}")
    print(f"GitHub verified (exists): {sum(1 for p in analyzed if p.get('githubData', {}).get('exists') == True)}")
    print(f"GitHub not found: {sum(1 for p in analyzed if p.get('githubData', {}).get('exists') == False)}")
    print(f"GitHub rate limited (skipped): {sum(1 for p in analyzed if p.get('githubData', {}).get('reason', '').startswith('rate_limited'))}")
    print(f"GitHub actually checked: {github_count}")
    print(f"With Solana addresses: {sum(1 for p in analyzed if p.get('solanaAddresses'))}")
    print(f"With demo links: {sum(1 for p in analyzed if p.get('technicalDemoLink'))}")
    print(f"Submitted: {sum(1 for p in analyzed if p.get('status') == 'submitted')}")
    print(f"Draft: {sum(1 for p in analyzed if p.get('status') == 'draft')}")

    # Category distribution
    cats = Counter(p["category"] for p in analyzed)
    print(f"\nCategory distribution:")
    for cat, count in cats.most_common():
        print(f"  {cat}: {count}")

    # Score distribution
    tiers = {"excellent": 0, "good": 0, "needs_work": 0, "poor": 0}
    for p in analyzed:
        s = p["verificationScore"]
        if s >= 80:
            tiers["excellent"] += 1
        elif s >= 60:
            tiers["good"] += 1
        elif s >= 40:
            tiers["needs_work"] += 1
        else:
            tiers["poor"] += 1

    print(f"\nScore tiers:")
    for tier, count in tiers.items():
        print(f"  {tier}: {count}")

    # Step 4: Save
    output_path = os.path.expanduser("~/moltbot-trial/products/launchpad/moltlaunch-site/data/full-project-analysis.json")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    output = {
        "crawledAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totalProjects": len(analyzed),
        "validation": {
            "withGithubLink": sum(1 for p in analyzed if p.get("repoLink")),
            "githubVerified": sum(1 for p in analyzed if p.get("githubData", {}).get("exists") == True),
            "githubNotFound": sum(1 for p in analyzed if p.get("githubData", {}).get("exists") == False),
            "githubRateLimited": sum(1 for p in analyzed if p.get("githubData", {}).get("reason", "").startswith("rate_limited")),
            "githubActuallyChecked": github_count,
            "withSolanaAddresses": sum(1 for p in analyzed if p.get("solanaAddresses")),
            "withDemoLinks": sum(1 for p in analyzed if p.get("technicalDemoLink")),
            "submitted": sum(1 for p in analyzed if p.get("status") == "submitted"),
        },
        "categories": dict(cats.most_common()),
        "scoreTiers": tiers,
        "projects": analyzed
    }

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2, default=str)

    print(f"\nSaved to: {output_path}")
    print(f"File size: {os.path.getsize(output_path) / 1024:.1f} KB")
    print(f"\n=== CRAWL COMPLETE ===")


if __name__ == "__main__":
    main()
