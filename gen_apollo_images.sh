#!/bin/bash
cd /Users/barryearsman/projects/personal/tweedy
IMGDIR="audio/podcast-f634776b-images"
SEED=424242
jq -c '.[]' audio/podcast-f634776b-scenes.json | while read -r scene; do
  t=$(echo "$scene" | jq -r '.t')
  prompt=$(echo "$scene" | jq -r '.prompt')
  out=$(printf "%s/t%03ds.png" "$IMGDIR" "$t")
  if [ -f "$out" ]; then
    echo "SKIP $out (exists)"
    continue
  fi
  echo "GENERATING $out"
  zit-generate --prompt "$prompt" --seed $SEED -o "$out" 2>&1 | tail -3
done
echo "DONE ALL IMAGES"
