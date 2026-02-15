#!/bin/bash
set -euo pipefail

UPSTREAM_REPO="atalovesyou/claude-max-api-proxy"
TARGET_BRANCH="main"

if ! git remote | grep -q "^upstream$"; then
    echo "Adding upstream remote..."
    git remote add upstream "https://github.com/${UPSTREAM_REPO}.git"
fi

echo "Fetching upstream..."
git fetch upstream
git fetch upstream '+refs/pull/*/head:refs/remotes/upstream/pr/*'

echo "Checking out ${TARGET_BRANCH}..."
git checkout "$TARGET_BRANCH"
git pull origin "$TARGET_BRANCH" --ff-only || true

PR_NUMBERS=$(gh pr list --repo "$UPSTREAM_REPO" --state open --json number --jq '.[].number' | sort -n)

if [ -z "$PR_NUMBERS" ]; then
    echo "No open PRs found."
    exit 0
fi

echo "Found open PRs: $(echo $PR_NUMBERS | tr '\n' ' ')"

MERGED=0
FAILED=0

for pr in $PR_NUMBERS; do
    TITLE=$(gh pr view "$pr" --repo "$UPSTREAM_REPO" --json title --jq '.title')
    echo "Merging PR #${pr}: ${TITLE}..."
    if git merge "upstream/pr/${pr}" --no-ff -m "Merge upstream PR #${pr}: ${TITLE}"; then
        echo "PR #${pr} merged successfully."
        MERGED=$((MERGED + 1))
    else
        echo "PR #${pr} has conflicts. Please resolve them now."
        echo "Conflicting files:"
        git diff --name-only --diff-filter=U
        echo ""
        echo "After resolving all conflicts, stage the files with 'git add' in another terminal."
        read -p "Press Enter when conflicts are resolved, or type 'skip' to abort this PR: " RESPONSE
        if [ "$RESPONSE" = "skip" ]; then
            echo "Skipping PR #${pr}."
            git merge --abort
            FAILED=$((FAILED + 1))
        else
            if git diff --name-only --diff-filter=U | grep -q .; then
                echo "There are still unresolved conflicts. Aborting PR #${pr}."
                git merge --abort
                FAILED=$((FAILED + 1))
            else
                git commit --no-edit
                echo "PR #${pr} merged after conflict resolution."
                MERGED=$((MERGED + 1))
            fi
        fi
    fi
done

echo "Done. Merged: ${MERGED}, Skipped (conflicts): ${FAILED}"

if [ "$MERGED" -gt 0 ]; then
    echo "Pushing to origin/${TARGET_BRANCH}..."
    git push origin "$TARGET_BRANCH"
    echo "Push complete."
fi
