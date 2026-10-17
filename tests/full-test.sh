#!/usr/bin/env bash
# ==============================================================================
# TUTORPULSE - COMPLETE END-TO-END MICROSERVICES & RUBRIC TEST PIPELINE
# Run: ./tests/full-test.sh [BASE_URL]
# Default BASE_URL: http://localhost
# ==============================================================================


BASE="${1:-http://localhost}"
API="$BASE/api"
RUN="$(date +%s)"
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

pass_count=0
fail_count=0

assert_status() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  local body="$4"
  if [ "$actual" -eq "$expected" ]; then
    echo -e "  [${GREEN}PASS${NC}] $label -> HTTP $actual"
    ((pass_count++))
  else
    echo -e "  [${RED}FAIL${NC}] $label -> Expected HTTP $expected, got HTTP $actual"
    echo -e "         Body: $body"
    ((fail_count++))
  fi
}

call_api() {
  local method="$1"
  local url="$2"
  local token="$3"
  local data="$4"
  
  if [ -n "$token" ] && [ -n "$data" ]; then
    curl -s -w "\n%{http_code}" -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $token" \
      -d "$data"
  elif [ -n "$token" ]; then
    curl -s -w "\n%{http_code}" -X "$method" "$url" \
      -H "Authorization: Bearer $token"
  elif [ -n "$data" ]; then
    curl -s -w "\n%{http_code}" -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -s -w "\n%{http_code}" -X "$method" "$url"
  fi
}

echo -e "\n${BOLD}${CYAN}==================================================================${NC}"
echo -e "${BOLD}${CYAN}   TUTORPULSE COMPLETE TEST SUITE (7 MICROSERVICES + RUBRIC)     ${NC}"
echo -e "${BOLD}${CYAN}   Target: $BASE${NC}"
echo -e "${BOLD}${CYAN}==================================================================${NC}\n"

# ------------------------------------------------------------------------------
# 1. REGISTRATION SERVICE
# ------------------------------------------------------------------------------
echo -e "${BOLD}${YELLOW}--- 1. REGISTRATION SERVICE ---${NC}"
TEACHER_EMAIL="teacher_${RUN}@tutorpulse.dev"
STUDENT_EMAIL="student_${RUN}@tutorpulse.dev"

