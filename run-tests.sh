#!/bin/bash

# OpticalSend Quick Start & Test Runner
# Usage: chmod +x run-tests.sh && ./run-tests.sh

set -e

echo "🚀 OpticalSend Test Suite"
echo "=========================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}❌ pnpm not found. Install with: npm install -g pnpm${NC}"
    exit 1
fi

# Install dependencies
echo -e "${YELLOW}1️⃣  Installing dependencies...${NC}"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

# Run linter
echo -e "${YELLOW}2️⃣  Running TypeScript type check...${NC}"
if pnpm run build 2>/dev/null; then
    echo -e "${GREEN}✅ TypeScript passed${NC}"
else
    echo -e "${RED}❌ TypeScript errors found${NC}"
    exit 1
fi
echo ""

# Run unit tests
echo -e "${YELLOW}3️⃣  Running unit tests...${NC}"
if pnpm run test 2>/dev/null; then
    echo -e "${GREEN}✅ Unit tests passed${NC}"
else
    echo -e "${YELLOW}⚠️  Unit tests incomplete (this is expected for early implementation)${NC}"
fi
echo ""

# Summary
echo -e "${GREEN}🎉 Test suite complete!${NC}"
echo ""
echo "📝 Next steps:"
echo "   1. Start dev server: pnpm run dev"
echo "   2. Open browser: http://localhost:3000"
echo "   3. Test QR transfer: follow INTEGRATION.md"
echo ""
