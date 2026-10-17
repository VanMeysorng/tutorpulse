#!/usr/bin/env bash
# ==============================================================================
# TUTORPULSE - MASTER UNIFIED VERIFICATION SUITE
# Runs Suite 1 (smoke + CRUD tests) + Suite 2 (pipeline + rubric tests)
# ==============================================================================

TARGET="${1:-http://localhost}"
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "\n${BOLD}${CYAN}==================================================================${NC}"
echo -e "${BOLD}${CYAN}     TUTORPULSE MASTER VERIFICATION TEST RUNNER                    ${NC}"
echo -e "${BOLD}${CYAN}     Target: $TARGET${NC}"
echo -e "${BOLD}${CYAN}==================================================================${NC}\n"

echo -e "${BOLD}${YELLOW}>>> RUNNING SUITE 1: CORE MICROSERVICES SMOKE TESTS <<<${NC}"
node tests/smoke.js "$TARGET"
SUITE1_CODE=$?

echo -e "\n${BOLD}${YELLOW}>>> RUNNING SUITE 2: FLOW PIPELINE & RUBRIC TESTS <<<${NC}"
bash tests/full-test.sh "$TARGET"
SUITE2_CODE=$?

echo -e "\n${BOLD}${CYAN}==================================================================${NC}"
if [ $SUITE1_CODE -eq 0 ] && [ $SUITE2_CODE -eq 0 ]; then
  echo -e "${BOLD}${GREEN}   ALL TEST SUITES PASSED.${NC}"
  echo -e "${GREEN}   • Suite 1 (Core Microservices & RBAC): passed${NC}"
  echo -e "${GREEN}   • Suite 2 (Flow Pipeline & Rubric Cases): passed${NC}"
  echo -e "${BOLD}${CYAN}==================================================================${NC}\n"
  exit 0
else
  echo -e "${BOLD}${RED}   VERIFICATION FAILED: One or more test suites reported errors.${NC}"
  echo -e "${BOLD}${CYAN}==================================================================${NC}\n"
  exit 1
fi
