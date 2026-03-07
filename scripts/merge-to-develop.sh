#!/usr/bin/env bash
#
# merge-to-develop.sh — Local replacement for the auto-merge-develop GitHub Action.
#
# Runs build + tests locally. If everything passes, merges the current branch
# into develop and pushes. This is free (no CI minutes consumed) and achieves
# the same result as the old auto-merge-develop.yml workflow.
#
# Usage:
#   ./scripts/merge-to-develop.sh          # build + test + merge
#   ./scripts/merge-to-develop.sh --skip-ci  # skip build/tests (merge only)
#

set -euo pipefail

SKIP_CI=false
for arg in "$@"; do
  case "$arg" in
    --skip-ci) SKIP_CI=true ;;
    -h|--help)
      echo "Usage: $0 [--skip-ci]"
      echo "  --skip-ci   Skip build and tests (merge only)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      exit 1
      ;;
  esac
done

# Ensure we're in the repo root
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Get current branch
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "develop" ]; then
  echo "Error: You're on '$BRANCH'. Switch to a feature branch first."
  exit 1
fi

# Ensure working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: Working tree is dirty. Commit or stash your changes first."
  exit 1
fi

echo "=== Merging '$BRANCH' into develop ==="

# Step 1: Build and test (unless skipped)
if [ "$SKIP_CI" = false ]; then
  echo ""
  echo "--- Building all workspaces ---"
  npm run build

  echo ""
  echo "--- Running tests ---"
  npm test

  echo ""
  echo "All checks passed."
else
  echo ""
  echo "--- Skipping build and tests (--skip-ci) ---"
fi

# Step 2: Merge into develop
echo ""
echo "--- Fetching latest develop ---"
git fetch origin develop

echo ""
echo "--- Checking out develop ---"
git checkout develop
git pull origin develop

echo ""
echo "--- Merging '$BRANCH' into develop ---"
git merge --no-ff "$BRANCH" -m "Merge $BRANCH into develop"

echo ""
echo "--- Pushing develop ---"
git push origin develop

# Step 3: Clean up — delete the feature branch (local + remote)
echo ""
echo "--- Cleaning up feature branch ---"
git branch -d "$BRANCH" 2>/dev/null || true
git push origin --delete "$BRANCH" 2>/dev/null || true

echo ""
echo "=== Done! '$BRANCH' has been merged into develop ==="
