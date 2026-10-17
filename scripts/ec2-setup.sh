#!/usr/bin/env bash
# TutorPulse: set up one EC2 instance (Ubuntu). Run with sudo, see TutorPulse_EC2_commands.txt.
# ROLE = data | learning | core | edge ; EDGE/CORE/LEARN/DATA = PRIVATE IPs of the 4 instances.
set -euo pipefail
: "${ROLE:?set ROLE=data, learning, core or edge}"
for v in EDGE CORE LEARN DATA JWT INTERNAL MONGOPW ADMINPW; do : "${!v:?missing $v}"; done
GROQ="${GROQ:-}"

command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
mkdir -p /opt && cd /opt
if [ -d tutorpulse/.git ]; then git -C tutorpulse pull --ff-only; else git clone https://github.com/VanMeysorng/tutorpulse.git; fi
cd tutorpulse

cat > .env <<ENV
JWT_SECRET=$JWT
INTERNAL_KEY=$INTERNAL
JWT_EXPIRES=1h
MONGO_PASSWORD=$MONGOPW
MONGO_URL=mongodb://tpuser:$MONGOPW@$DATA:27017/?authSource=admin
ADMIN_EMAIL=admin@tutorpulse.dev
ADMIN_PASSWORD=$ADMINPW
CORS_ORIGIN=
GROQ_API_KEY=$GROQ
GROQ_MODEL=openai/gpt-oss-120b
REGISTRATION_URL=http://$CORE:3001
LOGIN_URL=http://$CORE:3002
CLASSES_URL=http://$LEARN:3003
CONTENT_URL=http://$LEARN:3004
PRACTICE_URL=http://$DATA:3005
ANALYTICS_URL=http://$DATA:3006
GATEWAY_1=gateway-1:3000
GATEWAY_2=$CORE:3007
ENV
chmod 600 .env
chmod -R a+rX common services nginx web

docker compose --profile "$ROLE" up -d --build
echo "Waiting for containers to become healthy..."; sleep 30
docker compose --profile "$ROLE" ps

check() { if curl -s -m 3 -o /dev/null "http://$1/health"; then echo "  OK    $2"; else echo "  FAIL  $2 ($1) - not started yet or port blocked"; fi; }
echo "--- Can this instance reach the others? (FAIL is normal for instances you have not started yet)"
check "$DATA:3005" practice;      check "$DATA:3006" analytics
check "$LEARN:3003" classes;      check "$LEARN:3004" content
check "$CORE:3001" registration;  check "$CORE:3002" login;  check "$CORE:3007" gateway-2
if [ "$ROLE" = edge ]; then
  docker compose --profile edge restart nginx >/dev/null; sleep 3
  check "localhost:80" "nginx load balancer"
  for i in 1 2 3 4; do curl -s -D - -o /dev/null http://localhost/health | grep -i x-served-by; done
fi
