#!/bin/bash
# Production server keepalive — restarts if not responding.
cd /home/z/my-project
if curl -s --connect-timeout 2 --max-time 5 http://localhost:3000/ >/dev/null 2>&1; then
  exit 0
fi
echo "$(date): server dead, restarting (production)..." >> .zscripts/keepalive.log
pkill -f "next start" 2>/dev/null
pkill -f "next-server" 2>/dev/null
sleep 1
setsid bash -c './node_modules/.bin/next start -p 3000 > dev.log 2>&1' </dev/null &
disown
for i in $(seq 1 10); do
  sleep 1
  if curl -s --connect-timeout 2 --max-time 5 http://localhost:3000/ >/dev/null 2>&1; then
    echo "$(date): restarted after ${i}s" >> .zscripts/keepalive.log
    exit 0
  fi
done
echo "$(date): FAILED" >> .zscripts/keepalive.log
