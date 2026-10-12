#!/usr/bin/env bash
# ==============================================================================
# TUTORPULSE - MASTER UNIFIED VERIFICATION SUITE (ALL 75 TESTS)
# Runs Suite 1 (52 Smoke Tests) + Suite 2 (23 Pipeline & Rubric Tests)
# ==============================================================================

TARGET="${1:-http://localhost:3080}"
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "\n${BOLD}${CYAN}==================================================================${NC}"
echo -e "${BOLD}${CYAN}     TUTORPULSE MASTER VERIFICATION TEST RUNNER (75 TESTS)        ${NC}"
echo -e "${BOLD}${CYAN}     Target: $TARGET${NC}"
echo -e "${BOLD}${CYAN}==================================================================${NC}\n"

echo -e "${BOLD}${YELLOW}>>> RUNNING SUITE 1: CORE MICROSERVICES SMOKE TESTS (52 Tests) <<<${NC}"
node tests/smoke.js "$TARGET"
SUITE1_CODE=$?

echo -e "\n${BOLD}${YELLOW}>>> RUNNING SUITE 2: FLOW PIPELINE & RUBRIC TESTS (23 Tests) <<<${NC}"
bash tests/full-test.sh "$TARGET"
SUITE2_CODE=$?

echo -e "\n${BOLD}${CYAN}==================================================================${NC}"
if [ $SUITE1_CODE -eq 0 ] && [ $SUITE2_CODE -eq 0 ]; then
  echo -e "${BOLD}${GREEN}   GRAND TOTAL: 75 / 75 TESTS PASSED! 100% SUCCESS.${NC}"
  echo -e "${GREEN}   • Suite 1 (Core Microservices & RBAC): 52 / 52 Passed${NC}"
  echo -e "${GREEN}   • Suite 2 (Flow Pipeline & Rubric Cases): 23 / 23 Passed${NC}"
  echo -e "${BOLD}${CYAN}==================================================================${NC}\n"
  exit 0
else
  echo -e "${BOLD}${RED}   VERIFICATION FAILED: One or more test suites reported errors.${NC}"
  echo -e "${BOLD}${CYAN}==================================================================${NC}\n"
  exit 1
fi
