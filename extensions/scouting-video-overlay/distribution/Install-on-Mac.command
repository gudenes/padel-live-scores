#!/bin/zsh
# Padel Nachos Scout setup helper. No profile changes or elevated permissions.
set -eu
PACKAGE_DIR="${0:A:h}"
EXTENSION_DIR="$PACKAGE_DIR/padel-nachos-scout"
if [[ ! -f "$EXTENSION_DIR/manifest.json" ]]; then
  print 'Please unzip the complete package first. Keep this helper beside the padel-nachos-scout folder.'
  read '?Press Return to close.'
  exit 1
fi
if [[ ! -d '/Applications/Google Chrome.app' && ! -d "$HOME/Applications/Google Chrome.app" ]]; then
  print 'Google Chrome was not found. Install it from https://www.google.com/chrome/ and run this helper again.'
  read '?Press Return to close.'
  exit 1
fi
print '\nPadel Nachos Scout — installation\n'
print 'Keep this extracted package in a permanent folder before loading the extension.'
print 'In Chrome:'
print '  1. Turn on Developer mode.'
print '  2. Click Load unpacked.'
print '  3. Choose the padel-nachos-scout folder shown in Finder.'
print '  4. Pin Padel Nachos Scout, then open its menu → Playground.'
print '\nThis helper does not change existing extension data or Chrome profiles.\n'
open -R "$EXTENSION_DIR"
open -a 'Google Chrome' 'chrome://extensions/'
read '?Press Return when finished.'
