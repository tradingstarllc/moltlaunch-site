"""
Retry GitHub API calls for rate-limited projects.
Run this after the GitHub rate limit resets (60 requests per hour for unauthenticated).
Each run will process up to 55 projects (leaving headroom).
"""
import json
import re
import time
import requests
import os

RATE_LIMIT = 0.5
DATA_PATH = os.path.expanduser("~/moltbot-trial/products/launchpad/moltlaunch-site/data/full-project-analysis.json")


def fetch_github_data(repo_url):
    if not repo_url:
        return None
    match = re.match(r'https?://github\.com/([^/]+)/([^/\s]+)', repo_url)
    if not match:
        return None
    owner, repo = match.groups()
    repo = repo.rstrip('/')
    try:
        resp = requests.get(f"https://api.github.com/repos/{owner}/{repo}", timeout=10)
        time.sleep(RATE_LIMIT)
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
            return {"exists": None, "reason": "rate_limited"}
        else:
            return {"exists": False, "reason": f"status_{resp.status_code}"}
    except Exception as e:
        return {"exists": False, "reason": str(e)}


def compute_verification_score(project):
    score = 0
    breakdown = {}
    if project.get("repoLink") and "github.com" in (project["repoLink"] or ""):
        score += 15
        breakdown["hasGithub"] = 15
    gh = project.get("githubData")
    if gh and gh.get("exists"):
        score += 10
        breakdown["githubExists"] = 10
        if gh.get("stars", 0) > 0:
            score += 5
            breakdown["hasStars"] = 5
        if gh.get("pushed_at", "") >= "2026-02-02":
            score += 10
            breakdown["recentActivity"] = 10
        if gh.get("size", 0) > 100:
            score += 5
            breakdown["codeSize"] = 5
    if project.get("solanaAddresses"):
        score += 10
        breakdown["hasSolanaAddresses"] = 10
    if project.get("solanaIntegration") and len(project["solanaIntegration"]) > 20:
        score += 5
        breakdown["hasSolanaDescription"] = 5
    if project.get("technicalDemoLink"):
        score += 10
        breakdown["hasDemoLink"] = 10
    if project.get("presentationLink"):
        score += 5
        breakdown["hasPresentation"] = 5
    if project.get("status") == "submitted":
        score += 5
        breakdown["isSubmitted"] = 5
    if project.get("tags") and len(project["tags"]) > 0:
        score += 5
        breakdown["hasTags"] = 5
    desc = project.get("description", "") or ""
    if len(desc) > 200:
        score += 5
        breakdown["descriptionQuality"] = 5
    return min(100, score), breakdown


def main():
    with open(DATA_PATH) as f:
        data = json.load(f)

    # Check rate limit first
    rl = requests.get("https://api.github.com/rate_limit").json()
    remaining = rl["rate"]["remaining"]
    print(f"GitHub API remaining: {remaining}/60")
    if remaining < 5:
        print("Not enough remaining. Wait for reset.")
        return

    max_calls = min(remaining - 5, 55)  # Leave headroom
    projects = data["projects"]

    # Find rate-limited projects
    to_retry = [
        (i, p) for i, p in enumerate(projects)
        if p.get("githubData", {}).get("reason", "").startswith("rate_limited")
    ]
    print(f"Projects needing GitHub retry: {len(to_retry)}")
    print(f"Will process up to: {max_calls}")

    retried = 0
    for idx, (i, project) in enumerate(to_retry[:max_calls]):
        print(f"  [{idx+1}/{min(len(to_retry), max_calls)}] {project['name']}: {project['repoLink']}")
        gh = fetch_github_data(project["repoLink"])
        if gh and gh.get("reason") == "rate_limited":
            print(f"    ⚠ Rate limited again, stopping.")
            break
        projects[i]["githubData"] = gh
        # Recompute score
        score, breakdown = compute_verification_score(projects[i])
        projects[i]["verificationScore"] = score
        projects[i]["scoreBreakdown"] = breakdown
        if gh and gh.get("exists"):
            print(f"    ✓ Stars: {gh['stars']}, Language: {gh['language']}")
        elif gh and gh.get("exists") == False:
            print(f"    ✗ Not found: {gh.get('reason')}")
        retried += 1

    # Update validation stats
    data["validation"]["githubVerified"] = sum(1 for p in projects if p.get("githubData", {}).get("exists") == True)
    data["validation"]["githubNotFound"] = sum(1 for p in projects if p.get("githubData", {}).get("exists") == False)
    data["validation"]["githubRateLimited"] = sum(1 for p in projects if p.get("githubData", {}).get("reason", "").startswith("rate_limited"))

    # Update score tiers
    tiers = {"excellent": 0, "good": 0, "needs_work": 0, "poor": 0}
    for p in projects:
        s = p["verificationScore"]
        if s >= 80: tiers["excellent"] += 1
        elif s >= 60: tiers["good"] += 1
        elif s >= 40: tiers["needs_work"] += 1
        else: tiers["poor"] += 1
    data["scoreTiers"] = tiers

    data["lastRetryAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ")

    with open(DATA_PATH, "w") as f:
        json.dump(data, f, indent=2, default=str)

    print(f"\nRetried: {retried}")
    print(f"Remaining rate limited: {sum(1 for p in projects if p.get('githubData', {}).get('reason', '').startswith('rate_limited'))}")
    print(f"GitHub verified total: {data['validation']['githubVerified']}")
    print(f"Saved to: {DATA_PATH}")


if __name__ == "__main__":
    main()
