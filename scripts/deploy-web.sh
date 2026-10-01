#!/usr/bin/env bash
# Kept for muscle memory: deploys the web app. See scripts/deploy.sh for the checks.
exec "$(dirname "$0")/deploy.sh" web "$@"