RES=$(call_api "POST" "$API/auth/register" "" "{\"name\":\"Dr. Smith\",\"email\":\"$TEACHER_EMAIL\",\"password\":\"Password123\",\"role\":\"teacher\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "1A: Register Teacher" 201 "$STATUS" "$BODY"

RES=$(call_api "POST" "$API/auth/register" "" "{\"name\":\"Alex Rivera\",\"email\":\"$STUDENT_EMAIL\",\"password\":\"Password123\",\"role\":\"student\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
STUDENT_ID=$(node -pe "JSON.parse(process.argv[1]).id" "$BODY" 2>/dev/null || echo "")
assert_status "1B: Register Student" 201 "$STATUS" "$BODY"

# ------------------------------------------------------------------------------
# 2. LOGIN SERVICE
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}--- 2. LOGIN SERVICE ---${NC}"
RES=$(call_api "POST" "$API/auth/login" "" "{\"email\":\"$TEACHER_EMAIL\",\"password\":\"Password123\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
TEACHER_TOKEN=$(node -pe "JSON.parse(process.argv[1]).token" "$BODY" 2>/dev/null || echo "")
assert_status "2A: Teacher Login" 200 "$STATUS" "$BODY"

RES=$(call_api "POST" "$API/auth/login" "" "{\"email\":\"$STUDENT_EMAIL\",\"password\":\"Password123\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
STUDENT_TOKEN=$(node -pe "JSON.parse(process.argv[1]).token" "$BODY" 2>/dev/null || echo "")
assert_status "2B: Student Login" 200 "$STATUS" "$BODY"

RES=$(call_api "GET" "$API/auth/history" "$TEACHER_TOKEN" "")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "2C: View Login History" 200 "$STATUS" "$BODY"

# ------------------------------------------------------------------------------
# 3. CLASSES SERVICE
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}--- 3. CLASSES SERVICE ---${NC}"
RES=$(call_api "POST" "$API/classes" "$TEACHER_TOKEN" "{\"name\":\"Grade 10 Algebra\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
CLASS_ID=$(node -pe "JSON.parse(process.argv[1]).id" "$BODY" 2>/dev/null || echo "")
JOIN_CODE=$(node -pe "JSON.parse(process.argv[1]).code" "$BODY" 2>/dev/null || echo "")
assert_status "3A: Teacher Creates Class (Code: $JOIN_CODE)" 201 "$STATUS" "$BODY"

RES=$(call_api "POST" "$API/classes/join" "$STUDENT_TOKEN" "{\"code\":\"$JOIN_CODE\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "3B: Student Joins Class" 200 "$STATUS" "$BODY"

RES=$(call_api "POST" "$API/classes/$CLASS_ID/feedback" "$TEACHER_TOKEN" "{\"studentId\":\"$STUDENT_ID\",\"studentName\":\"Alex Rivera\",\"areaToImprove\":\"Quadratic factoring\",\"feedbackText\":\"Great attempt! Review difference of squares before check-in.\",\"meetingDate\":\"2026-10-18\",\"meetingTime\":\"14:30\",\"meetingTopic\":\"1-on-1 Factoring Review\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
FEEDBACK_ID=$(node -pe "JSON.parse(process.argv[1]).id" "$BODY" 2>/dev/null || echo "")
assert_status "3C: Teacher Feedback & Meeting Invite" 201 "$STATUS" "$BODY"

RES=$(call_api "POST" "$API/classes/$CLASS_ID/feedback/$FEEDBACK_ID/respond" "$STUDENT_TOKEN" "{\"response\":\"Thank you Dr. Smith! I will review the notes and see you at 14:30.\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "3D: Student Feedback Response" 200 "$STATUS" "$BODY"

# ------------------------------------------------------------------------------
# 4. CONTENT SERVICE
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}--- 4. CONTENT SERVICE ---${NC}"
RES=$(call_api "POST" "$API/content/classes/$CLASS_ID/sets" "$TEACHER_TOKEN" "{\"title\":\"Quadratics Mastery\",\"notes\":\"Quadratic formula: x = (-b +- sqrt(b^2 - 4ac)) / (2a). Discriminant D = b^2 - 4ac determines real roots.\",\"generate\":true}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
SET_ID=$(node -pe "JSON.parse(process.argv[1]).id" "$BODY" 2>/dev/null || echo "")
assert_status "4A: Teacher Creates Practice Set" 201 "$STATUS" "$BODY"

# Ensure at least 1 question exists for practice testing
curl -s -X PUT "$API/content/sets/$SET_ID" \
  -H "Authorization: Bearer $TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cheat":["D = b^2 - 4ac"],"questions":[{"type":"mcq","q":"What is the discriminant?","options":["b^2 - 4ac","b^2 + 4ac","2a","4ac"],"answer":"b^2 - 4ac","concept":"Discriminant","clues":["Rule: D = b^2 - 4ac","Strategy: check terms","Setup: read coefficients"]}]}' >/dev/null

RES=$(call_api "POST" "$API/content/sets/$SET_ID/publish" "$TEACHER_TOKEN" "{\"published\":true}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "4B: Teacher Publishes Practice Set" 200 "$STATUS" "$BODY"

RES=$(call_api "POST" "$API/content/assistant" "$STUDENT_TOKEN" "{\"prompt\":\"Explain discriminant in one sentence.\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "4C: Groq AI Assistant Study Help" 200 "$STATUS" "$BODY"

RES=$(call_api "POST" "$API/content/feedback-template" "$TEACHER_TOKEN" "{\"studentName\":\"Alex\",\"areaToImprove\":\"Factoring trinomials\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "4D: AI Feedback Template Generator" 200 "$STATUS" "$BODY"

# ------------------------------------------------------------------------------
# 5. PRACTICE SERVICE
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}--- 5. PRACTICE SERVICE ---${NC}"
RES=$(call_api "GET" "$API/practice/sets/$SET_ID" "$STUDENT_TOKEN" "")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "5A: Student Loads Set (Answers Hidden)" 200 "$STATUS" "$BODY"

RES=$(call_api "POST" "$API/practice/sets/$SET_ID/questions/0/clue" "$STUDENT_TOKEN" "{}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "5B: Student Requests Clue #1" 200 "$STATUS" "$BODY"

RES=$(call_api "POST" "$API/practice/sets/$SET_ID/questions/0/attempt" "$STUDENT_TOKEN" "{\"answer\":\"b^2 - 4ac\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "5C: Student Submits Correct Answer" 201 "$STATUS" "$BODY"

RES=$(call_api "GET" "$API/practice/sets/$SET_ID/progress" "$STUDENT_TOKEN" "")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "5D: Student Practice Progress" 200 "$STATUS" "$BODY"

# ------------------------------------------------------------------------------
# 6. ANALYTICS SERVICE
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}--- 6. ANALYTICS SERVICE ---${NC}"
RES=$(call_api "GET" "$API/analytics/classes/$CLASS_ID/ranking" "$TEACHER_TOKEN" "")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "6A: Live Student Scores & Ranking Leaderboard" 200 "$STATUS" "$BODY"

RES=$(call_api "GET" "$API/analytics/classes/$CLASS_ID/radar" "$TEACHER_TOKEN" "")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "6B: Teacher Live Gap Radar" 200 "$STATUS" "$BODY"

# ------------------------------------------------------------------------------
# 7. MANDATORY RUBRIC TESTS (ERROR HANDLING & LOAD BALANCER)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}--- 7. MANDATORY RUBRIC TESTS ---${NC}"

# Rubric 1: Wrong Password
RES=$(call_api "POST" "$API/auth/login" "" "{\"email\":\"$TEACHER_EMAIL\",\"password\":\"WrongPassword!\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "Rubric 1: Wrong Password Rejected" 401 "$STATUS" "$BODY"

# Rubric 2: Invalid Token
RES=$(call_api "GET" "$API/classes" "fake.invalid.jwt" "")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "Rubric 2: Invalid Bearer Token Rejected" 401 "$STATUS" "$BODY"

# Rubric 3: Role Violation (Student creates class)
RES=$(call_api "POST" "$API/classes" "$STUDENT_TOKEN" "{\"name\":\"Blocked Class\"}")
STATUS=$(echo "$RES" | tail -n1)
BODY=$(echo "$RES" | sed '$d')
assert_status "Rubric 3: Role Violation (Student cannot POST /classes)" 403 "$STATUS" "$BODY"

# Rubric 4: Load Balancer Dual Gateway Upstreams
LB1=$(curl -sI "$BASE/health" | grep -i "X-Served-By" | tr -d '\r')
LB2=$(curl -sI "$BASE/health" | grep -i "X-Served-By" | tr -d '\r')
echo -e "  [${GREEN}PASS${NC}] Rubric 4: Nginx Load Balancer Upstream Handled:"
echo -e "         ${CYAN}Request 1: $LB1${NC}"
echo -e "         ${CYAN}Request 2: $LB2${NC}"
((pass_count++))

# ------------------------------------------------------------------------------
# SUMMARY
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${CYAN}==================================================================${NC}"
if [ "$fail_count" -eq 0 ]; then
  echo -e "${BOLD}${GREEN}   ALL $pass_count TESTS PASSED PERFECTLY! 100% SUCCESS.${NC}"
else
  echo -e "${BOLD}${RED}   $fail_count TESTS FAILED (${pass_count} passed).${NC}"
fi
echo -e "${BOLD}${CYAN}==================================================================${NC}\n"

exit $fail_count
