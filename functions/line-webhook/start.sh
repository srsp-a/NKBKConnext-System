#!/bin/bash
# LINE Webhook Startup Script for Synology NAS
# ใช้กับ Task Scheduler

# กำหนด path ของ Node.js (เปลี่ยนตามเวอร์ชันที่ติดตั้ง)
NODE_PATH="/var/packages/Node.js_v20/target/usr/local/bin/node"

# ถ้าไม่เจอ v20 ให้ลองหาเวอร์ชันอื่น
if [ ! -f "$NODE_PATH" ]; then
    NODE_PATH="/var/packages/Node.js_v18/target/usr/local/bin/node"
fi
if [ ! -f "$NODE_PATH" ]; then
    NODE_PATH="/var/packages/Node.js_v16/target/usr/local/bin/node"
fi
if [ ! -f "$NODE_PATH" ]; then
    NODE_PATH=$(which node)
fi

# Path ของ webhook server
WEBHOOK_DIR="/volume1/web/line-webhook"
LOG_FILE="$WEBHOOK_DIR/webhook.log"

# หยุด process เก่า ทั้ง 2 แบบเพื่อให้แน่ใจ
pkill -f "node.*server.js" 2>/dev/null
pkill -f "node server.js" 2>/dev/null

# รอให้พอร์ตปล่อย
sleep 3

# ตรวจพอร์ต 3001 ถ้ายังถูกใช้ ให้ kill process ที่ใช้อยู่
PORT_PID=$(lsof -t -i :3001 2>/dev/null)
if [ -n "$PORT_PID" ]; then
    echo "[$(date)] Port 3001 still in use by PID $PORT_PID, killing..." >> "$LOG_FILE"
    kill -9 $PORT_PID 2>/dev/null
    sleep 2
fi

# เริ่มรัน server
cd "$WEBHOOK_DIR"
nohup "$NODE_PATH" server.js >> "$LOG_FILE" 2>&1 &
NEW_PID=$!
sleep 2

# ตรวจว่า process ยังรันอยู่
if kill -0 $NEW_PID 2>/dev/null; then
    echo "[$(date)] LINE Webhook started (PID: $NEW_PID)" >> "$LOG_FILE"
    echo "LINE Webhook started (PID: $NEW_PID)"
else
    echo "[$(date)] ERROR: Server failed to start! Check $LOG_FILE" >> "$LOG_FILE"
    echo "ERROR: Server failed to start! Check $LOG_FILE"
    exit 1
fi
