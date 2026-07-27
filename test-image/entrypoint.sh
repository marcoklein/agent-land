#!/bin/bash
set -e

mkdir -p /sessions /workspace

echo '{"type":"agent_start","id":"mock-agent-1","timestamp":"'"$(date -Iseconds)"'"}'
sleep 1

echo '{"type":"turn_start","turn":1,"timestamp":"'"$(date -Iseconds)"'"}'
sleep 0.5

echo '{"type":"tool_execution_start","toolName":"bash","args":"echo hello world","timestamp":"'"$(date -Iseconds)"'"}'
sleep 0.5

echo '{"type":"tool_execution_end","toolName":"bash","isError":false,"result":"hello world","timestamp":"'"$(date -Iseconds)"'"}'
sleep 0.5

echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"I have run the command and got: hello world"}]},"timestamp":"'"$(date -Iseconds)"'"}'
sleep 1

echo '{"type":"turn_start","turn":2,"timestamp":"'"$(date -Iseconds)"'"}'
sleep 0.5

echo '{"type":"tool_execution_start","toolName":"read","args":"/etc/hostname","timestamp":"'"$(date -Iseconds)"'"}'
sleep 0.5

echo '{"type":"tool_execution_end","toolName":"read","isError":false,"result":"mock-agent-container","timestamp":"'"$(date -Iseconds)"'"}'
sleep 0.5

echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"The hostname is mock-agent-container. Task complete."}]},"timestamp":"'"$(date -Iseconds)"'"}'
sleep 1

echo '{"type":"agent_end","exitCode":0,"timestamp":"'"$(date -Iseconds)"'"}'

echo '{"type":"session","id":"mock-session-'"$(date +%s)"'","path":"/sessions/mock.jsonl"}'
