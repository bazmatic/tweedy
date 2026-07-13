#!/bin/bash
cd /Users/barryearsman/projects/personal/tweedy
IMGDIR="audio/podcast-36ebf361-7469-4513-9078-46b2a97bf0aa-images"
SEED=424242
while IFS='|' read -r t prompt; do
  out="$IMGDIR/t${t}s.png"
  if [ -f "$out" ]; then
    echo "SKIP $out (exists)"
    continue
  fi
  echo "GENERATING $out"
  zit-generate --prompt "$prompt" --seed $SEED -o "$out" 2>&1 | tail -3
done < /tmp/scenes.tsv
echo "DONE ALL IMAGES"
