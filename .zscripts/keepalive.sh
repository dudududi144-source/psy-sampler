#!/bin/bash
# Keepalive watchdog — restarts the dev server if it's not responding.
# Called by cron every minute.
cd /home/z/my-project

# Check if server is alive
if curl -s --connect-timeout 2 --max-time 5 http://localhost:3000/ >/dev/null 2>&1; then
  echo "$(date): server alive" >> .zscripts/keepalive.log
  exit 0
fi

echo "$(date): server dead, restarting..." >> .zscripts/keepalive.log

# Kill any stale processes
pkill -f "next-server" 2>/dev/null
pkill -f "next dev" 2>/dev/null
sleep 1

# Start fresh, fully detached
nohup setsid ./node_modules/.bin/next dev -p 3000 </dev/null >dev.log 2>&1 &
disown 2>/dev/null

# Wait for it to come up
for i in $(seq 1 15); do
  sleep 1
  if curl -s --connect-timeout 2 --max-time 5 http://localhost:3000/ >/dev/null 2>&1; then
    echo "$(date): server restarted after ${i}s" >> .zscripts/keepalive.log
    exit 0
  fi
done

echo "$(date): FAILED to restart server" >> .zscripts/keepalive.log
exit 1
