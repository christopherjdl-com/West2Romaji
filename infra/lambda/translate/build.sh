#!/bin/sh
# Build the Lambda zip contents for Amazon Linux x86_64.
# CloudFormation packages infra/lambda/translate/dist.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
DIST="$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$DIST"
python3 -m pip install \
  --requirement "$ROOT/requirements.txt" \
  --target "$DIST" \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.12 \
  --only-binary=:all: \
  --upgrade
cp \
  "$ROOT/handler.py" \
  "$ROOT/app.py" \
  "$ROOT/auth.py" \
  "$ROOT/gateway.py" \
  "$ROOT/store.py" \
  "$ROOT/errors.py" \
  "$ROOT/translation.py" \
  "$ROOT/post.py" \
  "$ROOT/signing.py" \
  "$ROOT/xai.py" \
  "$ROOT/gemini.py" \
  "$ROOT/bedrock.py" \
  "$ROOT/provider.py" \
  "$ROOT/region.py" \
  "$DIST/"
