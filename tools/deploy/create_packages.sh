#!/bin/bash
rm -rf build/packages
mkdir build/packages

set -ex

npx tsc
NODE_ENV=production npx webpack build

# Copy base files
cp -r tools/deploy/{client,server,docker-compose.yml} build/packages
cp build/packages/client/config.json build/packages/server/config.json

# Copy SQL schema
mkdir build/packages/initdb/
cp server/database/table.sql build/packages/initdb/

# Build server archive
tar --exclude=assets/static/config.json -czvf build/packages/server/package.tar.gz build/server build/share assets/map/build assets/static/*.js assets/static/*.json assets/static/spritesheets/*.json package.json yarn.lock

# Build client archive
cp -r build/client build/packages/_client
cp -r assets/static/. build/packages/_client
rm build/packages/_client/*.map build/packages/_client/scriptblob.js build/packages/_client/config.json
cd build/packages/_client
tar -czvf ../client/package.tar.gz .
cd ../../..
rm -rf build/packages/_client

# Build client source code archive
mkdir build/packages/_client_source
cp -r client share package.json tsconfig.webpack.json webpack.config.js build/packages/_client_source
mkdir -p build/packages/_client_source/assets/static
cp -r assets/static/{index.html,fonts} build/packages/_client_source/assets/static
cd build/packages/_client_source
mkdir ../client_source
tar -czvf ../client_source/package.tar.gz .
cd ../../..
rm -rf build/packages/_client_source

# Test
# cd build/packages
# docker compose build
# docker compose up
# docker compose down
