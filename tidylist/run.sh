#!/bin/sh
# Starts the app, after handing the lists over from the add-on's old name.
#
# The add-on was called Shopping list (slug shopping_list). Home Assistant
# keeps each add-on's /data by slug, so Tidylist starts out empty. The old
# add-on runs this image with HANDOVER=export, which copies its database and
# files to /share and stops, rather than running the app: two apps would
# publish the same MQTT entities. Tidylist takes that copy on its first start,
# while it has no database of its own, and renames it so it is only taken once.
#
# The app is not running yet, so nothing is being written to. SQLite's -wal
# file is copied along, if a crash left one.
set -eu

DB=/data/shoppinglist.db
FILES=/data/files
SHARED=/share/tidylist-handover

if [ "${HANDOVER:-}" = export ]; then
  if [ -f "$DB" ]; then
    rm -rf "$SHARED.tmp"
    mkdir -p "$SHARED.tmp"
    cp -p "$DB"* "$SHARED.tmp/"
    if [ -d "$FILES" ]; then
      cp -a "$FILES" "$SHARED.tmp/files"
    fi
    rm -rf "$SHARED"
    mv "$SHARED.tmp" "$SHARED"
    echo "Copied the lists to $SHARED. Install the Tidylist add-on to take them over."
  else
    echo "There are no lists to copy."
  fi
  echo "This add-on is now called Tidylist, and this one only hands the lists over, so it stops here."
  exit 0
elif [ ! -e "$DB" ] && [ -f "$SHARED/shoppinglist.db" ]; then
  if [ -d "$SHARED/files" ]; then
    rm -rf "$FILES"
    cp -a "$SHARED/files" "$FILES"
  fi
  cp -p "$SHARED"/shoppinglist.db* /data/
  mv "$SHARED" "$SHARED-taken-$(date +%Y%m%d%H%M%S)"
  echo "Took over the lists from the Shopping list add-on."
fi

exec java \
  -Xmx192m -XX:+UseSerialGC \
  -Duser.timezone=UTC \
  -DAPP.PORT=8099 \
  -DDB.FILE="$DB" \
  -DWEB.DIR=/app/web \
  -DMODEL.DIR=/app/model \
  -cp "/app/lib/*" \
  no.eirikgg.shoppinglist.Main
