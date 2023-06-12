#!/bin/bash

for f in assets/map/*.tsx; do
  fname=$(basename "$f")
  echo "Exporting tileset: $fname"
  tiled --export-tileset json "$f" "assets/map_export/$fname.json"
done

for f in assets/map/*.tmx; do
  fname=$(basename "$f")
  echo "Exporting map: $fname"
  tiled --export-map json "$f" "assets/map_export/$fname.json"
done
